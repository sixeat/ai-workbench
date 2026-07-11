import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ApiInstance } from '../types/api';
import type { NodeType } from '../types/nodes';
import { generateId } from '../lib/utils';
import { getProviderDefaultModels, getProviderTemplate } from '../data/providerRegistry';
import { proxyFetchModels, type ProxyApiKey } from '../lib/apiProxy';

const runtimeApiKeys: Record<string, string> = {};

interface ApiStoreState {
  instances: Record<string, ApiInstance>;
  deploymentMode: 'local' | 'server' | string;
}

interface ApiStoreActions {
  addInstance: (instance: Omit<ApiInstance, 'id' | 'createdAt' | 'updatedAt'>) => string;
  removeInstance: (instanceId: string) => void;
  updateInstance: (instanceId: string, updates: Partial<ApiInstance>) => void;
  getInstance: (instanceId: string) => ApiInstance | undefined;
  getDecryptedKey: (instanceId: string) => string | undefined;
  getEnabledInstances: () => ApiInstance[];
  getInstancesByNodeType: (nodeType: string) => ApiInstance[];
  setDeploymentMode: (mode: 'local' | 'server' | string) => void;
  setInstanceModels: (instanceId: string, models: string[]) => void;
  syncServerKeyInstances: (apiKeys: ProxyApiKey[], options?: { replaceMissing?: boolean }) => void;
  toggleInstanceEnabled: (instanceId: string) => void;
}

function backendUserInstanceId(apiKeyId: string): string {
  return `user:${apiKeyId}`;
}

function isBackendUserInstanceId(instanceId: string): boolean {
  return instanceId.startsWith('user:');
}

function isLegacyServerInstanceId(instanceId: string): boolean {
  return instanceId.startsWith('server:');
}

