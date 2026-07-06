import { useState, type CSSProperties, type FC } from 'react';
import {
  Brain,
  Combine,
  Eye,
  FileText,
  GripVertical,
  Image,
  Layers,
  Search,
  Trash2,
  Type,
  Video,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useCanvasStore } from '../../stores/canvasStore';
import { getNodeDefinition } from '../../data/nodeRegistry';

const ICON_MAP: Record<string, FC<{ className?: string; style?: CSSProperties }>> = {
  Type,
  Brain,
  Image,
  Video,
  FileText,
  Eye,
  Combine,
};

export function NodeListPanel() {
  const { nodes, edges, selectedNodeId, setSelectedNodeId, removeNode } = useCanvasStore();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredNodes = nodes.filter((node) => {
    const definition = getNodeDefinition(node.data.type);
    const label = node.data.label || definition?.label || node.data.type;
    return label.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const getNodeConnections = (nodeId: string) => {
    const incoming = edges.filter((edge) => edge.target === nodeId).length;
    const outgoing = edges.filter((edge) => edge.source === nodeId).length;
    return { incoming, outgoing };
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-panel-border px-3 py-2.5">
        <Layers className="h-3.5 w-3.5 text-gray-400" />
        <span className="flex-1 text-xs font-semibold text-gray-300">节点列表</span>
        <span className="rounded bg-gray-800/50 px-1.5 py-0.5 text-[10px] text-gray-500">{nodes.length}</span>
      </div>

      <div className="border-b border-panel-border px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索节点..."
            className={cn(
              'w-full rounded-lg py-1.5 pl-7 pr-7 text-[11px]',
              'border border-gray-700/50 bg-gray-800/50 text-gray-200',
              'placeholder:text-gray-600 focus:border-accent/50 focus:outline-none',
              'transition-colors'
            )}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-auto p-2">
        {filteredNodes.length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            {nodes.length === 0 ? (
              <div>
                <Layers className="mx-auto mb-2 h-8 w-8 opacity-30" />
                <p className="text-[11px]">画布为空</p>
                <p className="mt-1 text-[10px]">点击底部加号添加节点</p>
              </div>
            ) : (
              <p className="text-[11px]">没有匹配的节点</p>
            )}
          </div>
        ) : (
          filteredNodes.map((node) => {
            const definition = getNodeDefinition(node.data.type);
            const IconComponent = definition ? ICON_MAP[definition.icon] || Type : Type;
            const color = definition?.color || '#6366f1';
            const isSelected = selectedNodeId === node.id;
            const connections = getNodeConnections(node.id);
            const statusColor = {
              idle: 'bg-gray-500',
              running: 'animate-pulse bg-blue-400',
              completed: 'bg-emerald-400',
              error: 'bg-red-400',
            }[node.data.status];

            return (
              <div
                key={node.id}
                onClick={() => setSelectedNodeId(node.id)}
                className={cn(
                  'group flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 transition-all',
                  isSelected ? 'border-accent/30 bg-accent/10' : 'hover:border-gray-700/50 hover:bg-gray-800/50'
                )}
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: `${color}20` }}>
                  <IconComponent className="h-3 w-3" style={{ color }} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[11px] font-medium text-gray-200">{node.data.label || definition?.label}</span>
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusColor)} />
                  </div>
                  <div className="flex items-center gap-2 text-[9px] text-gray-500">
                    {connections.incoming === 0 && connections.outgoing === 0 ? (
                      <span>无连接</span>
                    ) : (
                      <span>入 {connections.incoming} / 出 {connections.outgoing}</span>
                    )}
                    {Boolean(node.data.config?.model) && <span className="truncate">{String(node.data.config.model)}</span>}
                  </div>
                </div>

                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    removeNode(node.id);
                  }}
                  className="rounded p-1 text-gray-500 opacity-0 transition-colors hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                  title="删除节点"
                >
                  <Trash2 className="h-3 w-3" />
                </button>

                <GripVertical className="h-3 w-3 shrink-0 text-gray-600 opacity-0 group-hover:opacity-100" />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
