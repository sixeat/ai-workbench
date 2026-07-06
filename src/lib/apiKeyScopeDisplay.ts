export interface ApiKeyQuotaSummary {
  userKeyCount: number;
  maxUserApiKeys: number;
  remainingUserKeys: number;
}

export function apiKeyScopeLabel(scope?: string): string {
  if (scope === 'server') return '服务器共享 Key';
  if (scope === 'user') return '个人 Key';
  return scope || '未知 Key';
}

export function canManageApiKeyScope(scope: string | undefined, canManageServerKeys: boolean): boolean {
  return scope !== 'server' || canManageServerKeys;
}

export function summarizeApiKeyQuota(quota?: ApiKeyQuotaSummary | null): string {
  if (!quota) return '个人 Key 配额未返回';
  return `个人 Key ${quota.userKeyCount}/${quota.maxUserApiKeys}，还可保存 ${quota.remainingUserKeys} 个`;
}
