import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FC } from 'react';
import {
  Brain,
  ChevronDown,
  Combine,
  Eye,
  FileText,
  FolderOpen,
  Image,
  Library,
  RefreshCw,
  Search,
  Type,
  Video,
  Workflow,
  X,
} from 'lucide-react';
import { getNodeDefinition } from '../../data/nodeRegistry';
import {
  proxyAssetUrl,
  proxyListAssetCollectionTemplates,
  proxyListAssetCollections,
  proxyListAssets,
  type ProxyAsset,
  type ProxyAssetCollection,
  type ProxyAssetCollectionTemplate,
} from '../../lib/apiProxy';
import { categoryLabel } from '../../lib/assetCollections';
import { cn } from '../../lib/utils';
import { useCanvasStore } from '../../stores/canvasStore';
import { listWorkflowPage, type WorkflowProject, type WorkflowStorageLocation } from '../../stores/workflowDb';
import { NODE_CATEGORIES, type NodeData } from '../../types/nodes';

type LeftPanelTab = 'canvas' | 'assets' | 'templates';

type CanvasNode = ReturnType<typeof useCanvasStore.getState>['nodes'][number];

interface NodeGroup {
  id: string;
  label: string;
  nodes: CanvasNode[];
}

const ICON_MAP: Record<string, FC<{ className?: string; style?: CSSProperties }>> = {
  Type,
  Brain,
  Image,
  Video,
  FileText,
  Eye,
  Combine,
};

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-gray-500',
  running: 'bg-rose-400',
  completed: 'bg-emerald-400',
  error: 'bg-red-400',
};

const STORAGE_LABEL: Record<WorkflowStorageLocation, string> = {
  remote: '后端',
  local: '本地',
};

