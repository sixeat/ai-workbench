import type { ApiInstance } from '../types/api';

export type ApiInstanceSource = 'platform' | 'custom';

export const API_INSTANCE_SOURCE_LABELS: Record<ApiInstanceSource, string> = {
  platform: '平台模型',
  custom: '我的 API',
};

export function getApiInstanceSource(instance: ApiInstance): ApiInstanceSource {
  return instance.keyScope === 'server' ? 'platform' : 'custom';
}

export function groupApiInstancesBySource<T extends ApiInstance>(
  instances: T[]
): Record<ApiInstanceSource, T[]> {
  return {
    platform: instances.filter((instance) => getApiInstanceSource(instance) === 'platform'),
    custom: instances.filter((instance) => getApiInstanceSource(instance) === 'custom'),
  };
}
