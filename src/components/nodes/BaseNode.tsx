import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  AlertCircle,
  BadgeCheck,
  Ban,
  Brain,
  CheckCircle2,
  Clapperboard,
  Combine,
  Eye,
  FileText,
  Film,
  Hash,
  Image,
  Images,
  ListPlus,
  Loader2,
  Maximize2,
  MessageSquareText,
  Palette,
  SlidersHorizontal,
  Sparkles,
  Type,
  Video,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { apiInstanceSupportsNode } from '../../lib/apiInstanceCapabilities';
import { loadAllAssetCollections } from '../../lib/assetCollectionCache';
import { isSelectableImageAsset } from '../../lib/imageAssetSelection';
import { clearImageInputConfig, imageInputConfigFromAsset } from '../../lib/imageInputConfig';
import { loadCachedModelCapabilities } from '../../lib/modelCapabilityCache';
import { resolveModelCapabilities, summarizeModelCapabilityBadges } from '../../lib/modelCapabilities';
import { personalModelSupportsNode } from '../../lib/modelCatalog';
import { isNodeRunImageAsset } from '../../lib/nodeRunDisplay';
import {
  proxyAddAssetToCollection,
  proxyAssetUrl,
  proxyCreateAssetCollection,
  proxyGetTask,
  proxyGetVideoTask,
  proxyListAssets,
  proxyUploadAsset,
  type ProxyAsset,
  type ProxyAssetCollection,
  type ProxyModelCapabilities,
  type ProxyTask,
} from '../../lib/apiProxy';
import { getNodeDefinition } from '../../data/nodeRegistry';
import { getProviderDefaultModels } from '../../data/providerRegistry';
import { useApiStore } from '../../stores/apiStore';
import { useCanvasStore } from '../../stores/canvasStore';
import { useImagePreviewStore } from '../../stores/imagePreviewStore';
import { platformModelSupportsNode, usePlatformModelStore } from '../../stores/platformModelStore';
import { useModelCatalogStore } from '../../stores/modelCatalogStore';
import { NODE_COLORS, type NodeRunAssetSummary, type NodeRunSummary as NodeRunSummaryData, type NodeType } from '../../types/nodes';
import { ImageInputNodeBody } from './ImageInputNodeBody';
import { NodeModelSelector, type CustomModelOption } from './NodeModelSelector';
import { NodePreviewContent } from './NodePreviewContent';
import { NodeRunSummary } from './NodeRunSummary';
import { NodeHeader } from './NodeHeader';

const ICON_MAP: Record<string, FC<{ className?: string }>> = {
  BadgeCheck,
  Ban,
  Brain,
  Clapperboard,
  Combine,
  Eye,
  FileText,
  Film,
  Hash,
  Image,
  Images,
  ListPlus,
  Maximize2,
  MessageSquareText,
  Palette,
  SlidersHorizontal,
  Sparkles,
  Type,
  Video,
};

const NODE_OUTPUT_COLLECTION_NAME = '节点产物';
const IMAGE_LIBRARY_PAGE_SIZE = 80;

function hasModelCapabilities(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
}

function isImageModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.includes('image') || normalized.includes('dall-e') || normalized.includes('stable-diffusion');
}

function rankModelsForNode(type: NodeType, models: string[]): string[] {
  if (type === 'imageGen' || type === 'imageToImage') {
    const preferred = models.filter(isImageModel);
    return preferred.length > 0 ? preferred : models;
  }
  if (type === 'textModel' || type === 'script' || type === 'shotSplit' || type === 'promptOptimize') {
    const preferred = models.filter((model) => !isImageModel(model));
    return preferred.length > 0 ? preferred : models;
  }
  return models;
}

function isNodeOutputCollection(collection: ProxyAssetCollection): boolean {
  return collection.name === NODE_OUTPUT_COLLECTION_NAME || collection.metadata?.template === 'node-output';
}