function formatDate(value?: string) {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function assetName(asset: ProxyAsset) {
  return asset.fileName || asset.prompt || `${asset.type} ${asset.id.slice(0, 6)}`;
}

function coverFor(collection: ProxyAssetCollection): ProxyAsset | undefined {
  return collection.assets.find((asset) => asset.id === collection.coverAssetId) || collection.assets[0];
}

function isPreviewableImage(asset?: ProxyAsset): boolean {
  if (!asset) return false;
  return asset.type === 'image' || /\.(png|jpe?g|webp|gif|avif)$/i.test(asset.url || asset.fileName || '');
}

function nodeTone(type: string): string {
  if (type.includes('image')) return 'tone-image';
  if (type.includes('video')) return 'tone-video';
  if (type.includes('Input') || type.includes('Param')) return 'tone-asset';
  if (type.includes('merge') || type.includes('preview')) return 'tone-logic';
  return 'tone-text';
}

function statusTone(status: NodeData['status']): string {
  if (status === 'completed') return 'state-done';
  if (status === 'running') return 'state-running';
  if (status === 'error') return 'state-locked';
  return 'state-ready';
}

export function NodeListPanel({ currentWorkflowName = '当前工作流' }: { currentWorkflowName?: string }) {
  const {
    nodes,
    edges,
    selectedNodeId,
    setSelectedNodeId,
    updateNodeData,
  } = useCanvasStore();
  const [activeTab, setActiveTab] = useState<LeftPanelTab>('canvas');
  const [searchQuery, setSearchQuery] = useState('');
  const [assets, setAssets] = useState<ProxyAsset[]>([]);
  const [assetCollections, setAssetCollections] = useState<ProxyAssetCollection[]>([]);
  const [collectionTemplates, setCollectionTemplates] = useState<ProxyAssetCollectionTemplate[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowProject[]>([]);
  const [workflowStorage, setWorkflowStorage] = useState<WorkflowStorageLocation>('remote');
  const [assetError, setAssetError] = useState('');
  const [workflowError, setWorkflowError] = useState('');
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);

  const loadAssets = useCallback(async () => {
    setLoadingAssets(true);
    setAssetError('');
    try {
      const [collectionData, assetData, templateData] = await Promise.all([
        proxyListAssetCollections({ limit: 14 }),
        proxyListAssets({ limit: 12 }),
        proxyListAssetCollectionTemplates().catch(() => ({ templates: [], count: 0 })),
      ]);
      setAssetCollections(collectionData.collections);
      setAssets(assetData.assets);
      setCollectionTemplates(templateData.templates);
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : '素材加载失败');
    } finally {
      setLoadingAssets(false);
    }
  }, []);

  const loadWorkflows = useCallback(async () => {
    setLoadingWorkflows(true);
    setWorkflowError('');
    try {
      const page = await listWorkflowPage({ limit: 12 });
      setWorkflows(page.workflows);
      setWorkflowStorage(page.storage);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : '模板加载失败');
    } finally {
      setLoadingWorkflows(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'assets') void loadAssets();
    if (activeTab === 'templates') void loadWorkflows();
  }, [activeTab, loadAssets, loadWorkflows]);

  const query = searchQuery.trim().toLowerCase();

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      const definition = getNodeDefinition(node.data.type);
      const model = String(node.data.config?.model || '');
      const label = String(node.data.label ?? definition?.label ?? node.data.type);
      return !query || [label, definition?.label, node.data.type, model]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [nodes, query]);

  const nodeGroups = useMemo<NodeGroup[]>(() => {
    const groups = new Map<string, CanvasNode[]>();
    for (const node of filteredNodes) {
      const definition = getNodeDefinition(node.data.type);
      const category = definition?.category || 'utility';
      groups.set(category, [...(groups.get(category) || []), node]);
    }

    return Array.from(groups.entries())
      .map(([id, groupNodes]) => ({
        id,
        label: NODE_CATEGORIES[id] || id,
        nodes: groupNodes,
      }))
      .sort((a, b) => Object.keys(NODE_CATEGORIES).indexOf(a.id) - Object.keys(NODE_CATEGORIES).indexOf(b.id));
  }, [filteredNodes]);

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => !query || assetName(asset).toLowerCase().includes(query));
  }, [assets, query]);

  const filteredCollections = useMemo(() => {
    return assetCollections.filter((collection) => {
      if (!query) return true;
      return [
        collection.name,
        collection.description,
        collection.category,
        ...collection.assets.map(assetName),
      ].some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [assetCollections, query]);

  const filteredWorkflows = useMemo(() => {
    return workflows.filter((workflow) => !query || workflow.name.toLowerCase().includes(query));
  }, [workflows, query]);

  const incomingCount = (nodeId: string) => edges.filter((edge) => edge.target === nodeId).length;
  const outgoingCount = (nodeId: string) => edges.filter((edge) => edge.source === nodeId).length;

  return (
    <div className="panel left-panel flex h-full flex-col overflow-hidden">
      <div className="panel-header">
        <div className="min-w-0">
          <span className="eyebrow">当前项目</span>
          <h2 className="truncate">{currentWorkflowName}</h2>
        </div>
        <button
          className="icon-button small"
          type="button"
          onClick={() => {
            if (activeTab === 'assets') void loadAssets();
            if (activeTab === 'templates') void loadWorkflows();
          }}
          title="刷新"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="panel-tabs">
        <TabButton active={activeTab === 'canvas'} onClick={() => setActiveTab('canvas')} icon={<BracesIcon />}>画布</TabButton>
        <TabButton active={activeTab === 'assets'} onClick={() => setActiveTab('assets')} icon={<Library className="h-3.5 w-3.5" />}>资产</TabButton>
        <TabButton active={activeTab === 'templates'} onClick={() => setActiveTab('templates')} icon={<Workflow className="h-3.5 w-3.5" />}>模板</TabButton>
      </div>

      <div className="search-box">
        <Search className="h-4 w-4 shrink-0" />
        <div className="relative min-w-0 flex-1">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={activeTab === 'canvas' ? '搜索画布节点' : activeTab === 'assets' ? '搜索素材' : '搜索模板'}
            className="w-full border-0 bg-transparent p-0 text-xs text-white outline-none placeholder:text-[#73808f]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === 'canvas' && (
          <CanvasTree
            groups={nodeGroups}
            incomingCount={incomingCount}
            outgoingCount={outgoingCount}
            selectedNodeId={selectedNodeId}
            setSelectedNodeId={setSelectedNodeId}
            updateNodeData={updateNodeData}
            totalNodes={nodes.length}
          />
        )}

        {activeTab === 'assets' && (
          <AssetList
            assets={filteredAssets}
            collections={filteredCollections}
            collectionTemplates={collectionTemplates}
            error={assetError}
            loading={loadingAssets}
            totalAssets={assets.length}
            totalCollections={assetCollections.length}
          />
        )}

        {activeTab === 'templates' && (
          <WorkflowList
            error={workflowError}
            loading={loadingWorkflows}
            storage={workflowStorage}
            workflows={filteredWorkflows}
          />
        )}
      </div>
    </div>
  );
}

