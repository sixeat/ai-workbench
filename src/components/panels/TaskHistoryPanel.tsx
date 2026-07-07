import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ClipboardList, Copy, ExternalLink, FileVideo, FolderOpen, ImagePlus, Plus, RefreshCw, RotateCcw, Search, Square, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { FloatingWindow } from '../layout/FloatingWindow';
import {
  proxyAddAssetToCollection,
  proxyAddAssetsToCollection,
  proxyAssetUrl,
  proxyCancelTask,
  proxyCreateAssetCollection,
  proxyGetVideoTask,
  proxyGetTask,
  proxyListAssetCollections,
  proxyListTasks,
  proxyOpenAssetLocation,
  proxyRetryTask,
  type ProxyAsset,
  type ProxyAssetCollection,
  type ProxyTask,
} from '../../lib/apiProxy';
import { collectionHasAsset, filterAssetsNotInCollection, getSuggestedRoles } from '../../lib/assetCollections';
import {
  canCancelTask,
  canRetryTask,
  chunkTaskAssetIds,
  collectArchivableTaskAssetIds,
  collectTaskAssets,
  extractTaskOutputText,
  extractTaskReusablePrompt,
  filterTaskHistoryItems,
  formatTaskAssetArchiveSummary,
  formatTaskHistoryPageSummary,
  formatTaskLogEvent,
  mergeTaskHistoryPages,
  serializeTaskInputForCopy,
  summarizeTaskError,
  summarizeTaskInput,
  uniqueTaskAssetIds,
  type TaskHistoryStatusFilter,
} from '../../lib/taskHistoryDisplay';
import { useImagePreviewStore } from '../../stores/imagePreviewStore';

interface TaskHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const TASK_PAGE_SIZE = 80;
const COLLECTION_PAGE_SIZE = 80;

const STATUS_LABEL: Record<ProxyTask['status'], string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function statusClass(status: ProxyTask['status']): string {
  const map: Record<ProxyTask['status'], string> = {
    queued: 'bg-gray-500/15 text-gray-300',
    running: 'bg-blue-500/15 text-blue-300',
    succeeded: 'bg-emerald-500/15 text-emerald-300',
    failed: 'bg-red-500/15 text-red-300',
    cancelled: 'bg-zinc-500/15 text-zinc-300',
  };
  return map[status];
}

function compact(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'message' in value) return String((value as { message?: unknown }).message || '');
  return JSON.stringify(value, null, 2);
}

function isImageAsset(asset: ProxyAsset): boolean {
  return asset.type === 'image' || /\.(png|jpe?g|webp|gif|avif)$/i.test(asset.url || asset.fileName || '');
}

