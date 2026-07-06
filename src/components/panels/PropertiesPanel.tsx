import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, ImagePlus, Loader2, Play, Settings, Trash2 } from 'lucide-react';
import type { Node } from '@xyflow/react';
import { cn } from '../../lib/utils';
import { getNodeDefinition } from '../../data/nodeRegistry';
import { getProviderDefaultModels, getProviderTemplate } from '../../data/providerRegistry';
import { collectUpstreamNodeIds, executeSelectedNodes, executeSingleNode, executeUntilNode } from '../../engine/WorkflowEngine';
import { getNodeConfigSchema, validateNodeConfig } from '../../engine/nodeIoSchema';
import { getEditableEdgeOptions } from '../../lib/connectionInference';
import {
  proxyAddAssetToCollection,
  proxyAddAssetsToCollection,
  proxyAssetUrl,
  type ProxyAssetCollection,
  type ProxyModelCapabilities,
} from '../../lib/apiProxy';
import { collectionHasAsset, filterAssetsNotInCollection, getSuggestedRoles } from '../../lib/assetCollections';
import { loadAllAssetCollections } from '../../lib/assetCollectionCache';
import { loadCachedModelCapabilities } from '../../lib/modelCapabilityCache';
import { API_INSTANCE_SOURCE_LABELS, groupApiInstancesBySource } from '../../lib/apiInstanceDisplay';
import {
  describeModelCapabilities,
  describeModelCapabilityFieldHint,
  resolveModelCapabilities,
  summarizeModelCapabilityUsage,
  validateNodeCapabilityUsage,
} from '../../lib/modelCapabilities';
import { uniqueNodeRunAssetIds } from '../../lib/nodeRunDisplay';
import { useApiStore } from '../../stores/apiStore';
import { useCanvasStore } from '../../stores/canvasStore';
import { NODE_COLORS, type ConfigField, type NodeData, type NodeRunSummary, type NodeType } from '../../types/nodes';

const GENERATIVE_NODE_TYPES = new Set<NodeType>([
  'textModel',
  'script',
  'shotSplit',
  'promptOptimize',
  'imageGen',
  'imageToImage',
  'videoGen',
  'multiImageVideo',
]);

const MODEL_SOURCE_NODE_TYPES = new Set<NodeType>(['script', 'shotSplit', 'promptOptimize']);

function stringConfigValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function inputValue(value: unknown): string | number {
  return typeof value === 'string' || typeof value === 'number' ? value : '';
}

function supportsNode(providerId: string, type: NodeType): boolean {
  if (providerId === 'custom') return true;
  const provider = getProviderTemplate(providerId);
  if (!provider) return false;
  if (type === 'imageToImage') return provider.supportedNodes.includes('imageGen');
  if (type === 'multiImageVideo') return provider.supportedNodes.includes('videoGen');
  return provider.supportedNodes.includes(type);
}

function summarize(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `列表：${value.length} 项`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.type === 'image') return String(record.fileName || record.url || '');
    if (record.type === 'video') return String(record.fileName || record.url || record.id || '');
    if (record.type === 'shotList' && Array.isArray(record.items)) return `ShotList：${record.items.length} 个镜头`;
  }
  return JSON.stringify(value, null, 2);
}

function runStatusLabel(status: NodeRunSummary['status']): string {
  if (status === 'running') return '运行中';
  if (status === 'completed') return '已完成';
  return '失败';
}

function nodeStatusLabel(status: NodeData['status']): string {
  if (status === 'idle') return '待运行';
  if (status === 'running') return '运行中';
  if (status === 'completed') return '已完成';
  return '失败';
}

function formatDuration(value?: number): string {
  if (!value) return '-';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-panel-border bg-canvas-bg/70 p-3">
      <h4 className="text-xs font-medium text-gray-300">{title}</h4>
      {children}
    </div>
  );
}

