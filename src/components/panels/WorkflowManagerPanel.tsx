import { useCallback, useEffect, useState } from 'react';
import { Check, Clock, Copy, Download, FileJson, FileText, FolderOpen, HardDrive, Layers, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { summarizeWorkflowVersionDiff } from '../../lib/workflowVersionDiff';
import {
  deleteWorkflow,
  duplicateWorkflow,
  duplicateWorkflowVersion,
  getWorkflowVersionPage,
  listWorkflowPage,
  restoreWorkflowVersion,
  saveWorkflow,
  type WorkflowMutationResult,
  type WorkflowProject,
  type WorkflowVersion,
} from '../../stores/workflowDb';
import { useCanvasStore } from '../../stores/canvasStore';

interface WorkflowManagerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadProject: (project: WorkflowProject) => void;
  onCurrentProjectChange?: (project: WorkflowProject) => void;
  onNewWorkflow: () => void;
  onExport: () => void;
  currentWorkflowId?: string;
  currentWorkflowName?: string;
}

const WORKFLOW_PAGE_SIZE = 80;
const WORKFLOW_VERSION_PAGE_SIZE = 8;

function mergeWorkflowPages(current: WorkflowProject[], next: WorkflowProject[]): WorkflowProject[] {
  const seen = new Set<string>();
  return [...current, ...next].filter((workflow) => {
    if (seen.has(workflow.id)) return false;
    seen.add(workflow.id);
    return true;
  });
}

function mergeWorkflowVersions(current: WorkflowVersion[], next: WorkflowVersion[]): WorkflowVersion[] {
  const seen = new Set<string>();
  return [...current, ...next].filter((version) => {
    if (seen.has(version.id)) return false;
    seen.add(version.id);
    return true;
  });
}

