import type { Edge, Node } from '@xyflow/react';
import type { NodeData } from '../types/nodes';
import { generateId } from '../lib/utils';

export interface CanvasSnapshot {
  nodes: Node<NodeData>[];
  edges: Edge[];
}

export interface CanvasHistoryState {
  nodes: Node<NodeData>[];
  edges: Edge[];
  past: CanvasSnapshot[];
  future: CanvasSnapshot[];
}

export function snapshot(state: Pick<CanvasHistoryState, 'nodes' | 'edges'>): CanvasSnapshot {
  return {
    nodes: structuredClone(state.nodes),
    edges: structuredClone(state.edges),
  };
}

export function withHistory<T extends CanvasHistoryState>(
  state: T,
  next: Partial<T>
): Partial<T> {
  return {
    ...next,
    past: [...state.past.slice(-49), snapshot(state)],
    future: [],
  };
}

export function applyNodeChanges(changes: any[], nodes: Node<NodeData>[]): Node<NodeData>[] {
  let updatedNodes = [...nodes];

  for (const change of changes) {
    if (change.type === 'remove') {
      updatedNodes = updatedNodes.filter((node) => node.id !== change.id);
    } else if (change.type === 'position') {
      updatedNodes = updatedNodes.map((node) =>
        node.id === change.id ? { ...node, position: change.position } : node
      );
    } else if (change.type === 'select') {
      updatedNodes = updatedNodes.map((node) =>
        node.id === change.id ? { ...node, selected: change.selected } : node
      );
    }
  }

  return updatedNodes;
}

export function applyEdgeChanges(changes: any[], edges: Edge[]): Edge[] {
  let updatedEdges = [...edges];

  for (const change of changes) {
    if (change.type === 'remove') {
      updatedEdges = updatedEdges.filter((edge) => edge.id !== change.id);
    } else if (change.type === 'select') {
      updatedEdges = updatedEdges.map((edge) =>
        edge.id === change.id ? { ...edge, selected: change.selected } : edge
      );
    }
  }

  return updatedEdges;
}

export function addCanvasEdge(connection: any, edges: Edge[]): Edge[] {
  return [
    ...edges,
    {
      id: generateId(),
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      label: connection.targetKey,
      data: {
        sourceKey: connection.sourceKey,
        targetKey: connection.targetKey,
      },
    },
  ];
}
