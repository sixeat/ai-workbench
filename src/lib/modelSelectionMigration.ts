import type { ProxyApiKeyModel } from './apiProxy';
import type { ApiInstance, ModelSelection } from '../types/api';

interface WorkflowNodeLike {
  data?: {
    config?: Record<string, unknown>;
  };
}

function personalSelection(apiKeyModelId: string): ModelSelection {
  return { source: 'personal', apiKeyModelId };
}

function platformSelection(platformModelId: string): ModelSelection {
  return { source: 'platform', platformModelId };
}

function legacyApiKeyId(instanceId: string, instances: Record<string, ApiInstance>): string {
  if (instanceId.startsWith('user:')) return instanceId.slice('user:'.length);
  return instances[instanceId]?.apiKeyId || '';
}

export function migrateWorkflowModelSelections<T extends WorkflowNodeLike>(
  nodes: T[],
  personalModels: ProxyApiKeyModel[],
  instances: Record<string, ApiInstance> = {}
): { migratedCount: number; nodes: T[] } {
  let migratedCount = 0;
  const migratedNodes = nodes.map((node) => {
    const config = node.data?.config;
    if (!config) return node;

    const platformModelId = String(config.platformModelId || '').trim();
    const apiKeyModelId = String(config.apiKeyModelId || '').trim();
    let patch: Record<string, unknown> | null = null;

    if (platformModelId && !config.modelSelection) {
      patch = { modelSelection: platformSelection(platformModelId) };
    } else if (apiKeyModelId && !config.modelSelection) {
      patch = { modelSelection: personalSelection(apiKeyModelId) };
    } else if (!platformModelId && !apiKeyModelId) {
      const instanceId = String(config.instanceId || '').trim();
      const upstreamModel = String(config.model || '').trim();
      if (instanceId && upstreamModel && !instanceId.startsWith('server:')) {
        const apiKeyId = legacyApiKeyId(instanceId, instances);
        const exactKeyMatches = personalModels.filter((model) => (
          model.apiKeyId === apiKeyId && model.upstreamModel === upstreamModel
        ));
        const modelMatches = personalModels.filter((model) => model.upstreamModel === upstreamModel);
        const match = exactKeyMatches.length === 1
          ? exactKeyMatches[0]
          : !apiKeyId && modelMatches.length === 1
            ? modelMatches[0]
            : null;
        if (match) {
          patch = {
            apiKeyModelId: match.id,
            instanceId: `user:${match.apiKeyId}`,
            modelSelection: personalSelection(match.id),
          };
        }
      }
    }

    if (!patch) return node;
    migratedCount += 1;
    return {
      ...node,
      data: {
        ...node.data,
        config: { ...config, ...patch },
      },
    };
  });

  return { migratedCount, nodes: migratedNodes };
}
