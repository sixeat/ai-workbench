export interface ApiKeyQuotaSummary {
  userKeyCount: number;
  maxUserApiKeys: number;
  remainingUserKeys: number;
}

export function apiKeyScopeLabel(scope?: string): string {
  if (scope === 'server') return '服务器共享 Key';
  if (scope === 'user') return '我的 API';
  return scope || '未知 Key';
}

export function canManageApiKeyScope(scope: string | undefined, canManageServerKeys: boolean): boolean {
  return scope !== 'server' || canManageServerKeys;
}

export function summarizeApiKeyQuota(quota?: ApiKeyQuotaSummary | null): string {
  if (!quota) return '我的 API 配额未返回';
  return `我的 API ${quota.userKeyCount}/${quota.maxUserApiKeys}，还可保存 ${quota.remainingUserKeys} 个`;
}
