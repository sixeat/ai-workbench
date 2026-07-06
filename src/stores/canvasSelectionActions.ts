import type { CanvasSet } from './canvasStoreTypes';

export function createCanvasSelectionActions(set: CanvasSet) {
  return {
    setSelectedNodeId: (id: string | null) => set((state) => ({
      selectedNodeId: id,
      selectedNodeIds: id ? [id] : [],
      nodes: state.nodes.map((node) => ({ ...node, selected: node.id === id })),
    })),

    setSelectedNodeIds: (ids: string[]) => set((state) => {
      const validIds = ids.filter((id) => state.nodes.some((node) => node.id === id));
      const uniqueIds = Array.from(new Set(validIds));
      return {
        selectedNodeId: uniqueIds[0] || null,
        selectedNodeIds: uniqueIds,
        nodes: state.nodes.map((node) => ({ ...node, selected: uniqueIds.includes(node.id) })),
      };
    }),

    toggleSelectedNodeId: (id: string) => set((state) => {
      const nextIds = state.selectedNodeIds.includes(id)
        ? state.selectedNodeIds.filter((item) => item !== id)
        : [...state.selectedNodeIds, id];
      return {
        selectedNodeId: nextIds[0] || null,
        selectedNodeIds: nextIds,
        nodes: state.nodes.map((node) => ({ ...node, selected: nextIds.includes(node.id) })),
      };
    }),

    setSelectedEdgeIds: (ids: string[]) => set({ selectedEdgeIds: ids }),
  };
}
