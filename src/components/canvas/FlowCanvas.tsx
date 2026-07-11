import { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BaseNode } from '../nodes/BaseNode';
import { useCanvasStore } from '../../stores/canvasStore';
import { CanvasToolbar } from './CanvasToolbar';
import { NodePalette } from '../panels/NodePalette';
import { SmartEdge } from './SmartEdge';
import type { NodeType } from '../../types/nodes';
import { NODE_COLORS } from '../../types/nodes';

const nodeTypes: NodeTypes = {
  custom: BaseNode,
};

const edgeTypes: EdgeTypes = {
  smart: SmartEdge,
};

export function FlowCanvas() {
  const {
    nodes,
    edges,
    selectedEdgeIds,
    setSelectedNodeId,
    setSelectedNodeIds,
    toggleSelectedNodeId,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    setSelectedEdgeIds,
    removeSelectedEdges,
    undo,
    redo,
  } = useCanvasStore();

  const styledEdges = edges.map((edge) => {
    const selected = selectedEdgeIds.includes(edge.id);
    return {
      ...edge,
      type: 'smart',
      selected,
      animated: true,
      interactionWidth: 28,
    };
  });

  const onNodeClick = useCallback((event: React.MouseEvent, node: any) => {
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      toggleSelectedNodeId(node.id);
    } else {
      setSelectedNodeId(node.id);
    }
    setSelectedEdgeIds([]);
  }, [setSelectedEdgeIds, setSelectedNodeId, toggleSelectedNodeId]);

  const onPaneClick = useCallback(() => {
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
  }, [setSelectedEdgeIds, setSelectedNodeIds]);

  const onEdgeClick = useCallback((event: React.MouseEvent, edge: any) => {
    event.stopPropagation();
    setSelectedNodeIds([]);
    setSelectedEdgeIds([edge.id]);
  }, [setSelectedEdgeIds, setSelectedNodeIds]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
        event.preventDefault();
        redo();
        return;
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      removeSelectedEdges();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [redo, removeSelectedEdges, undo]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type =
        event.dataTransfer.getData('application/reactflow') ||
        event.dataTransfer.getData('text/plain') ||
        event.dataTransfer.getData('text');
      if (!type) return;

      addNode(type as NodeType, { x: 300, y: 200 });
    },
    [addNode]
  );

  return (
    <div className="h-full w-full relative bg-canvas-bg min-h-[500px]">
      <ReactFlow
        style={{ height: '100%', width: '100%' }}
        nodes={nodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smart',
          animated: true,
          selectable: true,
          interactionWidth: 28,
        }}
        proOptions={{ hideAttribution: true }}
        className="bg-canvas-bg"
        deleteKeyCode={['Backspace', 'Delete']}
        selectionKeyCode={null}
        multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
        selectionOnDrag
      >
        <Background
          color="#2a2a2e"
          gap={20}
          size={1}
          className="bg-canvas-bg"
        />
        <Controls
          className="!bg-panel-bg !border-panel-border !shadow-lg"
          style={{
            button: {
              backgroundColor: '#1a1a1e',
              color: '#e2e8f0',
              borderColor: 'var(--line-soft)'
            }
          } as any}
        />
        <MiniMap
          className="!bg-panel-bg !border-panel-border !rounded-lg !shadow-lg"
          nodeColor={(node) => {
            return NODE_COLORS[node.data?.type as NodeType] || '#6366f1';
          }}
          maskColor="rgba(15, 15, 17, 0.8)"
          style={{
            backgroundColor: '#1a1a1e',
            border: '1px solid var(--line-soft)',
            borderRadius: '8px'
          }}
        />

        <Panel position="top-center" className="m-0">
          <CanvasToolbar />
        </Panel>

        <Panel position="bottom-center" className="m-0">
          <NodePalette />
        </Panel>
      </ReactFlow>
    </div>
  );
}
