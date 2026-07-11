import { create } from 'zustand';
import {
  proxyListModelCatalog,
  type ProxyApiKeyModel,
  type ProxyPlatformModel,
} from '../lib/apiProxy';

interface ModelCatalogState {
  personalModels: ProxyApiKeyModel[];
  platformModels: ProxyPlatformModel[];
  loading: boolean;
  loadedAt: number;
  error: string;
  loadCatalog: (force?: boolean) => Promise<void>;
  invalidate: () => void;
}

export const useModelCatalogStore = create<ModelCatalogState>((set, get) => ({
  personalModels: [],
  platformModels: [],
  loading: false,
  loadedAt: 0,
  error: '',
  async loadCatalog(force = false) {
    const state = get();
    if (state.loading) return;
    if (!force && state.loadedAt && Date.now() - state.loadedAt < 30_000) return;
    set({ loading: true, error: '' });
    try {
      const data = await proxyListModelCatalog();
      set({
        personalModels: data.personalModels,
        platformModels: data.platformModels,
        loading: false,
        loadedAt: Date.now(),
        error: '',
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '模型目录加载失败',
      });
    }
  },
  invalidate() {
    set({ loadedAt: 0 });
  },
}));