function mergeAssetsById(current: ProxyAsset[], next: ProxyAsset[]): ProxyAsset[] {
  const seen = new Set(current.map((asset) => asset.id));
  const merged = [...current];
  for (const asset of next) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    merged.push(asset);
  }
  return merged;
}

function getEditableField(type: NodeType): { key: string; placeholder: string } | null {
  const map: Partial<Record<NodeType, { key: string; placeholder: string }>> = {
    textInput: { key: 'content', placeholder: '输入内容...' },
    promptParam: { key: 'prompt', placeholder: '输入正向提示词...' },
    negativePromptParam: { key: 'negativePrompt', placeholder: '输入反向提示词...' },
    imageInput: { key: 'url', placeholder: '输入图片 URL...' },
    multiImageInput: { key: 'urls', placeholder: '每行一个图片 URL...' },
    textModel: { key: 'prompt', placeholder: '没有连线时使用的 prompt...' },
    script: { key: 'prompt', placeholder: '输入剧本主题...' },
    imageGen: { key: 'prompt', placeholder: '没有连线时使用的图片 prompt...' },
    imageToImage: { key: 'prompt', placeholder: '输入图生图 prompt...' },
    videoGen: { key: 'prompt', placeholder: '输入视频 prompt...' },
    multiImageVideo: { key: 'prompt', placeholder: '输入镜头描述...' },
  };
  return map[type] || null;
}