function BracesIcon() {
  return <span className="text-[12px] leading-none">{'{}'}</span>;
}

function TabButton({
  active,
  children,
  icon,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(active && 'active')}
    >
      {icon}
      {children}
    </button>
  );
}

function CanvasTree({
  groups,
  incomingCount,
  outgoingCount,
  selectedNodeId,
  setSelectedNodeId,
  updateNodeData,
  totalNodes,
}: {
  groups: NodeGroup[];
  incomingCount: (nodeId: string) => number;
  outgoingCount: (nodeId: string) => number;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  updateNodeData: (nodeId: string, data: Partial<NodeData>) => void;
  totalNodes: number;
}) {
  return (
    <div className="canvas-tree">
      <div className="canvas-list-toolbar">
        <span>画布元素</span>
        <button type="button">
          全部
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <Search className="h-4 w-4" />
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<Workflow className="h-7 w-7" />}
          text={totalNodes === 0 ? '画布为空，点击底部节点栏添加节点。' : '没有匹配的节点。'}
        />
      ) : (
        <div className="tree-folder">
          {groups.map((group) => (
            <section key={group.id}>
              <div className="tree-folder-row">
                <ChevronDown className="h-4 w-4 text-gray-500" />
                <span className="folder-icon">
                  <FolderOpen className="h-4 w-4" />
                </span>
                <span>{group.label} · {group.nodes.length}</span>
              </div>

              <div className="tree-children">
                {group.nodes.map((node) => (
                  <NodeRow
                    key={node.id}
                    incomingCount={incomingCount(node.id)}
                    node={node}
                    outgoingCount={outgoingCount(node.id)}
                    selected={selectedNodeId === node.id}
                    setSelectedNodeId={setSelectedNodeId}
                    updateNodeData={updateNodeData}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="canvas-tree-footer">
        <span>当前工作流</span>
        <span>共 {totalNodes} 节点</span>
      </div>
    </div>
  );
}

function NodeRow({
  incomingCount,
  node,
  outgoingCount,
  selected,
  setSelectedNodeId,
  updateNodeData,
}: {
  incomingCount: number;
  node: CanvasNode;
  outgoingCount: number;
  selected: boolean;
  setSelectedNodeId: (id: string | null) => void;
  updateNodeData: (nodeId: string, data: Partial<NodeData>) => void;
}) {
  const definition = getNodeDefinition(node.data.type);
  const IconComponent = definition ? ICON_MAP[definition.icon] || Type : Type;
  const color = definition?.color || '#6366f1';
  const label = String(node.data.label ?? definition?.label ?? node.data.type);
  const model = String(node.data.config?.model || definition?.label || node.data.type);
  const tone = nodeTone(node.data.type);

  return (
    <article
      className={cn(
        'tree-node',
        tone,
        selected && 'bg-white/[0.07]'
      )}
      onClick={() => setSelectedNodeId(node.id)}
    >
      <div className="tree-node-thumb" style={{ color }}>
        <IconComponent className="h-4 w-4" />
      </div>
      <label>
        <input
          value={label}
          onClick={(event) => event.stopPropagation()}
          onFocus={() => setSelectedNodeId(node.id)}
          onBlur={(event) => {
            if (!event.target.value.trim()) updateNodeData(node.id, { label: definition?.label || node.data.type });
          }}
          onChange={(event) => updateNodeData(node.id, { label: event.target.value })}
          title="可直接改名"
        />
        <div className="workflow-outline-meta">
          <span className="truncate">{model || definition?.label || node.data.type}</span>
          <span className="shrink-0">入 {incomingCount} / 出 {outgoingCount}</span>
        </div>
      </label>
      <span className={cn('tree-node-status', statusTone(node.data.status), STATUS_DOT[node.data.status])} />
    </article>
  );
}

function AssetList({
  assets,
  collections,
  collectionTemplates,
  error,
  loading,
  totalAssets,
  totalCollections,
}: {
  assets: ProxyAsset[];
  collections: ProxyAssetCollection[];
  collectionTemplates: ProxyAssetCollectionTemplate[];
  error: string;
  loading: boolean;
  totalAssets: number;
  totalCollections: number;
}) {
  if (loading) return <EmptyState icon={<Library className="h-7 w-7" />} text="正在加载素材库..." />;
  if (error) return <EmptyState icon={<Library className="h-7 w-7" />} text={error} />;
  if (collections.length === 0 && assets.length === 0) {
    return <EmptyState icon={<Library className="h-7 w-7" />} text={totalCollections + totalAssets === 0 ? '后端暂无素材。' : '没有匹配的素材。'} />;
  }

  return (
    <div className="space-y-3">
      {collections.length > 0 && (
        <section>
          <div className="mb-1.5 flex justify-between text-[11px] text-gray-400">
            <span>素材集合</span>
            <span>{collections.length}</span>
          </div>
          <div className="space-y-1.5">
            {collections.map((collection) => {
              const cover = coverFor(collection);
              return (
                <article key={collection.id} className="grid grid-cols-[34px_minmax(0,1fr)] gap-2 rounded-md border border-white/10 bg-white/[0.035] p-1.5">
                  <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded bg-black/25">
                    {cover && isPreviewableImage(cover) ? (
                      <img alt={collection.name} className="h-full w-full object-cover" src={proxyAssetUrl(cover.url)} />
                    ) : (
                      <Image className="h-4 w-4 text-gray-500" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-semibold text-white">{collection.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-gray-500">
                      <span>{categoryLabel(collection.category, collectionTemplates)}</span>
                      <span>{collection.assets.length} 项</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {assets.length > 0 && (
        <section>
          <div className="mb-1.5 flex justify-between text-[11px] text-gray-400">
            <span>最近素材</span>
            <span>{assets.length}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {assets.map((asset) => (
              <article key={asset.id} className="min-w-0 rounded-md border border-white/10 bg-white/[0.035] p-1.5">
                <div className="flex aspect-square items-center justify-center overflow-hidden rounded bg-black/25">
                  {isPreviewableImage(asset) ? (
                    <img alt={assetName(asset)} className="h-full w-full object-cover" src={proxyAssetUrl(asset.url)} />
                  ) : asset.type === 'video' ? (
                    <Video className="h-5 w-5 text-rose-300" />
                  ) : (
                    <FileText className="h-5 w-5 text-gray-500" />
                  )}
                </div>
                <div className="mt-1.5 truncate text-[10px] font-medium text-gray-200">{assetName(asset)}</div>
                <div className="mt-0.5 text-[9px] text-gray-500">{formatDate(asset.createdAt)}</div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function WorkflowList({
  error,
  loading,
  storage,
  workflows,
}: {
  error: string;
  loading: boolean;
  storage: WorkflowStorageLocation;
  workflows: WorkflowProject[];
}) {
  if (loading) return <EmptyState icon={<Workflow className="h-7 w-7" />} text="正在加载工作流..." />;
  if (error) return <EmptyState icon={<Workflow className="h-7 w-7" />} text={error} />;
  if (workflows.length === 0) return <EmptyState icon={<Workflow className="h-7 w-7" />} text="后端暂无工作流模板。" />;

  return (
    <div className="space-y-1.5">
      <div className="mb-1 flex items-center justify-between text-[11px] text-gray-400">
        <span>工作流库</span>
        <span>{STORAGE_LABEL[storage]}</span>
      </div>
      {workflows.map((workflow) => (
        <article key={workflow.id} className="rounded-md border border-white/10 bg-white/[0.035] px-2 py-1.5">
          <div className="truncate text-[11px] font-semibold text-white">{workflow.name}</div>
          <div className="mt-1 flex items-center justify-between text-[9px] text-gray-500">
            <span>{workflow.nodeCount} 节点</span>
            <span>{formatDate(workflow.updatedAt)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="py-9 text-center text-gray-500">
      <div className="mx-auto mb-2 flex justify-center opacity-40">{icon}</div>
      <p className="text-xs leading-5">{text}</p>
    </div>
  );
}
