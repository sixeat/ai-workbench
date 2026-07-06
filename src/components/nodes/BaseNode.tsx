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
import { loadAllAssetCollections } from '../../lib/assetCollectionCache';
import { isSelectableImageAsset } from '../../lib/imageAssetSelection';
import { clearImageInputConfig, imageInputConfigFromAsset } from '../../lib/imageInputConfig';
import { loadCachedModelCapabilities } from '../../lib/modelCapabilityCache';
import { resolveModelCapabilities, summarizeModelCapabilityBadges } from '../../lib/modelCapabilities';
import { isNodeRunImageAsset } from '../../lib/nodeRunDisplay';
import {
  proxyAddAssetToCollection,
  proxyAssetUrl,
  proxyCreateAssetCollection,
  proxyListAssets,
  proxyUploadAsset,
  type ProxyAsset,
  type ProxyAssetCollection,
  type ProxyModelCapabilities,
} from '../../lib/apiProxy';
import { getNodeDefinition } from '../../data/nodeRegistry';
import { getProviderDefaultModels, getProviderTemplate } from '../../data/providerRegistry';
import { useApiStore } from '../../stores/apiStore';
import { useCanvasStore } from '../../stores/canvasStore';
import { useImagePreviewStore } from '../../stores/imagePreviewStore';
import { NODE_COLORS, type NodeRunAssetSummary, type NodeRunSummary as NodeRunSummaryData, type NodeType } from '../../types/nodes';
import { ImageInputNodeBody } from './ImageInputNodeBody';
import { NodeModelSelector } from './NodeModelSelector';
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

function supportsNode(providerId: string, type: NodeType): boolean {
  if (providerId === 'custom') return true;
  const provider = getProviderTemplate(providerId);
  if (!provider) return false;
  if (type === 'shotSplit' || type === 'promptOptimize') return true;
  if (type === 'imageToImage') return provider.supportedNodes.includes('imageGen');
  if (type === 'multiImageVideo') return provider.supportedNodes.includes('videoGen');
  return provider.supportedNodes.includes(type);
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

export function BaseNode({ id, data, selected }: BaseNodeProps) {
  const definition = getNodeDefinition(data.type);
  const color = NODE_COLORS[data.type] || '#6366f1';
  const IconComponent = definition ? ICON_MAP[definition.icon] || Type : Type;
  const editableField = getEditableField(data.type);
  const hasModelSelector = ['textModel', 'imageGen', 'imageToImage', 'videoGen', 'multiImageVideo'].includes(data.type);

  const { updateNodeData, setSelectedNodeId } = useCanvasStore();
  const { instances } = useApiStore();
  const { openPreview } = useImagePreviewStore();
  const [showInstanceSelect, setShowInstanceSelect] = useState(false);
  const [showModelSelect, setShowModelSelect] = useState(false);
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

  const selectedInstance = instances[data.config.instanceId] || null;
  const availableInstances = useMemo(() => {
    if (!hasModelSelector) return [];
    return Object.values(instances).filter((instance) => instance.isEnabled && supportsNode(instance.providerId, data.type));
  }, [instances, hasModelSelector, data.type]);

  const availableModels = useMemo(() => {
    if (!selectedInstance) return [];
    const instanceModels = selectedInstance.models || [];
    if (instanceModels.length > 0) return rankModelsForNode(data.type, instanceModels);
    return rankModelsForNode(data.type, getProviderDefaultModels(selectedInstance.providerId));
  }, [selectedInstance, data.type]);

  const capabilityBadges = useMemo(() => {
    const capabilities = resolveModelCapabilities(capabilityRecords, selectedInstance?.providerId, String(data.config.model || ''));
    return summarizeModelCapabilityBadges(data.type, capabilities, 3);
  }, [capabilityRecords, data.config.model, data.type, selectedInstance?.providerId]);

  useEffect(() => {
    if (!hasModelSelector) return;
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
  }, [hasModelSelector]);

  useEffect(() => {
    if (!runAssetNotice) return;
    const timer = window.setTimeout(() => setRunAssetNotice(''), 1600);
    return () => window.clearTimeout(timer);
  }, [runAssetNotice]);

  const handleInputChange = useCallback(
    (value: string) => {
      if (!editableField) return;
      updateNodeData(id, { config: { ...data.config, [editableField.key]: value } });
    },
    [data.config, editableField, id, updateNodeData]
  );

  const handleSelectInstance = useCallback(
    (instanceId: string) => {
      const instance = instances[instanceId];
      const models = [...(instance?.models || []), ...getProviderDefaultModels(instance?.providerId || '')];
      updateNodeData(id, {
        config: {
          ...data.config,
          instanceId,
          model: rankModelsForNode(data.type, models)[0] || data.config.model || '',
        },
      });
      setShowInstanceSelect(false);
    },
    [data.config, data.type, id, instances, updateNodeData]
  );

  const handleSelectModel = useCallback(
    (model: string) => {
      updateNodeData(id, { config: { ...data.config, model } });
      setShowModelSelect(false);
    },
    [data.config, id, updateNodeData]
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
      onClick={() => setSelectedNodeId(id)}
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
            value={data.config[editableField.key] || ''}
            onChange={(event) => handleInputChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            placeholder={editableField.placeholder}
            rows={2}
            className={cn(
              'mb-2 min-h-[58px] w-full resize-y rounded-lg border border-gray-700/50 bg-gray-800/50 px-2.5 py-2 text-[11px] text-gray-200',
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
          selectedInstance={selectedInstance}
          availableInstances={availableInstances}
          availableModels={availableModels}
          selectedInstanceId={data.config.instanceId}
          selectedModel={data.config.model}
          showInstanceSelect={showInstanceSelect}
          showModelSelect={showModelSelect}
          onToggleInstanceSelect={() => {
            setShowInstanceSelect(!showInstanceSelect);
            setShowModelSelect(false);
          }}
          onToggleModelSelect={() => {
            setShowModelSelect(!showModelSelect);
            setShowInstanceSelect(false);
          }}
          onSelectInstance={handleSelectInstance}
          onSelectModel={handleSelectModel}
          capabilityBadges={capabilityBadges}
        />
      )}
      {hasInputs && <div className="pointer-events-none absolute left-0 top-1/2 h-16 w-1 -translate-y-1/2 rounded-r bg-accent/40 opacity-0 transition-opacity group-hover/node:opacity-100" />}
      {hasOutputs && <div className="pointer-events-none absolute right-0 top-1/2 h-16 w-1 -translate-y-1/2 rounded-l bg-accent/40 opacity-0 transition-opacity group-hover/node:opacity-100" />}
    </div>
  );
}
