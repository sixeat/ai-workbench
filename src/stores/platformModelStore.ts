import { create } from 'zustand';
import { proxyListPlatformModels, type ProxyPlatformModel, type ProxyPlatformModelCapability } from '../lib/apiProxy';
import type { NodeType } from '../types/nodes';

interface PlatformModelStoreState {
  error: string;
  loadedAt: number;
  loading: boolean;
  models: ProxyPlatformModel[];
}

interface PlatformModelStoreActions {
  getModel: (modelId: string) => ProxyPlatformModel | undefined;
  getModelsByNodeType: (nodeType: NodeType) => ProxyPlatformModel[];
  loadPlatformModels: (options?: { force?: boolean }) => Promise<ProxyPlatformModel[]>;
}

function nodeCapability(type: NodeType): ProxyPlatformModelCapability | null {
  if (type === 'textModel' || type === 'script' || type === 'shotSplit' || type === 'promptOptimize') return 'chat';
  if (type === 'imageGen' || type === 'imageToImage') return 'imageGeneration';
  if (type === 'videoGen' || type === 'multiImageVideo') return 'videoGeneration';
  return null;
}

export function platformModelSupportsNode(model: ProxyPlatformModel, type: NodeType): boolean {
  const capability = nodeCapability(type);
  return Boolean(capability && model.isEnabled && model.capability === capability);
}

export const usePlatformModelStore = create<PlatformModelStoreState & PlatformModelStoreActions>()((set, get) => ({
  error: '',
  loadedAt: 0,
  loading: false,
  models: [],

  getModel: (modelId) => get().models.find((model) => model.id === modelId),

  getModelsByNodeType: (nodeType) => get().models.filter((model) => platformModelSupportsNode(model, nodeType)),

  loadPlatformModels: async (options = {}) => {
    const state = get();
    if (!options.force && state.loading) return state.models;
    if (!options.force && state.loadedAt && Date.now() - state.loadedAt < 30_000) return state.models;

    set({ loading: true, error: '' });
    try {
      const data = await proxyListPlatformModels({ limit: 500 });
      set({ models: data.models, loadedAt: Date.now(), loading: false, error: '' });
      return data.models;
    } catch (error) {
      const message = error instanceof Error ? error.message : '平台模型加载失败';
      set({ error: message, loading: false });
      return get().models;
    }
  },
}));