function formatDuration(value: number | null): string {
  if (value == null) return '';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function mergeTasks(current: ProxyTask[], next: ProxyTask[]): ProxyTask[] {
  return mergeTaskHistoryPages(
    current.map((task) => ({ task, assets: [] })),
    next.map((task) => ({ task, assets: [] }))
  ).map((item) => item.task);
}

function preserveLoadedTaskDetails(next: ProxyTask[], current: ProxyTask[]): ProxyTask[] {
  const currentById = new Map(current.map((task) => [task.id, task]));
  return next.map((task) => {
    const existing = currentById.get(task.id);
    if (!existing?.logs || task.logs) return task;
    return {
      ...task,
      logs: existing.logs,
    };
  });
}

function mergeCollections(current: ProxyAssetCollection[], next: ProxyAssetCollection[]): ProxyAssetCollection[] {
  const seen = new Set<string>();
  return [...current, ...next].filter((collection) => {
    if (seen.has(collection.id)) return false;
    seen.add(collection.id);
    return true;
  });
}

export function TaskHistoryPanel({ isOpen, onClose }: TaskHistoryPanelProps) {
  const [tasks, setTasks] = useState<ProxyTask[]>([]);
  const [taskTotal, setTaskTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [collections, setCollections] = useState<ProxyAssetCollection[]>([]);
  const [collectionTotal, setCollectionTotal] = useState(0);
  const [collectionSearch, setCollectionSearch] = useState('');
  const [loadingMoreCollections, setLoadingMoreCollections] = useState(false);
  const [targetCollectionId, setTargetCollectionId] = useState('');
  const [targetAssetRole, setTargetAssetRole] = useState('');
  const [expandedTaskIds, setExpandedTaskIds] = useState<string[]>([]);
  const [detailLoadingTaskIds, setDetailLoadingTaskIds] = useState<string[]>([]);
  const [taskSearch, setTaskSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskHistoryStatusFilter>('all');
  const { openPreview } = useImagePreviewStore();

  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === targetCollectionId) || null,
    [collections, targetCollectionId]
  );
  const selectedRoles = useMemo(() => selectedCollection ? getSuggestedRoles(selectedCollection) : [], [selectedCollection]);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const limit = Math.max(TASK_PAGE_SIZE, tasks.length || TASK_PAGE_SIZE);
      const data = await proxyListTasks({ limit, offset: 0 });
      setTasks((current) => preserveLoadedTaskDetails(data.tasks, current));
      setTaskTotal(data.total ?? data.count);
      const runningVideos = data.tasks.filter((task) => task.status === 'running' && (task.nodeType || task.kind) === 'video');
      if (runningVideos.length > 0) {
        const results = await Promise.allSettled(runningVideos.map((task) => proxyGetVideoTask(task.id)));
        if (results.some((result) => result.status === 'fulfilled')) {
          const nextData = await proxyListTasks({ limit, offset: 0 });
          setTasks((current) => preserveLoadedTaskDetails(nextData.tasks, current));
          setTaskTotal(nextData.total ?? nextData.count);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '任务历史加载失败');
    } finally {
      setLoading(false);
    }
  }, [tasks.length]);

  const loadMoreTasks = useCallback(async () => {
    setLoadingMore(true);
    setError('');
    try {
      const data = await proxyListTasks({ limit: TASK_PAGE_SIZE, offset: tasks.length });
      setTasks((current) => mergeTasks(current, data.tasks));
      setTaskTotal(data.total ?? data.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : '任务历史加载失败');
    } finally {
      setLoadingMore(false);
    }
  }, [tasks.length]);

  const loadTaskDetails = useCallback(async (taskId: string) => {
    setDetailLoadingTaskIds((current) => current.includes(taskId) ? current : [...current, taskId]);
    try {
      const { task } = await proxyGetTask(taskId);
      setTasks((current) => current.map((item) => item.id === task.id ? task : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : '任务详情加载失败');
    } finally {
      setDetailLoadingTaskIds((current) => current.filter((id) => id !== taskId));
    }
  }, []);

  const loadCollections = useCallback(async (options: { search?: string; selectId?: string } = {}) => {
    try {
      const search = (options.search ?? collectionSearch).trim();
      const data = await proxyListAssetCollections({
        limit: COLLECTION_PAGE_SIZE,
        offset: 0,
        search: search || undefined,
      });
      setCollections(data.collections);
      setCollectionTotal(data.total ?? data.count);
      setTargetCollectionId((current) => {
        if (options.selectId && data.collections.some((collection) => collection.id === options.selectId)) {
          return options.selectId;
        }
        if (current && data.collections.some((collection) => collection.id === current)) return current;
        return data.collections[0]?.id || '';
      });
    } catch {
      setCollections([]);
      setCollectionTotal(0);
      setTargetCollectionId('');
    }
  }, [collectionSearch]);

  const loadMoreCollections = useCallback(async () => {
    setLoadingMoreCollections(true);
    setError('');
    try {
      const search = collectionSearch.trim();
      const data = await proxyListAssetCollections({
        limit: COLLECTION_PAGE_SIZE,
        offset: collections.length,
        search: search || undefined,
      });
      setCollections((current) => mergeCollections(current, data.collections));
      setCollectionTotal(data.total ?? data.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : '素材集合加载失败');
    } finally {
      setLoadingMoreCollections(false);
    }
  }, [collectionSearch, collections.length]);

  useEffect(() => {
    if (!isOpen) return;
    void loadTasks();
    const timer = window.setInterval(loadTasks, 3000);
    return () => window.clearInterval(timer);
  }, [isOpen, loadTasks]);

  useEffect(() => {
    if (!isOpen) return;
    void loadCollections();
  }, [isOpen, loadCollections]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 1600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!selectedCollection) {
      setTargetAssetRole('');
      return;
    }
    const roles = getSuggestedRoles(selectedCollection);
    setTargetAssetRole((current) => current && roles.includes(current) ? current : roles[0] || '');
  }, [selectedCollection]);

  const taskCards = useMemo(
    () => tasks.map((task) => ({ task, assets: collectTaskAssets(task) })),
    [tasks]
  );
  const filteredTaskCards = useMemo(
    () => filterTaskHistoryItems(taskCards, { search: taskSearch, status: statusFilter }),
    [statusFilter, taskCards, taskSearch]
  );
  const taskSummary = formatTaskHistoryPageSummary(
    filteredTaskCards.length,
    tasks.length,
    taskTotal,
    { search: taskSearch, status: statusFilter }
  );
  const archivableTaskCards = useMemo(
    () => selectedCollection
      ? filteredTaskCards.map((item) => ({
        ...item,
        assets: filterAssetsNotInCollection(item.assets, selectedCollection),
      }))
      : filteredTaskCards,
    [filteredTaskCards, selectedCollection]
  );
  const archivableAssetIds = useMemo(
    () => collectArchivableTaskAssetIds(archivableTaskCards),
    [archivableTaskCards]
  );
  const archiveSummary = useMemo(
    () => formatTaskAssetArchiveSummary(archivableTaskCards),
    [archivableTaskCards]
  );
  const hasMoreTasks = tasks.length < taskTotal;
  const hasMoreCollections = collections.length < collectionTotal;

  const createDefaultCollection = async (): Promise<string> => {
    const { collection } = await proxyCreateAssetCollection({
      name: '默认生成素材',
      description: '从任务历史一键加入的生成结果。',
      category: 'reference-group',
      metadata: {
        template: 'reference-group',
        suggestedRoles: ['生成图', '参考图', '首帧', '尾帧'],
      },
    });
    setCollectionSearch('');
    await loadCollections({ search: '', selectId: collection.id });
    setTargetCollectionId(collection.id);
    return collection.id;
  };

  const addAssetToLibrary = async (asset: ProxyAsset) => {
    if (selectedCollection && collectionHasAsset(selectedCollection, asset.id)) {
      setNotice('这个产物已在当前集合中');
      return;
    }

    try {
      setError('');
      const collectionId = targetCollectionId || await createDefaultCollection();
      await proxyAddAssetToCollection(collectionId, {
        assetId: asset.id,
        role: targetAssetRole || selectedRoles[0] || '生成图',
        note: '来自任务历史',
      });
      await loadCollections({ selectId: collectionId });
      setNotice('已加入素材集合');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入素材集合失败');
    }
  };

  const addTaskAssetsToLibrary = async (task: ProxyTask, assets: ProxyAsset[]) => {
    if (assets.length === 0) return;
    const newAssets = selectedCollection ? filterAssetsNotInCollection(assets, selectedCollection) : assets;
    if (newAssets.length === 0) {
      setNotice('这些产物已在当前集合中');
      return;
    }

    try {
      setError('');
      const collectionId = targetCollectionId || await createDefaultCollection();
      const role = targetAssetRole || selectedRoles[0] || '生成图';
      const assetIds = uniqueTaskAssetIds(newAssets);
      if (assetIds.length === 0) {
        setError('这些产物没有资产 ID，暂时不能加入素材集合。');
        return;
      }

      let addedTotal = 0;
      let skippedTotal = assets.length - assetIds.length;
      for (const chunk of chunkTaskAssetIds(assetIds)) {
        const result = await proxyAddAssetsToCollection(collectionId, {
          assetIds: chunk,
          role,
          note: `来自任务 ${task.id}`,
        });
        addedTotal += result.added;
        skippedTotal += result.skipped;
      }

      await loadCollections({ selectId: collectionId });
      setNotice(skippedTotal > 0 ? `已加入 ${addedTotal} 个素材，跳过 ${skippedTotal} 个` : `已加入 ${addedTotal} 个素材`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入素材集合失败');
    }
  };

  const addFilteredTaskAssetsToLibrary = async () => {
    if (archivableAssetIds.length === 0) {
      setError('已加载结果里没有可入库产物。');
      return;
    }

    try {
      setError('');
      const collectionId = targetCollectionId || await createDefaultCollection();
      const role = targetAssetRole || selectedRoles[0] || '生成图';
      let addedTotal = 0;
      let skippedTotal = 0;

      for (const chunk of chunkTaskAssetIds(archivableAssetIds)) {
        const result = await proxyAddAssetsToCollection(collectionId, {
          assetIds: chunk,
          role,
          note: `来自任务历史批量归档，共 ${archivableAssetIds.length} 个产物`,
        });
        addedTotal += result.added;
        skippedTotal += result.skipped;
      }

      await loadCollections({ selectId: collectionId });
      setNotice(skippedTotal > 0 ? `已加入 ${addedTotal} 个素材，跳过 ${skippedTotal} 个` : `已批量加入 ${addedTotal} 个素材`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量加入素材集合失败');
    }
  };

  const toggleTaskDetails = (taskId: string) => {
    setExpandedTaskIds((current) => (
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId]
    ));
    const task = tasks.find((item) => item.id === taskId);
    if (task && task.logs === undefined) void loadTaskDetails(taskId);
  };

  if (!isOpen) return null;

  return (
    <FloatingWindow placement="bottom-right" contentClassName="max-h-[72vh] w-[500px] flex-col">
      <div className="flex items-center gap-2 border-b border-panel-border px-3 py-2">
        <div className="text-sm font-medium text-white">任务历史</div>
        <span className="rounded bg-canvas-bg px-1.5 py-0.5 text-[10px] text-gray-500">{taskSummary}</span>
        {notice && <span className="text-[10px] text-emerald-300">{notice}</span>}
        <button onClick={() => void loadTasks()} disabled={loading} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-700/50 hover:text-white" title="刷新">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
        <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-700/50 hover:text-white" title="关闭">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-[1fr_104px] gap-2 border-b border-panel-border px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
          <input
            value={taskSearch}
            onChange={(event) => setTaskSearch(event.target.value)}
            placeholder="搜索 prompt、模型、任务 ID、产物、错误..."
            className="w-full rounded-md border border-panel-border bg-canvas-bg py-1.5 pl-8 pr-3 text-[10px] text-white placeholder-gray-600 focus:border-accent focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as TaskHistoryStatusFilter)}
          className="rounded-md border border-panel-border bg-canvas-bg px-2 py-1.5 text-[10px] text-gray-200 focus:border-accent focus:outline-none"
          title="按任务状态筛选"
        >
          <option value="all">全部状态</option>
          <option value="queued">排队中</option>
          <option value="running">运行中</option>
          <option value="succeeded">已完成</option>
          <option value="failed">失败</option>
          <option value="cancelled">已取消</option>
        </select>
      </div>

      <div className="space-y-2 border-b border-panel-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[10px] text-gray-500">加入到</span>
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
            <input
              value={collectionSearch}
              onChange={(event) => setCollectionSearch(event.target.value)}
              placeholder="搜索素材集合..."
              className="w-full rounded-md border border-panel-border bg-canvas-bg py-1 pl-8 pr-3 text-[10px] text-white placeholder-gray-600 focus:border-accent focus:outline-none"
            />
          </div>
          <button
            onClick={async () => {
              const id = await createDefaultCollection();
              setTargetCollectionId(id);
              setNotice('已创建默认集合');
            }}
            className="rounded-md border border-panel-border px-2 py-1 text-[10px] text-gray-300 hover:border-accent hover:text-accent"
            title="创建默认生成素材集合"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={targetCollectionId}
            onChange={(event) => setTargetCollectionId(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-panel-border bg-canvas-bg px-2 py-1 text-[10px] text-gray-200 focus:border-accent focus:outline-none"
          >
            {collections.length === 0 ? (
              <option value="">自动创建默认集合</option>
            ) : (
              collections.map((collection) => (
                <option key={collection.id} value={collection.id}>{collection.name}</option>
              ))
            )}
          </select>
          {selectedRoles.length > 0 && (
            <select
              value={targetAssetRole}
              onChange={(event) => setTargetAssetRole(event.target.value)}
              className="w-24 rounded-md border border-panel-border bg-canvas-bg px-2 py-1 text-[10px] text-gray-200 focus:border-accent focus:outline-none"
              title="加入集合时的素材角色"
            >
              {selectedRoles.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          )}
          <span className="shrink-0 text-[10px] text-gray-500">
            {collections.length}/{Math.max(collectionTotal, collections.length)}
          </span>
          {hasMoreCollections && (
            <button
              onClick={() => void loadMoreCollections()}
              disabled={loadingMoreCollections}
              className="rounded-md border border-panel-border px-2 py-1 text-[10px] text-gray-300 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMoreCollections ? '加载中' : '加载更多'}
            </button>
          )}
          <button
            onClick={() => void addFilteredTaskAssetsToLibrary()}
            disabled={archivableAssetIds.length === 0}
            className="rounded-md border border-panel-border px-2 py-1 text-[10px] text-gray-300 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            title={archiveSummary}
          >
            归档已加载结果
          </button>
        </div>
      </div>

      {error && <div className="border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      <div className="flex-1 space-y-2 overflow-auto p-3">
        {filteredTaskCards.length === 0 ? (
          <div className="py-10 text-center text-xs text-gray-500">
            {tasks.length === 0 ? '暂无任务。生成图片、文本或视频后会显示在这里。' : '没有匹配的任务。可以换个关键词或切回全部状态。'}
          </div>
        ) : (
          filteredTaskCards.map(({ task, assets }) => {
            const text = extractTaskOutputText(task.output);
            const errorText = compact(task.error);
            const errorSummary = summarizeTaskError(task.error);
            const expanded = expandedTaskIds.includes(task.id);
            const inputRows = summarizeTaskInput(task.input);
            const reusablePrompt = extractTaskReusablePrompt(task.input);
            const copyableInputJson = serializeTaskInputForCopy(task.input);
            const logs = task.logs || [];
            const logsLoading = detailLoadingTaskIds.includes(task.id);
            const newTaskAssets = selectedCollection ? filterAssetsNotInCollection(assets, selectedCollection) : assets;

            return (
              <div key={task.id} className="rounded-lg border border-panel-border bg-canvas-bg/60 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', statusClass(task.status))}>
                    {STATUS_LABEL[task.status]}
                  </span>
                  <span className="text-[10px] text-gray-500">{task.nodeType || task.kind}</span>
                  {task.model && <span className="truncate text-[10px] text-gray-500">{task.model}</span>}
                  {typeof task.creditCost === 'number' && task.creditStatus && task.creditStatus !== 'none' && (
                    <span className={cn(
                      'rounded px-1.5 py-0.5 text-[10px]',
                      task.creditStatus === 'refunded'
                        ? 'bg-sky-500/10 text-sky-300'
                        : task.creditCost > 0
                          ? 'bg-amber-500/10 text-amber-300'
                          : 'bg-emerald-500/10 text-emerald-300'
                    )}
                    >
                      {task.creditStatus === 'refunded'
                        ? `已退 ${task.creditCost} 积分`
                        : task.creditCost > 0
                          ? `-${task.creditCost} 积分`
                          : '用户 Key 免费'}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-gray-500">{new Date(task.createdAt).toLocaleString()}</span>
                </div>

                {assets.length > 0 && (
                  <div className="mb-2 grid grid-cols-3 gap-2">
                    {assets.map((asset, index) => {
                      const url = proxyAssetUrl(asset.url);
                      const image = isImageAsset(asset);
                      const alreadyInCollection = selectedCollection ? collectionHasAsset(selectedCollection, asset.id) : false;
                      return (
                        <div key={`${asset.id}-${index}`} className="overflow-hidden rounded-lg border border-panel-border bg-black/20">
                          <button
                            className="flex aspect-square w-full items-center justify-center bg-black/30"
                            onClick={() => image ? openPreview(url, asset.fileName || '任务图片') : window.open(url, '_blank', 'noopener,noreferrer')}
                            title={image ? '预览大图' : '打开视频'}
                          >
                            {image ? (
                              <img src={url} alt={asset.fileName || asset.id} className="h-full w-full object-cover" />
                            ) : (
                              <FileVideo className="h-8 w-8 text-gray-500" />
                            )}
                          </button>
                          <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                            <IconButton
                              title="复制 URL"
                              onClick={async () => {
                                await copyText(url);
                                setNotice('已复制 URL');
                              }}
                            >
                              <Copy className="h-3 w-3" />
                            </IconButton>
                            <IconButton title={image ? '预览' : '打开'} onClick={() => image ? openPreview(url, asset.fileName || '任务图片') : window.open(url, '_blank', 'noopener,noreferrer')}>
                              <ExternalLink className="h-3 w-3" />
                            </IconButton>
                            {asset.filePath && (
                              <IconButton
                                title="打开文件位置"
                                onClick={async () => {
                                  await proxyOpenAssetLocation(asset.id);
                                  setNotice('已打开位置');
                                }}
                              >
                                <FolderOpen className="h-3 w-3" />
                              </IconButton>
                            )}
                            <IconButton
                              title={alreadyInCollection ? '已在当前素材集合中' : '加入素材集合'}
                              disabled={alreadyInCollection}
                              onClick={() => void addAssetToLibrary(asset)}
                            >
                              <ImagePlus className="h-3 w-3" />
                            </IconButton>
                            {alreadyInCollection && <span className="text-[9px] text-emerald-300">已在集合</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="space-y-2 text-[10px] text-gray-400">
                  {text && <div className="max-h-20 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2">{text}</div>}
                  {task.input?.prompt && <div className="line-clamp-2 rounded bg-black/20 p-2 text-gray-500">{String(task.input.prompt)}</div>}
                  {errorSummary && (
                    <div className="space-y-1.5 rounded border border-red-500/20 bg-red-500/10 p-2 text-red-200">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{errorSummary.title}</span>
                        {errorSummary.retryable !== undefined && (
                          <span className={cn(
                            'rounded px-1.5 py-0.5 text-[9px]',
                            errorSummary.retryable ? 'bg-amber-500/15 text-amber-200' : 'bg-red-500/15 text-red-200'
                          )}
                          >
                            {errorSummary.actionLabel || (errorSummary.retryable ? '可重试' : '需检查配置')}
                          </span>
                        )}
                      </div>
                      <div className="whitespace-pre-wrap text-red-100/90">{errorSummary.detail}</div>
                      {(errorSummary.status || errorSummary.code || errorSummary.requestId) && (
                        <div className="flex flex-wrap gap-1.5 text-[9px] text-red-100/60">
                          {errorSummary.status && <span>状态 {errorSummary.status}</span>}
                          {errorSummary.code && <span>代码 {errorSummary.code}</span>}
                          {errorSummary.requestId && <span>请求 ID {errorSummary.requestId}</span>}
                        </div>
                      )}
                      {errorSummary.retryHint && <div className="text-[9px] text-red-100/70">{errorSummary.retryHint}</div>}
                    </div>
                  )}
                  {task.error?.warnings?.length > 0 && <div className="rounded bg-amber-500/10 p-2 text-amber-200">{task.error.warnings.join('\n')}</div>}
                </div>

                {expanded && (
                  <div className="mt-3 space-y-2 rounded-lg border border-panel-border bg-black/15 p-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-medium text-gray-300">
                      <ClipboardList className="h-3 w-3 text-accent" />
                      任务详情
                    </div>
                    {inputRows.length > 0 && (
                      <div className="grid grid-cols-2 gap-1.5">
                        {inputRows.map((row) => (
                          <div key={row.label} className="rounded bg-canvas-bg px-2 py-1">
                            <div className="text-[9px] text-gray-600">{row.label}</div>
                            <div className="truncate text-[10px] text-gray-300" title={row.value}>{row.value}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {logs.length > 0 ? (
                      <div className="max-h-36 space-y-1 overflow-auto">
                        {logs.map((log) => (
                          <div key={log.id} className="rounded bg-canvas-bg px-2 py-1.5">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                'rounded px-1.5 py-0.5 text-[9px]',
                                log.level === 'error' && 'bg-red-500/10 text-red-300',
                                log.level === 'warn' && 'bg-amber-500/10 text-amber-300',
                                log.level !== 'error' && log.level !== 'warn' && 'bg-gray-700/40 text-gray-300'
                              )}
                              >
                                {formatTaskLogEvent(log.event)}
                              </span>
                              <span className="ml-auto text-[9px] text-gray-600">{new Date(log.createdAt).toLocaleTimeString()}</span>
                            </div>
                            {log.message && <div className="mt-1 line-clamp-2 text-[10px] text-gray-500">{log.message}</div>}
                            {log.data && Object.keys(log.data).length > 0 && (
                              <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap text-[9px] text-gray-600">{JSON.stringify(log.data, null, 2)}</pre>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : logsLoading ? (
                      <div className="rounded bg-canvas-bg px-2 py-1.5 text-[10px] text-gray-600">正在加载任务日志...</div>
                    ) : (
                      <div className="rounded bg-canvas-bg px-2 py-1.5 text-[10px] text-gray-600">暂无任务日志。</div>
                    )}
                    {errorText && (
                      <details className="rounded bg-canvas-bg px-2 py-1.5 text-[10px] text-gray-500">
                        <summary className="cursor-pointer text-gray-400">错误详情</summary>
                        <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap text-[9px] text-gray-600">{errorText}</pre>
                      </details>
                    )}
                  </div>
                )}

                <div className="mt-2 flex items-center gap-2">
                  {reusablePrompt && (
                    <button
                      onClick={async () => {
                        await copyText(reusablePrompt);
                        setNotice('已复制提示词');
                      }}
                      className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-gray-300 hover:bg-gray-700/50"
                      title="复制这次任务的原始提示词"
                    >
                      <Copy className="h-3 w-3" />
                      提示词
                    </button>
                  )}
                  {copyableInputJson && (
                    <button
                      onClick={async () => {
                        await copyText(copyableInputJson);
                        setNotice('已复制输入 JSON');
                      }}
                      className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-gray-300 hover:bg-gray-700/50"
                      title="复制已隐藏敏感字段的任务输入"
                    >
                      <Copy className="h-3 w-3" />
                      输入 JSON
                    </button>
                  )}
                  {text && (
                    <button
                      onClick={async () => {
                        await copyText(text);
                        setNotice('已复制输出文本');
                      }}
                      className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-gray-300 hover:bg-gray-700/50"
                      title="复制这次任务的文本输出"
                    >
                      <Copy className="h-3 w-3" />
                      输出文本
                    </button>
                  )}
                  <button
                    onClick={() => toggleTaskDetails(task.id)}
                    className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-gray-300 hover:bg-gray-700/50"
                  >
                    {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    详情
                  </button>
                  {assets.length > 0 && (
                    <button
                      onClick={() => void addTaskAssetsToLibrary(task, assets)}
                      disabled={newTaskAssets.length === 0}
                      className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-gray-300 hover:bg-gray-700/50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ImagePlus className="h-3 w-3" />
                      {newTaskAssets.length === 0 ? '已入库' : '全部入库'}
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      await proxyRetryTask(task.id);
                      await loadTasks();
                    }}
                    disabled={!canRetryTask(task.status)}
                    className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-gray-300 hover:bg-gray-700/50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RotateCcw className="h-3 w-3" />
                    重试
                  </button>
                  <button
                    onClick={async () => {
                      await proxyCancelTask(task.id);
                      await loadTasks();
                    }}
                    disabled={!canCancelTask(task.status)}
                    className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-gray-300 hover:bg-gray-700/50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Square className="h-3 w-3" />
                    {task.status === 'running' ? '请求取消' : '取消'}
                  </button>
                  {task.durationMs != null && <span className="ml-auto text-[10px] text-gray-600">{formatDuration(task.durationMs)}</span>}
                </div>
              </div>
            );
          })
        )}
        {hasMoreTasks && (
          <div className="flex justify-center pt-1">
            <button
              onClick={() => void loadMoreTasks()}
              disabled={loadingMore}
              className="rounded-md border border-panel-border px-3 py-1.5 text-xs text-gray-300 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMore ? '加载中...' : '加载更多任务'}
            </button>
          </div>
        )}
      </div>
    </FloatingWindow>
  );
}

function IconButton({
  children,
  disabled = false,
  title,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded p-1 text-gray-400 hover:bg-gray-700/60 hover:text-white disabled:cursor-not-allowed disabled:text-gray-600 disabled:hover:bg-transparent disabled:hover:text-gray-600"
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}