export const useApiStore = create<ApiStoreState & ApiStoreActions>()(
  persist(
    (set, get) => ({
      instances: {},
      deploymentMode: 'local',

      addInstance: (instance) => {
        if (get().deploymentMode === 'server') return '';

        const id = generateId();
        const now = new Date().toISOString();
        const storedInstance: ApiInstance = {
          ...instance,
          id,
          apiKey: '',
          createdAt: now,
          updatedAt: now,
        };
        runtimeApiKeys[id] = instance.apiKey;

        set((state) => ({
          instances: { ...state.instances, [id]: storedInstance },
        }));

        return id;
      },

      removeInstance: (instanceId) => {
        set((state) => {
          const nextInstances = { ...state.instances };
          delete nextInstances[instanceId];
          delete runtimeApiKeys[instanceId];
          return { instances: nextInstances };
        });
      },

      updateInstance: (instanceId, updates) => {
        set((state) => {
          const existing = state.instances[instanceId];
          if (!existing) return state;
          if (state.deploymentMode === 'server' && !isBackendUserInstanceId(instanceId)) return state;

          const updated: ApiInstance = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString(),
            apiKey: '',
          };
          if (state.deploymentMode !== 'server' && updates.apiKey !== undefined) {
            runtimeApiKeys[instanceId] = updates.apiKey;
          }

          return {
            instances: { ...state.instances, [instanceId]: updated },
          };
        });
      },

      getInstance: (instanceId) => get().instances[instanceId],

      getDecryptedKey: (instanceId) => runtimeApiKeys[instanceId],

      getEnabledInstances: () => Object.values(get().instances).filter((instance) => instance.isEnabled),

      getInstancesByNodeType: (nodeType) =>
        Object.values(get().instances).filter((instance) => {
          if (!instance.isEnabled) return false;
          const provider = getProviderTemplate(instance.providerId);
          return provider?.supportedNodes.includes(nodeType as NodeType);
        }),

      setDeploymentMode: (mode) => {
        set((state) => {
          if (mode !== 'server') return { deploymentMode: mode };

          const serverInstances = Object.fromEntries(
            Object.entries(state.instances).filter(([id]) => isBackendUserInstanceId(id))
          );
          for (const id of Object.keys(state.instances)) {
            if (!isBackendUserInstanceId(id)) delete runtimeApiKeys[id];
          }

          return {
            deploymentMode: mode,
            instances: serverInstances,
          };
        });
      },

      setInstanceModels: (instanceId, models) => {
        get().updateInstance(instanceId, { models });
      },

      syncServerKeyInstances: (apiKeys, options = {}) => {
        set((state) => {
          const nextInstances = { ...state.instances };
          const userKeys = apiKeys.filter((key) => key.keyScope === 'user');
          const activeServerIds = new Set(userKeys.map((key) => backendUserInstanceId(key.id)));

          if (options.replaceMissing) {
            for (const id of Object.keys(nextInstances)) {
              if ((isBackendUserInstanceId(id) || isLegacyServerInstanceId(id)) && !activeServerIds.has(id)) {
                delete nextInstances[id];
              }
            }
          }

          for (const key of userKeys) {
            const id = backendUserInstanceId(key.id);
            const existing = nextInstances[id];
            nextInstances[id] = {
              ...existing,
              id,
              name: key.name || `${key.providerId} Server Key`,
              providerId: key.providerId,
              apiKeyId: key.id,
              keyScope: key.keyScope,
              allowedCapabilities: key.allowedCapabilities || existing?.allowedCapabilities,
              apiKey: '',
              baseUrl: key.baseUrl || undefined,
              customHeaders: existing?.customHeaders,
              models: Array.isArray(key.models) ? key.models : [],
              modelFetchMode: existing?.modelFetchMode || 'manual',
              isEnabled: key.isEnabled,
              createdAt: existing?.createdAt || key.createdAt || new Date().toISOString(),
              updatedAt: key.updatedAt || new Date().toISOString(),
            };
          }

          return { instances: nextInstances };
        });
      },

      toggleInstanceEnabled: (instanceId) => {
        const instance = get().instances[instanceId];
        if (instance) {
          get().updateInstance(instanceId, { isEnabled: !instance.isEnabled });
        }
      },
    }),
    {
      name: 'ai-workbench-api-v2',
      version: 2,
      partialize: (state) => ({
        deploymentMode: state.deploymentMode,
        instances: Object.fromEntries(
            Object.entries(state.instances)
              .filter(([id]) => state.deploymentMode !== 'server' && !isLegacyServerInstanceId(id) && !isBackendUserInstanceId(id))
            .map(([id, instance]) => [id, { ...instance, apiKey: '' }])
        ),
      }),
      migrate: (persisted) => {
        const state = persisted as ApiStoreState;
        const deploymentMode = state.deploymentMode || 'local';
        return {
          ...state,
          deploymentMode,
          instances: Object.fromEntries(
            Object.entries(state.instances || {})
              .filter(([id]) => deploymentMode !== 'server' && !isLegacyServerInstanceId(id) && !isBackendUserInstanceId(id))
              .map(([id, instance]) => [id, { ...instance, apiKey: '' }])
          ),
        };
      },
    }
  )
);

export function getInstanceRuntimeConfig(instanceId: string): {
  baseUrl: string;
  apiKey: string;
  apiKeyId?: string;
  provider: ReturnType<typeof getProviderTemplate>;
} | null {
  const store = useApiStore.getState();
  const instance = store.getInstance(instanceId);
  if (!instance) return null;

  const provider = getProviderTemplate(instance.providerId);
  if (!provider) return null;

  const decryptedKey = store.getDecryptedKey(instanceId);
  if (!decryptedKey && !instance.apiKeyId) return null;

  const baseUrl = instance.baseUrl || provider.defaultBaseUrl;

  return {
    baseUrl,
    apiKey: decryptedKey || '',
    apiKeyId: instance.apiKeyId,
    provider,
  };
}

export async function fetchModelsList(
  instanceId: string
): Promise<{ success: boolean; models: string[]; error?: string }> {
  const config = getInstanceRuntimeConfig(instanceId);
  if (!config) {
    return { success: false, models: [], error: 'API 实例配置无效' };
  }

  const { baseUrl, apiKey, apiKeyId, provider } = config;
  const modelsEndpoint = provider?.endpoints?.models;

  if (!modelsEndpoint) {
    return {
      success: true,
      models: getProviderDefaultModels(provider!.id),
    };
  }

  try {
    const { models: rawModels } = await proxyFetchModels(baseUrl, apiKey || '', {
      apiKeyId,
      providerId: provider?.id,
    });
    const models = rawModels.map((model) => model.id);
    return { success: true, models };
  } catch (error) {
    return {
      success: false,
      models: getProviderDefaultModels(provider!.id),
      error: error instanceof Error ? error.message : '获取模型列表失败',
    };
  }
}
