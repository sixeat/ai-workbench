import { create } from 'zustand';
import { createCanvasGraphActions } from './canvasGraphActions';
import { createCanvasHistoryActions } from './canvasHistoryActions';
import { createCanvasSelectionActions } from './canvasSelectionActions';
import type { CanvasState } from './canvasStoreTypes';

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedNodeIds: [],
  selectedEdgeIds: [],
  past: [],
  future: [],

  ...createCanvasHistoryActions(set, get),
  ...createCanvasGraphActions(set, get),
  ...createCanvasSelectionActions(set),
}));
