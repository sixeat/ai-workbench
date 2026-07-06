import type { Edge, Node } from '@xyflow/react';
import { NODE_LABELS, type NodeData, type NodeType } from '../types/nodes';
import { getDefaultConfig } from '../data/nodeDefaults';
import { generateId } from '../lib/utils';
import { inferConnection, MAIN_INPUT, MAIN_OUTPUT } from '../lib/connectionInference';
import { addCanvasEdge, applyEdgeChanges, applyNodeChanges, withHistory } from './canvasStoreUtils';
import type { CanvasGet, CanvasSet } from './canvasStoreTypes';

export function createCanvasGraphActions(set: CanvasSet, get: CanvasGet) {
  return {
    addNode: (type: NodeType, position: { x: number; y: number }) => {
      const newNode = {
        id: generateId(),
        type: 'custom',
        position,
        data: {
          label: NODE_LABELS[type] || type,
          type,
          config: getDefaultConfig(type),
          inputs: {},
          outputs: {},
          status: 'idle' as const,
        },
      };
      set((state) => withHistory(state, { nodes: [...state.nodes, newNode] }));
    },

    updateNodeData: (nodeId: string, data: Partial<NodeData>) => {
      set((state) => ({
        nodes: state.nodes.map((node) =>
          node.id === nodeId ? {
            ...node,
            data: {
              ...node.data,
              ...data,
              ...(data.config ? { status: 'idle' as const, error: undefined, executionFingerprint: undefined } : {}),
            },
          } : node
        ),
      }));
    },

    removeNode: (nodeId: string) => {
      set((state) =>
        withHistory(state, {
          nodes: state.nodes.filter((node) => node.id !== nodeId),
          edges: state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
          selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
          selectedNodeIds: state.selectedNodeIds.filter((id) => id !== nodeId),
        })
      );
    },

    clearCanvas: () => {
      set((state) => {
        if (state.nodes.length === 0 && state.edges.length === 0) return {};
        return withHistory(state, { nodes: [], edges: [], selectedNodeId: null, selectedNodeIds: [], selectedEdgeIds: [] });
      });
    },

    setNodes: (nodes: Node<NodeData>[]) =>
      set((state) => withHistory(state, { nodes })),

    setEdges: (edges: Edge[]) =>
      set((state) => withHistory(state, { edges })),

    updateEdgeRoute: (edgeId: string, updates: { sourceKey?: string; targetKey?: string }) => {
      set((state) => {
        const existing = state.edges.find((edge) => edge.id === edgeId);
        if (!existing) return {};
        const data = {
          ...((existing.data as Record<string, unknown>) || {}),
          ...updates,
        };
        const label = String(data.targetKey || existing.label || '');
        return withHistory(state, {
          edges: state.edges.map((edge) =>
            edge.id === edgeId
              ? {
                ...edge,
                data,
                label,
              }
              : edge
          ),
        });
      });
    },

    removeSelectedEdges: () => {
      set((state) => {
        if (state.selectedEdgeIds.length === 0) return {};
        return withHistory(state, {
          edges: state.edges.filter((edge) => !state.selectedEdgeIds.includes(edge.id)),
          selectedEdgeIds: [],
        });
      });
    },

    onNodesChange: (changes: any[]) => {
      set((state) => {
        const nextNodes = applyNodeChanges(changes, state.nodes);
        const selectedNodeIds = nextNodes.filter((node) => node.selected).map((node) => node.id);
        const shouldRecord = changes.some((change) => change.type === 'remove' || (change.type === 'position' && change.dragging === false));
        const nextState = {
          nodes: nextNodes,
          selectedNodeIds,
          selectedNodeId: selectedNodeIds[0] || null,
        };
        return shouldRecord ? withHistory({ ...state, nodes: state.nodes }, nextState) : nextState;
      });
    },

    onEdgesChange: (changes: any[]) => {
      set((state) => {
        const selectedEdgeIds = changes
          .filter((change) => change.type === 'select' && change.selected)
          .map((change) => change.id);
        const nextEdges = applyEdgeChanges(changes, state.edges);
        const shouldRecord = changes.some((change) => change.type === 'remove');
        const nextState = {
          edges: nextEdges,
          selectedEdgeIds: selectedEdgeIds.length > 0
            ? selectedEdgeIds
            : changes.some((change) => change.type === 'select')
              ? state.selectedEdgeIds.filter((id) => !changes.some((change) => change.id === id && change.selected === false))
              : state.selectedEdgeIds,
        };
        return shouldRecord ? withHistory(state, nextState) : nextState;
      });
    },

    onConnect: (connection: any) => {
      const state = get();
      const sourceNode = state.nodes.find((node) => node.id === connection.source);
      const targetNode = state.nodes.find((node) => node.id === connection.target);
      if (!sourceNode || !targetNode) return;

      const inferred = inferConnection(sourceNode, targetNode, state.edges);
      const sourceHandle = connection.sourceHandle && connection.sourceHandle !== MAIN_OUTPUT
        ? connection.sourceHandle
        : MAIN_OUTPUT;
      const targetHandle = connection.targetHandle && connection.targetHandle !== MAIN_INPUT
        ? connection.targetHandle
        : MAIN_INPUT;
      const sourceKey = sourceHandle === MAIN_OUTPUT ? inferred.sourceKey : sourceHandle;
      const targetKey = targetHandle === MAIN_INPUT ? inferred.targetKey : targetHandle;

      const exists = state.edges.some(
        (edge) =>
          edge.source === connection.source &&
          edge.target === connection.target &&
          ((edge.data as any)?.sourceKey || edge.sourceHandle) === sourceKey &&
          ((edge.data as any)?.targetKey || edge.targetHandle) === targetKey
      );

      if (exists || connection.source === connection.target) return;
      set((current) => withHistory(current, { edges: addCanvasEdge({ ...connection, sourceHandle, targetHandle, sourceKey, targetKey }, current.edges) }));
    },
  };
}