interface BaseNodeProps {
  id: string;
  data: {
    label: string;
    type: NodeType;
    config: Record<string, any>;
    inputs: Record<string, any>;
    outputs: Record<string, any>;
    status: 'idle' | 'running' | 'completed' | 'error';
    error?: string;
    executionTime?: number;
    lastRun?: NodeRunSummaryData;
  };
  selected?: boolean;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function taskErrorMessage(task: ProxyTask): string | undefined {
  const error = asRecord(task.error);
  return firstString(error?.message, task.error);
}

function proxyTaskOutput(task: ProxyTask): Record<string, any> {
  return asRecord(task.output) || {};
}

function proxyTaskUpstream(task: ProxyTask): Record<string, any> {
  return asRecord(proxyTaskOutput(task).upstream) || {};
}

function proxyTaskUpstreamTaskId(task: ProxyTask): string {
  const upstream = proxyTaskUpstream(task);
  return firstString(upstream.taskId, upstream.id);
}

function proxyTaskUpstreamStatus(task: ProxyTask): string {
  const upstream = proxyTaskUpstream(task);
  return firstString(upstream.status, upstream.rawStatus);
}

function proxyAssetToRunAsset(asset: ProxyAsset): NodeRunAssetSummary {
  return {
    id: asset.id,
    type: asset.type,
    url: asset.url,
    fileName: asset.fileName,
  };
}

function outputVideoAsset(task: ProxyTask): ProxyAsset | null {
  const video = asRecord(proxyTaskOutput(task).video);
  if (video?.url) {
    return {
      id: firstString(video.id, task.id),
      type: 'video',
      url: String(video.url),
      fileName: firstString(video.fileName),
    };
  }
  return task.assets?.find((asset) => asset.type === 'video' && asset.url) || null;
}

function taskRunAssets(task: ProxyTask): NodeRunAssetSummary[] {
  const assets = (task.assets || []).filter((asset) => asset.url).map(proxyAssetToRunAsset);
  const video = outputVideoAsset(task);
  if (video && !assets.some((asset) => asset.id === video.id || asset.url === video.url)) {
    assets.unshift(proxyAssetToRunAsset(video));
  }
  return assets;
}

function nodeStatusFromTask(task: ProxyTask): BaseNodeProps['data']['status'] {
  if (task.status === 'succeeded') return 'completed';
  if (task.status === 'failed' || task.status === 'cancelled') return 'error';
  return 'running';
}

function runStatusFromTask(task: ProxyTask): NodeRunSummaryData['status'] {
  if (task.status === 'succeeded') return 'completed';
  if (task.status === 'failed' || task.status === 'cancelled') return 'error';
  return 'running';
}

function outputsFromTask(currentOutputs: Record<string, any>, task: ProxyTask): Record<string, any> {
  const upstream = proxyTaskUpstream(task);
  const videoAsset = outputVideoAsset(task);
  const currentVideo = asRecord(currentOutputs.video);
  const nextVideo = videoAsset || currentVideo ? {
    ...(currentVideo || {}),
    type: 'video',
    id: firstString(videoAsset?.id, currentVideo?.id, task.id),
    url: firstString(videoAsset?.url, currentVideo?.url),
    fileName: firstString(videoAsset?.fileName, currentVideo?.fileName),
    createdAt: firstString(currentVideo?.createdAt, task.createdAt),
    status: task.status,
  } : currentOutputs.video;

  return {
    ...currentOutputs,
    ...(nextVideo ? { video: nextVideo } : {}),
    task: {
      ...(asRecord(currentOutputs.task) || {}),
      id: task.id,
      type: task.nodeType === 'video' || task.kind === 'video' ? 'videoTask' : 'task',
      status: task.status,
      providerId: task.providerId,
      model: task.model,
      upstream,
      upstreamTaskId: proxyTaskUpstreamTaskId(task),
      upstreamStatus: proxyTaskUpstreamStatus(task),
      error: task.error,
      updatedAt: task.updatedAt,
    },
  };
}

function lastRunFromTask(current: NodeRunSummaryData | undefined, task: ProxyTask): NodeRunSummaryData {
  const assets = taskRunAssets(task);
  return {
    status: runStatusFromTask(task),
    taskId: task.id,
    taskIds: [...new Set([...(current?.taskIds || []), task.id].filter(Boolean))],
    taskStatus: task.status,
    upstreamTaskId: proxyTaskUpstreamTaskId(task) || current?.upstreamTaskId,
    upstreamStatus: proxyTaskUpstreamStatus(task) || current?.upstreamStatus,
    model: task.model || current?.model,
    providerId: task.providerId || current?.providerId,
    durationMs: task.durationMs ?? current?.durationMs,
    assetCount: assets.length,
    assets,
    error: taskErrorMessage(task),
    startedAt: current?.startedAt || task.createdAt,
    completedAt: task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled'
      ? task.updatedAt
      : current?.completedAt,
  };
}

function shouldQueryVideoUpstream(task: ProxyTask): boolean {
  return (
    (task.nodeType === 'video' || task.kind === 'video')
    && task.status === 'running'
    && Boolean(proxyTaskUpstreamTaskId(task))
  );
}

export function BaseNode({ id, data, selected }: BaseNodeProps) {
  const definition = getNodeDefinition(data.type);
  const color = NODE_COLORS[data.type] || '#6366f1';
  const IconComponent = definition ? ICON_MAP[definition.icon] || Type : Type;
  const editableField = getEditableField(data.type);
  const hasModelSelector = ['textModel', 'imageGen', 'imageToImage', 'videoGen', 'multiImageVideo'].includes(data.type);

  const { updateNodeData, setSelectedNodeId, toggleSelectedNodeId } = useCanvasStore();
  const { instances } = useApiStore();
  const { loadPlatformModels, models: legacyPlatformModels } = usePlatformModelStore();
  const {
    loadCatalog,
    personalModels,
    platformModels: catalogPlatformModels,
  } = useModelCatalogStore();
  const { openPreview } = useImagePreviewStore();
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [editableValue, setEditableValue] = useState(() => editableField ? String(data.config[editableField.key] || '') : '');
  const [isComposingText, setIsComposingText] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [showImageLibrary, setShowImageLibrary] = useState(false);
  const [imageLibraryLoading, setImageLibraryLoading] = useState(false);
  const [imageLibraryError, setImageLibraryError] = useState('');
  const [imageLibraryAssets, setImageLibraryAssets] = useState<ProxyAsset[]>([]);
  const [imageLibraryCollections, setImageLibraryCollections] = useState<ProxyAssetCollection[]>([]);
  const [imageLibraryAssetTotal, setImageLibraryAssetTotal] = useState(0);
  const [imageLibraryLoadedAssetCount, setImageLibraryLoadedAssetCount] = useState(0);
  const [imageLibraryLoadingMore, setImageLibraryLoadingMore] = useState(false);
  const [capabilityRecords, setCapabilityRecords] = useState<ProxyModelCapabilities[]>([]);
  const [addingRunAssetId, setAddingRunAssetId] = useState('');
  const [runAssetNotice, setRunAssetNotice] = useState('');
  const [runAssetError, setRunAssetError] = useState('');
  const [refreshingTaskId, setRefreshingTaskId] = useState('');
  const [taskRefreshNotice, setTaskRefreshNotice] = useState('');
  const [taskRefreshError, setTaskRefreshError] = useState('');

  const platformModels = catalogPlatformModels.length > 0 ? catalogPlatformModels : legacyPlatformModels;
  const selectedPlatformModel = platformModels.find((model) => model.id === data.config.platformModelId) || null;
  const selectedPersonalModel = personalModels.find((model) => model.id === data.config.apiKeyModelId) || null;
  const selectedInstanceId = String(data.config.instanceId || '');
  const selectedInstance = data.config.modelSource === 'platform' || selectedInstanceId.startsWith('server:')
    ? null
    : instances[selectedInstanceId] || null;
  const availableInstances = useMemo(() => {
    if (!hasModelSelector) return [];
    return Object.values(instances).filter((instance) => (
      instance.isEnabled
      && instance.keyScope !== 'server'
      && !instance.id.startsWith('server:')
      && apiInstanceSupportsNode(instance, data.type)
    ));
  }, [instances, hasModelSelector, data.type]);
  const availablePlatformModels = useMemo(() => {
    if (!hasModelSelector) return [];
    return platformModels.filter((model) => platformModelSupportsNode(model, data.type));
  }, [data.type, hasModelSelector, platformModels]);

  const availableCustomModels = useMemo<CustomModelOption[]>(() => {
    const options: CustomModelOption[] = personalModels
      .filter((model) => personalModelSupportsNode(model, data.type))
      .map((model) => ({
        apiKeyModelId: model.id,
        instanceId: `user:${model.apiKeyId}`,
        instanceName: model.apiKey?.name || model.apiKey?.providerId || '我的 API',
        model: model.upstreamModel,
        providerId: model.modelProviderId,
      }));
    const catalogPairs = new Set(options.map((option) => `${option.instanceId}:${option.model}`));
    for (const instance of availableInstances) {
      const sourceModels = instance.models?.length ? instance.models : getProviderDefaultModels(instance.providerId);
      for (const model of rankModelsForNode(data.type, sourceModels)) {
        if (catalogPairs.has(`${instance.id}:${model}`)) continue;
        options.push({
          instanceId: instance.id,
          instanceName: instance.name,
          model,
          providerId: instance.providerId,
        });
      }
    }
    return options;
  }, [availableInstances, data.type, personalModels]);

  const capabilityBadges = useMemo(() => {
    if (hasModelCapabilities(selectedPlatformModel?.capabilities)) {
      return summarizeModelCapabilityBadges(data.type, selectedPlatformModel.capabilities, 3);
    }
    if (hasModelCapabilities(selectedPersonalModel?.capabilities)) {
      return summarizeModelCapabilityBadges(data.type, selectedPersonalModel.capabilities, 3);
    }
    const capabilities = resolveModelCapabilities(capabilityRecords, selectedInstance?.providerId, String(data.config.model || ''));
    return summarizeModelCapabilityBadges(data.type, capabilities, 3);
  }, [capabilityRecords, data.config.model, data.type, selectedInstance?.providerId, selectedPersonalModel?.capabilities, selectedPlatformModel?.capabilities]);

  useEffect(() => {
    if (!hasModelSelector) return;
    void loadPlatformModels();
    void loadCatalog();
    let cancelled = false;
    loadCachedModelCapabilities()
      .then((records) => {
        if (!cancelled) setCapabilityRecords(records);
      })
      .catch(() => {
        if (!cancelled) setCapabilityRecords([]);
      });
    return () => {
      cancelled = true;
    };
  }, [hasModelSelector, loadCatalog, loadPlatformModels]);

  useEffect(() => {
    if (!runAssetNotice) return;
    const timer = window.setTimeout(() => setRunAssetNotice(''), 1600);
    return () => window.clearTimeout(timer);
  }, [runAssetNotice]);

  useEffect(() => {
    if (!taskRefreshNotice) return;
    const timer = window.setTimeout(() => setTaskRefreshNotice(''), 1800);
    return () => window.clearTimeout(timer);
  }, [taskRefreshNotice]);

  const handleInputChange = useCallback(
    (value: string) => {
      if (!editableField) return;
      updateNodeData(id, { config: { ...data.config, [editableField.key]: value } });
    },
    [data.config, editableField, id, updateNodeData]
  );

  useEffect(() => {
    if (!editableField || isComposingText) return;
    setEditableValue(String(data.config[editableField.key] || ''));
  }, [data.config, editableField, isComposingText]);

  const handleSelectCustomModel = useCallback(
    (option: CustomModelOption) => {
      updateNodeData(id, {
        config: {
          ...data.config,
          modelSource: 'custom',
          platformModelId: '',
          apiKeyModelId: option.apiKeyModelId || '',
          modelSelection: option.apiKeyModelId
            ? { source: 'personal', apiKeyModelId: option.apiKeyModelId }
            : undefined,
          instanceId: option.instanceId,
          model: option.model,
        },
      });
      setShowModelSelect(false);
    },
    [data.config, id, updateNodeData]
  );

  const handleSelectPlatformModel = useCallback(
    (platformModelId: string) => {
      const model = platformModels.find((item) => item.id === platformModelId);
      updateNodeData(id, {
        config: {
          ...data.config,
          modelSource: 'platform',
          platformModelId,
          apiKeyModelId: '',
          modelSelection: { source: 'platform', platformModelId },
          instanceId: '',
          model: model?.model || data.config.model || '',
        },
      });
      setShowModelSelect(false);
    },
    [data.config, id, platformModels, updateNodeData]
  );

  const handleUploadImage = useCallback(
    async (file: File | null) => {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        setUploadError('请选择图片文件');
        return;
      }

      setUploadingImage(true);
      setUploadError('');

      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('图片读取失败'));
          reader.readAsDataURL(file);
        });
        const { asset } = await proxyUploadAsset({
          dataUrl,
          fileName: file.name,
          prompt: data.config.prompt || '',
        });
        updateNodeData(id, {
          config: imageInputConfigFromAsset(data.config, { ...asset, fileName: asset.fileName || file.name }),
        });
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : '图片上传失败');
      } finally {
        setUploadingImage(false);
      }
    },
    [data.config, id, updateNodeData]
  );

  const loadImageLibrary = useCallback(async () => {
    setImageLibraryLoading(true);
    setImageLibraryError('');
    try {
      const [collections, assetData] = await Promise.all([
        loadAllAssetCollections(),
        proxyListAssets({ limit: IMAGE_LIBRARY_PAGE_SIZE, offset: 0 }),
      ]);
      setImageLibraryCollections(collections.map((collection) => ({
        ...collection,
        assets: collection.assets.filter(isSelectableImageAsset),
      })));
      setImageLibraryAssets(assetData.assets.filter(isSelectableImageAsset));
      setImageLibraryAssetTotal(assetData.total ?? assetData.count);
      setImageLibraryLoadedAssetCount(assetData.assets.length);
    } catch (error) {
      setImageLibraryError(error instanceof Error ? error.message : '素材库加载失败');
    } finally {
      setImageLibraryLoading(false);
    }
  }, []);

  const loadMoreImageLibraryAssets = useCallback(async () => {
    setImageLibraryLoadingMore(true);
    setImageLibraryError('');
    try {
      const assetData = await proxyListAssets({
        limit: IMAGE_LIBRARY_PAGE_SIZE,
        offset: imageLibraryLoadedAssetCount,
      });
      setImageLibraryAssets((current) => mergeAssetsById(current, assetData.assets.filter(isSelectableImageAsset)));
      setImageLibraryAssetTotal(assetData.total ?? assetData.count);
      setImageLibraryLoadedAssetCount((current) => current + assetData.assets.length);
    } catch (error) {
      setImageLibraryError(error instanceof Error ? error.message : '素材库加载失败');
    } finally {
      setImageLibraryLoadingMore(false);
    }
  }, [imageLibraryLoadedAssetCount]);

  const handleOpenImageLibrary = useCallback(() => {
    setShowImageLibrary(true);
    void loadImageLibrary();
  }, [loadImageLibrary]);

  const handleSelectLibraryAsset = useCallback(
    (asset: ProxyAsset) => {
      updateNodeData(id, {
        config: imageInputConfigFromAsset(data.config, asset),
      });
      setShowImageLibrary(false);
    },
    [data.config, id, updateNodeData]
  );

  const ensureNodeOutputCollection = useCallback(async (): Promise<ProxyAssetCollection> => {
    const collections = await loadAllAssetCollections();
    const existing = collections.find(isNodeOutputCollection);
    if (existing) return existing;

    const { collection } = await proxyCreateAssetCollection({
      name: NODE_OUTPUT_COLLECTION_NAME,
      description: '从节点卡片快速加入的生成产物。',
      category: 'reference-group',
      metadata: {
        template: 'node-output',
        suggestedRoles: ['节点产物', '生成图', '参考图', '首帧', '尾帧'],
      },
    });
    return collection;
  }, []);

  const handleAddRunAssetToCollection = useCallback(
    async (asset: NodeRunAssetSummary) => {
      if (!asset.id) {
        setRunAssetError('这个产物没有资产 ID，暂时不能入库。');
        return;
      }

      setAddingRunAssetId(asset.id);
      setRunAssetError('');
      setRunAssetNotice('');

      try {
        const collection = await ensureNodeOutputCollection();
        await proxyAddAssetToCollection(collection.id, {
          assetId: asset.id,
          role: '节点产物',
          note: `来自节点 ${data.label}`,
        });
        setRunAssetNotice(`已加入「${collection.name}」`);
      } catch (error) {
        setRunAssetError(error instanceof Error ? error.message : '加入素材集合失败');
      } finally {
        setAddingRunAssetId('');
      }
    },
    [data.label, ensureNodeOutputCollection]
  );

  const applyTaskToNode = useCallback(
    (task: ProxyTask) => {
      const nextStatus = nodeStatusFromTask(task);
      updateNodeData(id, {
        status: nextStatus,
        outputs: outputsFromTask(data.outputs, task),
        lastRun: lastRunFromTask(data.lastRun, task),
        executionTime: task.durationMs ?? data.executionTime,
        error: nextStatus === 'error' ? taskErrorMessage(task) : undefined,
      });

      if (task.status === 'succeeded') {
        setTaskRefreshNotice('任务已完成，产物已同步。');
      } else if (task.status === 'failed' || task.status === 'cancelled') {
        setTaskRefreshError(taskErrorMessage(task) || `任务状态为 ${task.status}`);
      } else if (proxyTaskUpstreamTaskId(task)) {
        setTaskRefreshNotice('上游仍在生成，稍后再刷新。');
      } else {
        setTaskRefreshNotice('任务仍在排队，等待后端提交上游。');
      }
    },
    [data.executionTime, data.lastRun, data.outputs, id, updateNodeData]
  );

  const handleRefreshTask = useCallback(
    async (taskId: string) => {
      setRefreshingTaskId(taskId);
      setTaskRefreshNotice('');
      setTaskRefreshError('');

      try {
        const local = await proxyGetTask(taskId);
        let task = local.task;
        if (shouldQueryVideoUpstream(task)) {
          const video = await proxyGetVideoTask(task.id);
          task = video.task || task;
        }
        applyTaskToNode(task);
      } catch (error) {
        try {
          const fallback = await proxyGetTask(taskId);
          applyTaskToNode(fallback.task);
        } catch {
          setTaskRefreshError(error instanceof Error ? error.message : '任务状态刷新失败');
        }
      } finally {
        setRefreshingTaskId('');
      }
    },
    [applyTaskToNode]
  );

  const statusIcon = {
    idle: null,
    running: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />,
    completed: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
    error: <AlertCircle className="h-3.5 w-3.5 text-red-400" />,
  };

  const previewContent = data.outputs?.content ?? data.inputs?.content ?? data.outputs?.image ?? data.outputs?.images ?? data.outputs?.shotList ?? data.outputs?.text;
  const hasInputs = (definition?.inputs.length || 0) > 0;
  const hasOutputs = (definition?.outputs.length || 0) > 0;
  const baseHeight = data.type === 'imageGen' ? 270 : 180;
  const minHeight = baseHeight + (hasModelSelector ? 42 : 0);

  return (
    <div
      onClick={(event) => {
        if (event.shiftKey || event.ctrlKey || event.metaKey) {
          toggleSelectedNodeId(id);
        } else {
          setSelectedNodeId(id);
        }
      }}
      className={cn(
        'group/node relative min-w-[240px] max-w-[330px] rounded-xl border bg-panel-bg shadow-lg transition-all duration-200',
        selected ? 'border-accent shadow-xl shadow-accent/20 ring-1 ring-accent/50' : 'border-panel-border hover:border-gray-600',
        data.status === 'running' && 'ring-1 ring-blue-500/50',
        data.status === 'error' && 'ring-1 ring-red-500/50'
      )}
      style={{ minHeight }}
    >
      {hasInputs && (
        <Handle
          type="target"
          position={Position.Left}
          id="__main_input"
          className="!h-full !w-8 !rounded-none !border-0 !bg-transparent !opacity-0"
          style={{ left: '-12px', top: '50%', transform: 'translateY(-50%)' }}
        />
      )}

      {hasOutputs && (
        <Handle
          type="source"
          position={Position.Right}
          id="__main_output"
          className="!h-full !w-8 !rounded-none !border-0 !bg-transparent !opacity-0"
          style={{ right: '-12px', top: '50%', transform: 'translateY(-50%)' }}
        />
      )}

      <NodeHeader label={data.label} color={color} icon={IconComponent} statusIcon={statusIcon[data.status]} />

      <div className="px-3 py-2">
        {editableField && data.type !== 'imageInput' && (
          <textarea
            value={editableValue}
            onChange={(event) => {
              const nextValue = event.target.value;
              setEditableValue(nextValue);
              const nativeInputEvent = event.nativeEvent as InputEvent;
              if (!isComposingText && !nativeInputEvent.isComposing) handleInputChange(nextValue);
            }}
            onCompositionStart={() => setIsComposingText(true)}
            onCompositionEnd={(event) => {
              const nextValue = event.currentTarget.value;
              setIsComposingText(false);
              handleInputChange(nextValue);
            }}
            onBlur={() => {
              if (!isComposingText) handleInputChange(editableValue);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            placeholder={editableField.placeholder}
            rows={2}
            className={cn(
              'nodrag nowheel mb-2 min-h-[58px] w-full resize-y rounded-lg border border-gray-700/50 bg-gray-800/50 px-2.5 py-2 text-[11px] text-gray-200',
              'placeholder:text-gray-600 focus:border-accent/50 focus:outline-none'
            )}
          />
        )}

        {data.type === 'imageInput' && (
          <ImageInputNodeBody
            url={data.config.url}
            fileName={data.config.fileName}
            libraryAssets={imageLibraryAssets}
            libraryCollections={imageLibraryCollections}
            libraryLoading={imageLibraryLoading}
            libraryError={imageLibraryError}
            libraryHasMore={imageLibraryLoadedAssetCount < imageLibraryAssetTotal}
            libraryLoadingMore={imageLibraryLoadingMore}
            libraryLoadedCount={imageLibraryLoadedAssetCount}
            libraryTotal={imageLibraryAssetTotal}
            showLibraryPicker={showImageLibrary}
            uploadError={uploadError}
            uploadingImage={uploadingImage}
            onUrlChange={handleInputChange}
            onUploadImage={(file) => void handleUploadImage(file)}
            onOpenLibraryPicker={handleOpenImageLibrary}
            onCloseLibraryPicker={() => setShowImageLibrary(false)}
            onLoadMoreLibraryAssets={() => void loadMoreImageLibraryAssets()}
            onSelectLibraryAsset={handleSelectLibraryAsset}
            onOpenPreview={() => openPreview(proxyAssetUrl(data.config.url), data.config.fileName || '参考图')}
            onRemoveImage={() => {
              setShowImageLibrary(false);
              updateNodeData(id, { config: clearImageInputConfig(data.config) });
            }}
          />
        )}

        <NodeRunSummary
          type={data.type}
          config={data.config}
          inputs={data.inputs}
          lastRun={data.lastRun}
          onOpenAsset={(asset) => {
            const url = proxyAssetUrl(asset.url);
            if (isNodeRunImageAsset(asset)) {
              openPreview(url, asset.fileName || asset.id || '产物');
              return;
            }
            window.open(url, '_blank', 'noopener,noreferrer');
          }}
          onAddAsset={(asset) => void handleAddRunAssetToCollection(asset)}
          onRefreshTask={(taskId) => void handleRefreshTask(taskId)}
          refreshingTaskId={refreshingTaskId}
          taskRefreshNotice={taskRefreshNotice}
          taskRefreshError={taskRefreshError}
          addingAssetId={addingRunAssetId}
          assetActionNotice={runAssetNotice}
          assetActionError={runAssetError}
        />

        {data.type === 'preview' && previewContent && (
          <NodePreviewContent content={previewContent} onOpenPreview={openPreview} />
        )}

        {data.error && <div className="rounded bg-red-500/10 px-1.5 py-1 text-[10px] text-red-400">{data.error}</div>}
      </div>

      {hasModelSelector && (
        <NodeModelSelector
          selectedPlatformModel={selectedPlatformModel}
          availablePlatformModels={availablePlatformModels}
          availableCustomModels={availableCustomModels}
          selectedInstanceId={data.config.instanceId}
          selectedApiKeyModelId={data.config.apiKeyModelId}
          selectedPlatformModelId={data.config.platformModelId}
          selectedModel={data.config.model}
          showModelSelect={showModelSelect}
          onToggleModelSelect={() => {
            setShowModelSelect(!showModelSelect);
          }}
          onSelectCustomModel={handleSelectCustomModel}
          onSelectPlatformModel={handleSelectPlatformModel}
          capabilityBadges={capabilityBadges}
        />
      )}
      {hasInputs && <div className="pointer-events-none absolute left-0 top-1/2 h-16 w-1 -translate-y-1/2 rounded-r bg-accent/40 opacity-0 transition-opacity group-hover/node:opacity-100" />}
      {hasOutputs && <div className="pointer-events-none absolute right-0 top-1/2 h-16 w-1 -translate-y-1/2 rounded-l bg-accent/40 opacity-0 transition-opacity group-hover/node:opacity-100" />}
    </div>
  );
}