export function PropertiesPanel() {
  const {
    nodes,
    edges,
    selectedNodeId,
    selectedNodeIds,
    selectedEdgeIds,
    updateNodeData,
    updateEdgeRoute,
    removeNode,
    removeSelectedEdges,
    setSelectedNodeIds,
  } = useCanvasStore();
  const { instances } = useApiStore();
  const [capabilityRecords, setCapabilityRecords] = useState<ProxyModelCapabilities[]>([]);
  const [capabilityError, setCapabilityError] = useState('');
  const [assetCollections, setAssetCollections] = useState<ProxyAssetCollection[]>([]);
  const [assetCollectionId, setAssetCollectionId] = useState('');
  const [assetRole, setAssetRole] = useState('');
  const [assetLibraryNotice, setAssetLibraryNotice] = useState('');
  const [assetLibraryError, setAssetLibraryError] = useState('');
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedNodes = useMemo(
    () => selectedNodeIds
      .map((id) => nodes.find((node) => node.id === id))
      .filter((node): node is Node<NodeData> => Boolean(node)),
    [nodes, selectedNodeIds]
  );
  const selectedEdge = selectedEdgeIds.length === 1 ? edges.find((edge) => edge.id === selectedEdgeIds[0]) : null;
  const definition = selectedNode ? getNodeDefinition(selectedNode.data.type) : null;
  const edgeSourceNode = selectedEdge ? nodes.find((node) => node.id === selectedEdge.source) : null;
  const edgeTargetNode = selectedEdge ? nodes.find((node) => node.id === selectedEdge.target) : null;
  const edgeTargetOptions = edgeTargetNode ? getEditableEdgeOptions(edgeTargetNode) : [];
  const edgeData = (selectedEdge?.data || {}) as { targetKey?: unknown };
  const edgeTargetKey = String(edgeData.targetKey || selectedEdge?.targetHandle || '');
  const selectedInstanceId = stringConfigValue(selectedNode?.data.config?.instanceId);
  const selectedModel = stringConfigValue(selectedNode?.data.config?.model);
  const lastRun = selectedNode?.data.lastRun as NodeRunSummary | undefined;
  const selectedAssetCollection = useMemo(
    () => assetCollections.find((collection) => collection.id === assetCollectionId) || assetCollections[0] || null,
    [assetCollectionId, assetCollections]
  );
  const assetRoles = useMemo(
    () => selectedAssetCollection ? getSuggestedRoles(selectedAssetCollection) : [],
    [selectedAssetCollection]
  );
  const addableRunAssets = useMemo(
    () => lastRun?.assets.filter((asset) => Boolean(asset.id)) || [],
    [lastRun]
  );
  const addableRunAssetIds = useMemo(
    () => uniqueNodeRunAssetIds(addableRunAssets),
    [addableRunAssets]
  );
  const newRunAssets = useMemo(
    () => selectedAssetCollection ? filterAssetsNotInCollection(addableRunAssets, selectedAssetCollection) : addableRunAssets,
    [addableRunAssets, selectedAssetCollection]
  );
  const newRunAssetIds = useMemo(
    () => uniqueNodeRunAssetIds(newRunAssets),
    [newRunAssets]
  );

  const availableInstances = useMemo(() => {
    if (!selectedNode) return [];
    return Object.values(instances).filter((item) => item.isEnabled && supportsNode(item.providerId, selectedNode.data.type));
  }, [instances, selectedNode]);
  const groupedAvailableInstances = useMemo(
    () => groupApiInstancesBySource(availableInstances),
    [availableInstances]
  );

  const modelOptions = useMemo(() => {
    if (!selectedInstanceId) return [];
    const instance = instances[selectedInstanceId];
    if (!instance) return [];
    const models = instance.models.length > 0 ? instance.models : getProviderDefaultModels(instance.providerId);
    return models.map((model: string) => ({ label: model, value: model }));
  }, [instances, selectedInstanceId]);

  const selectedInstance = selectedInstanceId ? instances[selectedInstanceId] : null;
  const modelCapabilities = useMemo(
    () => resolveModelCapabilities(capabilityRecords, selectedInstance?.providerId, selectedModel),
    [capabilityRecords, selectedInstance?.providerId, selectedModel]
  );

  const capabilityRows = useMemo(() => {
    if (!selectedNode) return [];
    return describeModelCapabilities(selectedNode.data.type, modelCapabilities);
  }, [modelCapabilities, selectedNode]);

  const capabilityUsageRows = useMemo(() => {
    if (!selectedNode) return [];
    return summarizeModelCapabilityUsage(selectedNode.data.type, selectedNode.data.config, selectedNode.data.inputs, modelCapabilities);
  }, [modelCapabilities, selectedNode]);

  const capabilityIssues = useMemo(() => {
    if (!selectedNode) return [];
    return validateNodeCapabilityUsage(selectedNode.data.type, selectedNode.data.config, selectedNode.data.inputs, modelCapabilities);
  }, [modelCapabilities, selectedNode]);

  const configSchema = useMemo(() => {
    if (!selectedNode) return null;
    return getNodeConfigSchema(selectedNode.data.type, modelCapabilities);
  }, [modelCapabilities, selectedNode]);

  const configIssues = useMemo(() => {
    if (!selectedNode) return [];
    return validateNodeConfig(selectedNode.data, modelCapabilities).errors;
  }, [modelCapabilities, selectedNode]);

  const selectionStats = useMemo(() => {
    const executionIds = new Set<string>();
    for (const nodeId of selectedNodeIds) {
      for (const upstreamId of collectUpstreamNodeIds(nodeId, edges)) executionIds.add(upstreamId);
    }

    return {
      completedCount: selectedNodes.filter((node) => node.data.status === 'completed').length,
      dependencyCount: [...executionIds].filter((id) => !selectedNodeIds.includes(id)).length,
      executionCount: executionIds.size,
      generativeCount: selectedNodes.filter((node) => GENERATIVE_NODE_TYPES.has(node.data.type)).length,
    };
  }, [edges, selectedNodeIds, selectedNodes]);

  useEffect(() => {
    loadCachedModelCapabilities()
      .then((data) => {
        setCapabilityRecords(data);
        setCapabilityError('');
      })
      .catch((error: unknown) => setCapabilityError(error instanceof Error ? error.message : '模型能力加载失败'));
  }, []);

  useEffect(() => {
    if (addableRunAssets.length === 0) return;
    let cancelled = false;
    loadAllAssetCollections()
      .then((collections) => {
        if (cancelled) return;
        setAssetCollections(collections);
        setAssetCollectionId((current) => current || collections[0]?.id || '');
        setAssetLibraryError('');
      })
      .catch((error: unknown) => {
        if (!cancelled) setAssetLibraryError(error instanceof Error ? error.message : '素材集合加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [addableRunAssets.length, lastRun?.completedAt, lastRun?.taskId]);

  useEffect(() => {
    if (!selectedAssetCollection) {
      setAssetRole('');
      return;
    }
    const roles = getSuggestedRoles(selectedAssetCollection);
    setAssetRole((current) => current && roles.includes(current) ? current : roles[0] || '');
  }, [selectedAssetCollection]);

  useEffect(() => {
    if (!assetLibraryNotice) return;
    const timer = window.setTimeout(() => setAssetLibraryNotice(''), 1600);
    return () => window.clearTimeout(timer);
  }, [assetLibraryNotice]);

  const handleConfigChange = useCallback(
    (key: string, value: unknown) => {
      if (!selectedNodeId || !selectedNode) return;
      updateNodeData(selectedNodeId, { config: { ...selectedNode.data.config, [key]: value } });
    },
    [selectedNodeId, selectedNode, updateNodeData]
  );

  const handleAddRunAssetToCollection = useCallback(
    async (asset: NodeRunSummary['assets'][number]) => {
      if (!asset.id) {
        setAssetLibraryError('这个产物没有资产 ID，暂时不能加入素材集合。');
        return;
      }
      if (selectedAssetCollection && collectionHasAsset(selectedAssetCollection, asset.id)) {
        setAssetLibraryNotice('这个产物已在当前集合中');
        setAssetLibraryError('');
        return;
      }
      const collectionId = selectedAssetCollection?.id;
      if (!collectionId) {
        setAssetLibraryError('请先在素材库创建一个集合。');
        return;
      }

      try {
        await proxyAddAssetToCollection(collectionId, {
          assetId: asset.id,
          role: assetRole || assetRoles[0] || '生成图',
        });
        setAssetLibraryNotice('已加入素材集合');
        setAssetLibraryError('');
      } catch (error) {
        setAssetLibraryError(error instanceof Error ? error.message : '加入素材集合失败');
      }
    },
    [assetRole, assetRoles, selectedAssetCollection]
  );

  const handleAddAllRunAssetsToCollection = useCallback(
    async () => {
      if (newRunAssetIds.length === 0) {
        setAssetLibraryError('最近一次运行没有可入库产物。');
        return;
      }
      const collectionId = selectedAssetCollection?.id;
      if (!collectionId) {
        setAssetLibraryError('请先在素材库创建一个集合。');
        return;
      }

      try {
        const result = await proxyAddAssetsToCollection(collectionId, {
          assetIds: newRunAssetIds,
          role: assetRole || assetRoles[0] || '生成图',
        });
        setAssetLibraryNotice(`已加入 ${result.added} 个产物${result.skipped ? `，跳过 ${result.skipped} 个` : ''}`);
        setAssetLibraryError('');
      } catch (error) {
        setAssetLibraryError(error instanceof Error ? error.message : '批量加入素材集合失败');
      }
    },
    [assetRole, assetRoles, newRunAssetIds, selectedAssetCollection?.id]
  );

  const shouldHideField = (field: ConfigField): boolean => {
    if (!selectedNode) return false;
    const modelSource = String(selectedNode.data.config.modelSource || 'inherit');
    if (MODEL_SOURCE_NODE_TYPES.has(selectedNode.data.type) && ['instanceId', 'model'].includes(field.key) && modelSource !== 'manual') return true;
    if (MODEL_SOURCE_NODE_TYPES.has(selectedNode.data.type) && ['temperature', 'maxTokens'].includes(field.key) && modelSource === 'localOnly') return true;
    return false;
  };

  const renderField = (field: ConfigField) => {
    if (!selectedNode || shouldHideField(field)) return null;
    const value = selectedNode.data.config[field.key] ?? field.defaultValue ?? '';
    const formValue = inputValue(value);
    const booleanValue = Boolean(value);
    const schemaField = configSchema?.fields[field.key];
    const fieldOptions = schemaField?.options || field.options;
    const fieldHint = describeModelCapabilityFieldHint(selectedNode.data.type, field.key, modelCapabilities);

    return (
      <div key={field.key} className="space-y-1">
        <label className="flex items-center gap-1 text-[10px] text-gray-500">
          {field.label}
          {field.required && <span className="text-red-400">*</span>}
        </label>

        {(field.type === 'text' || field.type === 'password') && (
          <input
            type={field.type}
            value={formValue}
            onChange={(event) => handleConfigChange(field.key, event.target.value)}
            placeholder={field.placeholder}
            className="w-full rounded-md border border-panel-border bg-canvas-bg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
          />
        )}

        {field.type === 'textarea' && (
          <textarea
            value={String(formValue)}
            onChange={(event) => handleConfigChange(field.key, event.target.value)}
            placeholder={field.placeholder}
            rows={3}
            className="w-full resize-none rounded-md border border-panel-border bg-canvas-bg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
          />
        )}

        {field.type === 'number' && (
          <input
            type="number"
            value={formValue}
            min={schemaField?.min}
            max={schemaField?.max}
            onChange={(event) => handleConfigChange(field.key, Number(event.target.value))}
            className="w-full rounded-md border border-panel-border bg-canvas-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
          />
        )}

        {field.type === 'select' && (
          <select
            value={String(formValue)}
            onChange={(event) => handleConfigChange(field.key, event.target.value)}
            className="w-full rounded-md border border-panel-border bg-canvas-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
          >
            {field.key === 'instanceId' && (
              <>
                <option value="">选择 API 实例</option>
                <optgroup label={API_INSTANCE_SOURCE_LABELS.platform}>
                  {groupedAvailableInstances.platform.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name} ({getProviderTemplate(inst.providerId)?.name || inst.providerId})
                    </option>
                  ))}
                </optgroup>
                <optgroup label={API_INSTANCE_SOURCE_LABELS.custom}>
                  {groupedAvailableInstances.custom.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name} ({getProviderTemplate(inst.providerId)?.name || inst.providerId})
                    </option>
                  ))}
                </optgroup>
              </>
            )}
            {field.key === 'model' && (
              <>
                <option value="">选择模型</option>
                {modelOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </>
            )}
            {field.key !== 'instanceId' && field.key !== 'model' && fieldOptions?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )}

        {field.type === 'boolean' && (
          <button
            onClick={() => handleConfigChange(field.key, !booleanValue)}
            className={cn('relative h-5 w-10 rounded-full transition-colors', booleanValue ? 'bg-accent' : 'bg-gray-700')}
          >
            <div className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform', booleanValue ? 'left-5' : 'left-0.5')} />
          </button>
        )}

        {fieldHint && (
          <p
            className={cn(
              'text-[10px] leading-4',
              fieldHint.tone === 'neutral' && 'text-gray-500',
              fieldHint.tone === 'success' && 'text-emerald-300',
              fieldHint.tone === 'warning' && 'text-amber-300'
            )}
          >
            {fieldHint.text}
          </p>
        )}
      </div>
    );
  };

  if (selectedEdge && edgeSourceNode && edgeTargetNode) {
    return (
      <div className="flex h-full flex-col">
        <PanelTitle title="连线属性" />
        <div className="flex-1 space-y-4 overflow-auto p-3">
          <Section title="节点连接">
            <div className="space-y-2 text-xs">
              <InfoRow label="来源" value={edgeSourceNode.data.label} />
              <InfoRow label="目标" value={edgeTargetNode.data.label} />
            </div>
          </Section>

          <Section title="连接用途">
            <select
              value={edgeTargetKey}
              onChange={(event) => updateEdgeRoute(selectedEdge.id, { targetKey: event.target.value })}
              className="w-full rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
            >
              {edgeTargetOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-[10px] leading-4 text-gray-500">
              如果自动识别不符合预期，可以在这里把这条线改成 prompt、referenceImage、content 等目标输入。
            </p>
          </Section>
        </div>

        <PanelFooter>
          <DangerButton onClick={removeSelectedEdges} icon={<Trash2 className="h-3.5 w-3.5" />}>
            删除连线
          </DangerButton>
        </PanelFooter>
      </div>
    );
  }

  if (selectedNodeIds.length > 1) {
    return (
      <div className="flex h-full flex-col">
        <PanelTitle title="选区属性" />
        <div className="flex-1 space-y-4 overflow-auto p-3">
          <Section title="本次选区">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Metric label="选中节点" value={selectedNodeIds.length} />
              <Metric label="生成型节点" value={selectionStats.generativeCount} />
              <Metric label="自动补齐依赖" value={selectionStats.dependencyCount} />
              <Metric label="已完成可复用" value={selectionStats.completedCount} />
            </div>
          </Section>

          <Section title="执行规则">
            <p className="text-[11px] leading-5 text-gray-400">
              运行选区会自动向上补齐必要依赖，并按拓扑顺序执行。已完成且输入没有变化的节点会直接复用，不会重复生成。
            </p>
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2 text-[10px] leading-4 text-emerald-200">
              预计参与执行链路：{selectionStats.executionCount} 个节点。实际执行时会跳过可复用节点。
            </div>
          </Section>

          <div className="space-y-2">
            <h4 className="text-xs font-medium text-gray-400">选中的节点</h4>
            {selectedNodes.map((node) => (
              <div key={node.id} className="flex items-center justify-between rounded-md border border-panel-border bg-canvas-bg px-2.5 py-2 text-xs">
                <span className="truncate text-gray-200">{node.data.label}</span>
                <span className="ml-2 shrink-0 text-[10px] text-gray-500">{nodeStatusLabel(node.data.status)}</span>
              </div>
            ))}
          </div>
        </div>

        <PanelFooter>
          <button
            onClick={() => void executeSelectedNodes(selectedNodeIds)}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition-all hover:bg-emerald-500"
          >
            <Play className="h-3.5 w-3.5" />
            运行选区
          </button>
          <button
            onClick={() => setSelectedNodeIds([])}
            className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-xs text-gray-400 transition-colors hover:bg-white/5"
          >
            清空选区
          </button>
        </PanelFooter>
      </div>
    );
  }

  if (!selectedNode || !definition) {
    return (
      <div className="flex h-full flex-col">
        <PanelTitle title="属性面板" />
        <div className="flex flex-1 items-center justify-center text-xs text-gray-500">
          <div className="text-center">
            <Settings className="mx-auto mb-2 h-8 w-8 opacity-30" />
            选择一个节点或连线来编辑属性
          </div>
        </div>
      </div>
    );
  }

  const color = NODE_COLORS[selectedNode.data.type];
  const statusIcon = {
    idle: null,
    running: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />,
    completed: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
    error: <AlertCircle className="h-3.5 w-3.5 text-red-400" />,
  };

  return (
    <div className="flex h-full flex-col">
      <PanelTitle title="属性面板" />

      <div className="flex-1 space-y-4 overflow-auto p-3">
        <div className="flex items-center gap-3 border-b border-panel-border pb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: color }}>
            <span className="text-xs font-bold text-white">{definition.label.charAt(0)}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-white">{definition.label}</div>
            <div className="text-[10px] text-gray-500">{definition.type}</div>
          </div>
          {statusIcon[selectedNode.data.status]}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">状态</span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium',
              selectedNode.data.status === 'idle' && 'bg-gray-700 text-gray-400',
              selectedNode.data.status === 'running' && 'bg-blue-500/20 text-blue-400',
              selectedNode.data.status === 'completed' && 'bg-emerald-500/20 text-emerald-400',
              selectedNode.data.status === 'error' && 'bg-red-500/20 text-red-400'
            )}
          >
            {nodeStatusLabel(selectedNode.data.status)}
          </span>
        </div>

        {lastRun && (
          <Section title="最近运行">
            <div className="flex justify-end">
              <span
                className={cn(
                  '-mt-7 rounded-full px-2 py-0.5 text-[10px]',
                  lastRun.status === 'completed' && 'bg-emerald-500/15 text-emerald-300',
                  lastRun.status === 'running' && 'bg-blue-500/15 text-blue-300',
                  lastRun.status === 'error' && 'bg-red-500/15 text-red-300'
                )}
              >
                {runStatusLabel(lastRun.status)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[10px]">
              <Metric label="任务 ID" value={lastRun.taskId || '-'} title={lastRun.taskId} />
              <Metric label="任务状态" value={lastRun.taskStatus || '-'} title={lastRun.taskStatus} />
              <Metric label="耗时" value={formatDuration(lastRun.durationMs)} />
              <Metric label="模型" value={lastRun.model || '-'} title={lastRun.model} />
              <Metric label="产物" value={lastRun.assetCount} />
            </div>
            {addableRunAssets.length > 0 && (
              <div className="space-y-2 rounded-md border border-panel-border bg-panel-bg/60 p-2">
                <div className="grid grid-cols-[1fr_92px] gap-2">
                  <select
                    value={selectedAssetCollection?.id || ''}
                    onChange={(event) => setAssetCollectionId(event.target.value)}
                    className="min-w-0 rounded-md border border-panel-border bg-canvas-bg px-2 py-1 text-[10px] text-gray-200 focus:border-accent focus:outline-none"
                    title="选择目标素材集合"
                  >
                    {assetCollections.length === 0 ? (
                      <option value="">先创建素材集合</option>
                    ) : (
                      assetCollections.map((collection) => (
                        <option key={collection.id} value={collection.id}>{collection.name}</option>
                      ))
                    )}
                  </select>
                  <select
                    value={assetRole}
                    onChange={(event) => setAssetRole(event.target.value)}
                    className="rounded-md border border-panel-border bg-canvas-bg px-2 py-1 text-[10px] text-gray-200 focus:border-accent focus:outline-none"
                    title="加入集合时的素材角色"
                  >
                    {assetRoles.length === 0 ? (
                      <option value="">生成图</option>
                    ) : (
                      assetRoles.map((role) => <option key={role} value={role}>{role}</option>)
                    )}
                  </select>
                </div>
                {assetLibraryNotice && <div className="text-[10px] text-emerald-300">{assetLibraryNotice}</div>}
                {assetLibraryError && <div className="text-[10px] text-red-300">{assetLibraryError}</div>}
                {addableRunAssetIds.length > 1 && (
                  <button
                    onClick={() => void handleAddAllRunAssetsToCollection()}
                    disabled={!selectedAssetCollection || newRunAssetIds.length === 0}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[10px] text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:border-panel-border disabled:bg-panel-bg disabled:text-gray-600"
                  >
                    <ImagePlus className="h-3 w-3" />
                    {newRunAssetIds.length === 0 ? '全部已在集合中' : `加入全部 ${newRunAssetIds.length} 个产物`}
                  </button>
                )}
              </div>
            )}
            {lastRun.assets.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5">
                {lastRun.assets.slice(0, 8).map((asset, index) => {
                  const alreadyInCollection = selectedAssetCollection ? collectionHasAsset(selectedAssetCollection, asset.id || '') : false;
                  const canAdd = Boolean(asset.id && selectedAssetCollection && !alreadyInCollection);
                  return (
                    <div key={`${asset.url}-${index}`} className="group/asset relative overflow-hidden rounded-md border border-panel-border bg-panel-bg">
                      {asset.type === 'image' ? (
                        <img
                          src={proxyAssetUrl(asset.url)}
                          alt={asset.fileName || '生成图片'}
                          className="h-14 w-full object-cover"
                        />
                      ) : (
                        <a
                          href={proxyAssetUrl(asset.url)}
                          className="flex h-14 items-center justify-center text-[10px] text-gray-300 hover:text-white"
                        >
                          视频
                        </a>
                      )}
                      {asset.id && (
                        <button
                          onClick={() => void handleAddRunAssetToCollection(asset)}
                          disabled={!canAdd}
                          className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded bg-black/75 px-1.5 py-1 text-[9px] text-white opacity-0 backdrop-blur transition-opacity hover:bg-accent disabled:cursor-not-allowed disabled:opacity-0 group-hover/asset:opacity-100"
                          title={alreadyInCollection ? '已在当前素材集合中' : canAdd ? '加入素材集合' : '请先创建素材集合'}
                        >
                          <ImagePlus className="h-3 w-3" />
                          {alreadyInCollection ? '已在集合' : '加入'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {lastRun.error && (
              <div className="rounded-md border border-red-500/20 bg-red-500/10 p-2 text-[10px] leading-4 text-red-200">
                {lastRun.error}
              </div>
            )}
          </Section>
        )}

        {definition.configFields.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-gray-400">配置</h4>
            {configIssues.length > 0 && (
              <div className="space-y-1 rounded-md border border-red-500/20 bg-red-500/10 p-2">
                {configIssues.map((issue) => (
                  <div key={issue} className="text-[10px] leading-4 text-red-200">{issue}</div>
                ))}
              </div>
            )}
            {definition.configFields.map(renderField)}
          </div>
        )}

        {(capabilityRows.length > 0 || capabilityError) && (
          <Section title="模型限制">
            {selectedInstance && (
              <div className="truncate text-[10px] text-gray-500">{getProviderTemplate(selectedInstance.providerId)?.name || selectedInstance.providerId}</div>
            )}
            {capabilityError && <div className="text-[10px] text-red-400">{capabilityError}</div>}
            {capabilityRows.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5">
                {capabilityRows.map((row) => (
                  <Metric key={row.label} label={row.label} value={row.value} title={row.value} />
                ))}
              </div>
            )}
            {capabilityUsageRows.length > 0 && (
              <div className="space-y-1.5 rounded-md border border-panel-border bg-panel-bg/50 p-2">
                <div className="text-[10px] font-medium text-gray-400">本次运行参数</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {capabilityUsageRows.map((row) => (
                    <Metric
                      key={row.label}
                      label={row.label}
                      value={row.value}
                      title={row.value}
                      tone={row.tone}
                    />
                  ))}
                </div>
              </div>
            )}
            {capabilityIssues.length > 0 && (
              <div className="space-y-1 rounded-md border border-amber-500/20 bg-amber-500/10 p-2">
                {capabilityIssues.map((issue) => (
                  <div key={issue} className="text-[10px] leading-4 text-amber-200">{issue}</div>
                ))}
              </div>
            )}
          </Section>
        )}

        {Object.keys(selectedNode.data.inputs).filter((key) => !key.startsWith('__')).length > 0 && (
          <DataBlock title="输入数据" data={selectedNode.data.inputs} />
        )}

        {Object.keys(selectedNode.data.outputs).filter((key) => key !== 'modelContext').length > 0 && (
          <DataBlock title="输出数据" data={selectedNode.data.outputs} hiddenKeys={['modelContext']} />
        )}

        {selectedNode.data.error && (
          <div className="rounded-md border border-red-500/20 bg-red-500/10 p-2.5 text-xs text-red-400">{selectedNode.data.error}</div>
        )}
      </div>

      <PanelFooter>
        <button
          onClick={() => void executeSingleNode(selectedNode.id)}
          disabled={selectedNode.data.status === 'running'}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-all',
            selectedNode.data.status === 'running' ? 'cursor-not-allowed bg-gray-700 text-gray-500' : 'bg-accent text-white hover:bg-accent-hover'
          )}
        >
          <Play className="h-3.5 w-3.5" />
          重跑此节点
        </button>
        <button
          onClick={() => void executeUntilNode(selectedNode.id)}
          disabled={selectedNode.data.status === 'running'}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-all',
            selectedNode.data.status === 'running' ? 'cursor-not-allowed bg-gray-700 text-gray-500' : 'bg-emerald-600 text-white hover:bg-emerald-500'
          )}
        >
          <Play className="h-3.5 w-3.5" />
          运行到此节点（复用已完成）
        </button>
        <DangerButton onClick={() => removeNode(selectedNode.id)} icon={<Trash2 className="h-3.5 w-3.5" />}>
          删除节点
        </DangerButton>
      </PanelFooter>
    </div>
  );
}

function PanelTitle({ title }: { title: string }) {
  return (
    <div className="border-b border-panel-border px-3 py-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</h3>
    </div>
  );
}

function PanelFooter({ children }: { children: ReactNode }) {
  return <div className="space-y-2 border-t border-panel-border px-3 py-3">{children}</div>;
}

function DangerButton({ children, icon, onClick }: { children: ReactNode; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-xs text-red-400 transition-colors hover:bg-red-500/10"
    >
      {icon}
      {children}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-panel-bg/70 px-2 py-1.5">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className="truncate text-gray-200">{value}</div>
    </div>
  );
}

function Metric({ label, value, title, tone = 'neutral' }: { label: string; value: ReactNode; title?: string; tone?: 'neutral' | 'success' | 'warning' }) {
  return (
    <div className="rounded-md bg-panel-bg/70 px-2 py-1.5">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div
        className={cn(
          'truncate',
          tone === 'neutral' && 'text-gray-200',
          tone === 'success' && 'text-emerald-300',
          tone === 'warning' && 'text-amber-300'
        )}
        title={title}
      >
        {value}
      </div>
    </div>
  );
}

function DataBlock({ title, data, hiddenKeys = [] }: { title: string; data: Record<string, unknown>; hiddenKeys?: string[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-gray-400">{title}</h4>
      {Object.entries(data)
        .filter(([key]) => !hiddenKeys.includes(key) && !key.startsWith('__'))
        .map(([key, value]) => (
          <pre key={key} className="max-h-40 overflow-auto rounded-md border border-panel-border bg-canvas-bg p-2 text-[10px] text-gray-400">
            {key}: {summarize(value)}
          </pre>
        ))}
    </div>
  );
}