export function WorkflowManagerPanel({
  isOpen,
  onClose,
  onLoadProject,
  onCurrentProjectChange,
  onNewWorkflow,
  onExport,
  currentWorkflowId,
  currentWorkflowName,
}: WorkflowManagerPanelProps) {
  const [activeTab, setActiveTab] = useState<'library' | 'import-export'>('library');
  const [workflows, setWorkflows] = useState<WorkflowProject[]>([]);
  const [workflowTotal, setWorkflowTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [importError, setImportError] = useState('');
  const [expandedVersionsId, setExpandedVersionsId] = useState<string | null>(null);
  const [versionsByWorkflow, setVersionsByWorkflow] = useState<Record<string, WorkflowVersion[]>>({});
  const [versionTotalsByWorkflow, setVersionTotalsByWorkflow] = useState<Record<string, number>>({});
  const [versionsLoadingId, setVersionsLoadingId] = useState<string | null>(null);
  const [versionsLoadingMoreId, setVersionsLoadingMoreId] = useState<string | null>(null);
  const { nodes, edges } = useCanvasStore();

  const loadWorkflows = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const page = await listWorkflowPage({
        limit: WORKFLOW_PAGE_SIZE,
        offset: 0,
        search: searchQuery.trim() || undefined,
      });
      setWorkflows(page.workflows);
      setWorkflowTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '工作流加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery]);

  const loadMoreWorkflows = useCallback(async () => {
    setIsLoadingMore(true);
    setError('');
    try {
      const page = await listWorkflowPage({
        limit: WORKFLOW_PAGE_SIZE,
        offset: workflows.length,
        search: searchQuery.trim() || undefined,
      });
      setWorkflows((current) => mergeWorkflowPages(current, page.workflows));
      setWorkflowTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '更多工作流加载失败');
    } finally {
      setIsLoadingMore(false);
    }
  }, [searchQuery, workflows.length]);

  useEffect(() => {
    if (isOpen) loadWorkflows();
  }, [isOpen, loadWorkflows]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 1600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const hasMoreWorkflows = workflows.length < workflowTotal;
  const workflowSummary = searchQuery.trim()
    ? `${workflows.length}/${workflowTotal} 个匹配`
    : `已加载 ${workflows.length}/${workflowTotal} 个`;

  const workflowSaveNotice = (result: WorkflowMutationResult, action = '保存'): string => {
    if (result.storage === 'local') return `后端暂时不可用，已${action}到本地浏览器。恢复连接后建议重新保存到后端。`;
    return `已${action}到后端工作流库`;
  };

  const handleSaveCurrent = async () => {
    if (nodes.length === 0) {
      window.alert('当前画布为空，没有可保存的内容。');
      return;
    }
    const name = window.prompt('保存当前工作流，请输入名称：', currentWorkflowName || '未命名工作流');
    if (!name) return;

    const now = new Date().toISOString();
    const id = currentWorkflowId || `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const existing = workflows.find((workflow) => workflow.id === id);
    const project: WorkflowProject = {
      id,
      name,
      description: existing?.description || '',
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      nodeCount: nodes.length,
      metadata: existing?.metadata,
    };

    const result = await saveWorkflow(project);
    await loadWorkflows();
    onCurrentProjectChange?.(project);
    setNotice(workflowSaveNotice(result));
  };

  const handleNew = async () => {
    if (nodes.length > 0) {
      const saveFirst = window.confirm('当前画布有内容，是否先保存到工作流库？');
      if (saveFirst) await handleSaveCurrent();
    }
    onNewWorkflow();
    onClose();
  };

  const handleLoad = (project: WorkflowProject) => {
    if (nodes.length > 0 && !window.confirm('打开新工作流会替换当前画布，确定继续吗？')) return;
    onLoadProject(project);
    onClose();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除这个工作流吗？')) return;
    const result = await deleteWorkflow(id);
    await loadWorkflows();
    setNotice(result.storage === 'local' ? '后端暂时不可用，已从本地浏览器删除。' : '已删除工作流');
  };

  const handleDuplicate = async (id: string) => {
    await duplicateWorkflow(id);
    await loadWorkflows();
    setNotice('已复制工作流');
  };

  const toggleVersions = async (id: string) => {
    if (expandedVersionsId === id) {
      setExpandedVersionsId(null);
      return;
    }
    setExpandedVersionsId(id);
    if (versionsByWorkflow[id]) return;
    setVersionsLoadingId(id);
    try {
      const page = await getWorkflowVersionPage(id, { limit: WORKFLOW_VERSION_PAGE_SIZE, offset: 0 });
      setVersionsByWorkflow((current) => ({ ...current, [id]: page.versions }));
      setVersionTotalsByWorkflow((current) => ({ ...current, [id]: page.total }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '版本记录加载失败');
    } finally {
      setVersionsLoadingId(null);
    }
  };

  const loadMoreVersions = async (workflowId: string) => {
    const currentVersions = versionsByWorkflow[workflowId] || [];
    setVersionsLoadingMoreId(workflowId);
    setError('');
    try {
      const page = await getWorkflowVersionPage(workflowId, {
        limit: WORKFLOW_VERSION_PAGE_SIZE,
        offset: currentVersions.length,
      });
      setVersionsByWorkflow((current) => ({
        ...current,
        [workflowId]: mergeWorkflowVersions(current[workflowId] || [], page.versions),
      }));
      setVersionTotalsByWorkflow((current) => ({ ...current, [workflowId]: page.total }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '更多版本加载失败');
    } finally {
      setVersionsLoadingMoreId(null);
    }
  };

  const handleRestoreVersion = async (workflowId: string, version: WorkflowVersion) => {
    if (!window.confirm(`确定回滚到 v${version.versionNumber} 吗？当前状态会先自动保存为一个新版本。`)) return;
    const restored = await restoreWorkflowVersion(workflowId, version.id);
    setVersionsByWorkflow((current) => {
      const next = { ...current };
      delete next[workflowId];
      return next;
    });
    await loadWorkflows();
    onLoadProject(restored);
    onClose();
  };

  const handleDuplicateVersion = async (workflowId: string, version: WorkflowVersion) => {
    const duplicated = await duplicateWorkflowVersion(workflowId, version.id);
    setVersionsByWorkflow((current) => {
      const next = { ...current };
      delete next[duplicated.id];
      return next;
    });
    await loadWorkflows();
    setNotice(`已复制 v${version.versionNumber} 为新工作流`);
  };

  const startRename = (workflow: WorkflowProject) => {
    setEditingId(workflow.id);
    setEditName(workflow.name);
  };

  const finishRename = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    const project = workflows.find((workflow) => workflow.id === id);
    if (!project) return;
    const renamedProject = { ...project, name, updatedAt: new Date().toISOString() };
    const result = await saveWorkflow(renamedProject);
    setEditingId(null);
    await loadWorkflows();
    if (id === currentWorkflowId) onCurrentProjectChange?.(renamedProject);
    setNotice(workflowSaveNotice(result, '重命名'));
  };

  const handleImportFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (readerEvent) => {
        try {
          const data = JSON.parse(String(readerEvent.target?.result || ''));
          if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
            setImportError('JSON 格式无效：缺少 nodes 或 edges。');
            return;
          }
          const now = new Date().toISOString();
          const project: WorkflowProject = {
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
            name: String(data.name || file.name.replace(/\.json$/i, '') || '导入的工作流'),
            description: String(data.description || ''),
            nodes: data.nodes,
            edges: data.edges,
            createdAt: now,
            updatedAt: now,
            nodeCount: data.nodes.length,
            metadata: data.metadata || {},
          };
          const result = await saveWorkflow(project);
          await loadWorkflows();
          setImportError('');
          setNotice(workflowSaveNotice(result, '导入'));
          setActiveTab('library');
        } catch (err) {
          setImportError(`JSON 解析失败：${err instanceof Error ? err.message : String(err)}`);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleExport = () => {
    if (nodes.length === 0) {
      window.alert('当前画布为空。');
      return;
    }
    onExport();
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="flex h-[80vh] w-[760px] flex-col overflow-hidden rounded-xl border border-panel-border bg-panel-bg shadow-2xl">
        <div className="flex items-center justify-between border-b border-panel-border px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-white">工作流管理</h2>
            {notice && <span className="text-[10px] text-emerald-300">{notice}</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white" title="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex border-b border-panel-border">
          <TabButton active={activeTab === 'library'} icon={<HardDrive className="h-3.5 w-3.5" />} onClick={() => setActiveTab('library')}>
            工作流库
          </TabButton>
          <TabButton active={activeTab === 'import-export'} icon={<FileJson className="h-3.5 w-3.5" />} onClick={() => setActiveTab('import-export')}>
            导入 / 导出
          </TabButton>
        </div>

        {error && <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300">{error}</div>}

        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === 'library' ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-2 border-b border-panel-border px-4 py-2.5">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="搜索工作流..."
                    className="w-full rounded-md border border-panel-border bg-canvas-bg py-1.5 pl-8 pr-3 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
                  />
                </div>
                <span className="shrink-0 text-[10px] text-gray-500">{workflowSummary}</span>
                <ActionButton onClick={handleSaveCurrent} icon={<Check className="h-3.5 w-3.5" />} primary>
                  保存当前
                </ActionButton>
                <ActionButton onClick={handleNew} icon={<Plus className="h-3.5 w-3.5" />}>
                  新建
                </ActionButton>
              </div>

              <div className="flex-1 overflow-auto p-4">
                {isLoading && workflows.length === 0 ? (
                  <div className="py-12 text-center text-xs text-gray-500">加载中...</div>
                ) : workflows.length === 0 ? (
                  <div className="py-12 text-center text-gray-500">
                    <Layers className="mx-auto mb-3 h-10 w-10 opacity-30" />
                    <p className="text-xs">{searchQuery.trim() ? '没有匹配的工作流' : '暂无工作流'}</p>
                    <p className="mt-1 text-[10px]">{searchQuery.trim() ? '可以换个关键词再试。' : '点击“保存当前”或“新建”开始。'}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {workflows.map((workflow) => {
                      const isCurrent = workflow.id === currentWorkflowId;
                      const versions = versionsByWorkflow[workflow.id] || [];
                      const versionTotal = versionTotalsByWorkflow[workflow.id] ?? versions.length;
                      const hasMoreVersions = versions.length < versionTotal;
                      return (
                        <article
                          key={workflow.id}
                          className={cn(
                            'rounded-lg border p-3 transition-all',
                            isCurrent ? 'border-accent bg-accent/10' : 'border-panel-border bg-canvas-bg hover:border-gray-600'
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel-bg">
                              <FileText className="h-4 w-4 text-gray-400" />
                            </div>

                            <div className="min-w-0 flex-1">
                              {editingId === workflow.id ? (
                                <input
                                  type="text"
                                  value={editName}
                                  onChange={(event) => setEditName(event.target.value)}
                                  onBlur={() => finishRename(workflow.id)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') finishRename(workflow.id);
                                    if (event.key === 'Escape') setEditingId(null);
                                  }}
                                  autoFocus
                                  className="w-full rounded border border-accent bg-panel-bg px-2 py-1 text-xs text-white focus:outline-none"
                                />
                              ) : (
                                <button onClick={() => startRename(workflow)} className="text-left text-sm font-medium text-white transition-colors hover:text-accent">
                                  {workflow.name}
                                  {isCurrent && <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">当前</span>}
                                </button>
                              )}
                              <div className="mt-1 flex items-center gap-3 text-[10px] text-gray-500">
                                <span className="flex items-center gap-1"><Layers className="h-3 w-3" />{workflow.nodeCount} 节点</span>
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(workflow.updatedAt).toLocaleString('zh-CN')}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              <button onClick={() => handleLoad(workflow)} className="rounded-md bg-accent/20 px-2.5 py-1.5 text-xs text-accent transition-colors hover:bg-accent hover:text-white">
                                打开
                              </button>
                              <IconButton title="复制" onClick={() => handleDuplicate(workflow.id)}><Copy className="h-3.5 w-3.5" /></IconButton>
                              <button onClick={() => toggleVersions(workflow.id)} className="rounded-md px-2 py-1.5 text-xs text-gray-400 transition-colors hover:bg-gray-700/50 hover:text-white">
                                版本
                              </button>
                              <IconButton title="删除" onClick={() => handleDelete(workflow.id)} danger><Trash2 className="h-3.5 w-3.5" /></IconButton>
                            </div>
                          </div>

                          {expandedVersionsId === workflow.id && (
                            <div className="ml-12 mt-2 rounded-lg border border-panel-border bg-panel-bg/70 p-2">
                              {versionsLoadingId === workflow.id ? (
                                <div className="py-3 text-center text-[11px] text-gray-500">加载版本中...</div>
                              ) : versions.length === 0 ? (
                                <div className="py-3 text-center text-[11px] text-gray-500">暂无版本记录。</div>
                              ) : (
                                <div className="space-y-1.5">
                                  <div className="px-1 text-[10px] text-gray-600">已加载 {versions.length}/{versionTotal} 个版本</div>
                                  {versions.map((version) => {
                                    const diff = summarizeWorkflowVersionDiff(workflow, version);
                                    return (
                                      <div key={version.id} className="flex items-center gap-2 rounded-md bg-canvas-bg px-2 py-1.5">
                                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">v{version.versionNumber}</span>
                                        <span className="min-w-0 flex-1 truncate text-[10px] text-gray-400">
                                          {version.source === 'restore' ? '回滚' : version.source === 'create' ? '创建' : '保存'} / {version.nodeCount} 节点 / {new Date(version.createdAt).toLocaleString('zh-CN')} / {diff.label}
                                        </span>
                                        <button onClick={() => handleDuplicateVersion(workflow.id, version)} className="rounded px-2 py-1 text-[10px] text-gray-300 hover:bg-gray-700/60 hover:text-white">
                                          复制
                                        </button>
                                        <button onClick={() => handleRestoreVersion(workflow.id, version)} className="rounded px-2 py-1 text-[10px] text-gray-300 hover:bg-gray-700/60 hover:text-white">
                                          回滚
                                        </button>
                                      </div>
                                    );
                                  })}
                                  {hasMoreVersions && (
                                    <div className="flex justify-center pt-1">
                                      <button
                                        onClick={() => void loadMoreVersions(workflow.id)}
                                        disabled={versionsLoadingMoreId === workflow.id}
                                        className="rounded border border-panel-border px-2.5 py-1 text-[10px] text-gray-300 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {versionsLoadingMoreId === workflow.id ? '加载中...' : '加载更多版本'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                    {hasMoreWorkflows && (
                      <div className="flex justify-center pt-2">
                        <button
                          onClick={() => void loadMoreWorkflows()}
                          disabled={isLoadingMore}
                          className="rounded-md border border-panel-border px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isLoadingMore ? '加载中...' : '加载更多工作流'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6 p-6">
              <div className="space-y-3">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  <Download className="h-3.5 w-3.5" />
                  导出
                </h3>
                <p className="text-[11px] text-gray-500">将当前画布导出为 JSON 文件，用于备份或分享。</p>
                <ActionButton onClick={handleExport} icon={<Download className="h-4 w-4" />}>
                  导出当前工作流为 JSON
                </ActionButton>
              </div>

              <div className="h-px bg-panel-border" />

              <div className="space-y-3">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  <Upload className="h-3.5 w-3.5" />
                  导入
                </h3>
                <p className="text-[11px] text-gray-500">从 JSON 文件导入工作流，支持之前导出的备份文件。</p>
                <ActionButton onClick={handleImportFile} icon={<Upload className="h-4 w-4" />}>
                  从 JSON 文件导入
                </ActionButton>
                {importError && <div className="rounded bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{importError}</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, icon, children, onClick }: { active: boolean; icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-2 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors',
        active ? 'border-accent bg-accent/5 text-accent' : 'border-transparent text-gray-400 hover:bg-gray-700/20 hover:text-gray-300'
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function ActionButton({ children, icon, onClick, primary }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors',
        primary ? 'bg-accent text-white hover:bg-accent-hover' : 'border border-panel-border bg-panel-bg text-gray-300 hover:border-accent hover:text-accent'
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function IconButton({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-700/50',
        danger && 'hover:bg-red-500/10 hover:text-red-400'
      )}
    >
      {children}
    </button>
  );
}
