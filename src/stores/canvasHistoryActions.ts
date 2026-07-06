import { snapshot } from './canvasStoreUtils';
import type { CanvasGet, CanvasSet } from './canvasStoreTypes';

export function createCanvasHistoryActions(set: CanvasSet, get: CanvasGet) {
  return {
    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    undo: () => {
      set((state) => {
        const previous = state.past[state.past.length - 1];
        if (!previous) return {};
        return {
          nodes: previous.nodes,
          edges: previous.edges,
          past: state.past.slice(0, -1),
          future: [snapshot(state), ...state.future],
          selectedNodeId: null,
          selectedNodeIds: [],
          selectedEdgeIds: [],
        };
      });
    },

    redo: () => {
      set((state) => {
        const next = state.future[0];
        if (!next) return {};
        return {
          nodes: next.nodes,
          edges: next.edges,
          past: [...state.past, snapshot(state)],
          future: state.future.slice(1),
          selectedNodeId: null,
          selectedNodeIds: [],
          selectedEdgeIds: [],
        };
      });
    },
  };
}
