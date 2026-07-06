import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { NODE_CATEGORIES } from '../../types/nodes';
import { NODE_REGISTRY } from '../../data/nodeRegistry';
import { cn } from '../../lib/utils';
import { useCanvasStore } from '../../stores/canvasStore';
import type { NodeDefinition, NodeType } from '../../types/nodes';

const ICON_MAP: Record<string, string> = {
  BadgeCheck: 'Q',
  Ban: '!',
  Brain: 'AI',
  Clapperboard: 'S',
  Combine: '+',
  Eye: 'V',
  FileText: 'T',
  Film: 'M',
  Hash: '#',
  Image: 'I',
  Images: 'MI',
  ListPlus: 'N',
  Maximize2: 'R',
  MessageSquareText: 'P',
  Palette: 'C',
  SlidersHorizontal: '%',
  Sparkles: '*',
  Type: 'T',
  Video: 'V',
};

export function NodePalette() {
  const [showMenu, setShowMenu] = useState(false);
  const [showAdvancedParameters, setShowAdvancedParameters] = useState(false);
  const { addNode } = useCanvasStore();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const menuRef = useRef<HTMLDivElement>(null);

  const groupedNodes = useMemo(() => {
    return NODE_REGISTRY.filter((node) => !node.hidden && node.category !== 'parameter').reduce<Record<string, NodeDefinition[]>>((groups, node) => {
      groups[node.category] = groups[node.category] || [];
      groups[node.category].push(node);
      return groups;
    }, {});
  }, []);

  const parameterNodes = useMemo(() => {
    return NODE_REGISTRY.filter((node) => !node.hidden && node.category === 'parameter');
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setShowMenu(false);
    };
    if (showMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const handleAddNode = useCallback(
    (type: NodeType) => {
      const position = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      position.x += (Math.random() - 0.5) * 80;
      position.y += (Math.random() - 0.5) * 80;
      addNode(type, position);
      setShowMenu(false);
      setTimeout(() => fitView({ padding: 0.3, duration: 300 }), 50);
    },
    [addNode, fitView, screenToFlowPosition]
  );

  const renderNodeButton = (node: NodeDefinition) => (
    <button
      key={node.type}
      onClick={() => handleAddNode(node.type)}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-xs text-gray-300 transition-colors hover:bg-gray-700/40"
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold"
        style={{ backgroundColor: `${node.color}20`, color: node.color }}
      >
        {ICON_MAP[node.icon] || 'N'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-white">{node.label}</div>
        <div className="truncate text-[10px] text-gray-500">{node.description}</div>
      </div>
    </button>
  );

  return (
    <div className="z-40" ref={menuRef}>
      {showMenu && (
        <div className="absolute bottom-full left-1/2 mb-3 max-h-[520px] w-72 -translate-x-1/2 overflow-hidden rounded-xl border border-panel-border bg-panel-bg shadow-2xl">
          <div className="flex items-center justify-between border-b border-panel-border px-3 py-2">
            <span className="text-xs font-medium text-gray-400">选择节点类型</span>
            <button onClick={() => setShowMenu(false)} className="rounded p-0.5 text-gray-500 hover:bg-gray-700/50 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="max-h-[470px] space-y-3 overflow-auto p-2">
            {Object.entries(groupedNodes).map(([category, nodes]) => (
              <div key={category}>
                <div className="px-1 pb-1 text-[10px] font-medium text-gray-500">{NODE_CATEGORIES[category] || category}</div>
                <div className="space-y-0.5">
                  {nodes.map(renderNodeButton)}
                </div>
              </div>
            ))}

            {parameterNodes.length > 0 && (
              <div className="border-t border-panel-border/60 pt-2">
                <button
                  onClick={() => setShowAdvancedParameters((value) => !value)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-gray-400 transition-colors hover:bg-gray-700/30 hover:text-gray-200"
                >
                  <span>
                    高级参数
                    <span className="ml-2 rounded bg-gray-800/70 px-1.5 py-0.5 text-[10px] text-gray-500">
                      {parameterNodes.length}
                    </span>
                  </span>
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showAdvancedParameters && 'rotate-180')} />
                </button>

                {showAdvancedParameters && (
                  <div className="mt-1 space-y-0.5 rounded-lg bg-canvas-bg/40 p-1">
                    {parameterNodes.map(renderNodeButton)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 rounded-full border border-panel-border bg-panel-bg/90 px-2 py-2 shadow-xl shadow-accent/10 backdrop-blur-sm">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-full transition-all',
            showMenu
              ? 'bg-accent text-white shadow-lg shadow-accent/40 ring-2 ring-accent/50'
              : 'bg-gray-700 text-gray-300 shadow-lg ring-2 ring-gray-600/30 hover:bg-gray-600 hover:text-white'
          )}
          title="添加节点"
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
