import type { Edge, Node } from '@xyflow/react';
import type { NodeData, NodeType } from '../types/nodes';
import type { CanvasSnapshot } from './canvasStoreUtils';

export interface CanvasState {
  nodes: Node<NodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  past: CanvasSnapshot[];
  future: CanvasSnapshot[];

  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => void;
  redo: () => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  updateNodeData: (nodeId: string, data: Partial<NodeData>) => void;
  removeNode: (nodeId: string) => void;
  clearCanvas: () => void;
  setNodes: (nodes: Node<NodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  toggleSelectedNodeId: (id: string) => void;
  setSelectedEdgeIds: (ids: string[]) => void;
  updateEdgeRoute: (edgeId: string, updates: { sourceKey?: string; targetKey?: string }) => void;
  removeSelectedEdges: () => void;
  onNodesChange: (changes: any[]) => void;
  onEdgesChange: (changes: any[]) => void;
  onConnect: (connection: any) => void;
}

export type CanvasSet = (
  partial:
    | CanvasState
    | Partial<CanvasState>
    | ((state: CanvasState) => CanvasState | Partial<CanvasState>),
  replace?: false
) => void;

export type CanvasGet = () => CanvasState;
