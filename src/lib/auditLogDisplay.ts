import type { ProxyAuditLog, ProxyUser } from './apiProxy';

export type AuditActorLabelMap = Record<string, string>;

const ACTION_LABELS: Record<string, string> = {
  'admin.invitation.create': '创建邀请码',
  'admin.invitation.disable': '禁用邀请码',
  'admin.user.create': '创建用户',
  'admin.user.password_update': '修改密码',
  'admin.user.status_update': '修改用户状态',
  'api_key.create': '创建 API Key',
  'api_key.delete': '删除 API Key',
  'api_key.test': '测试 API Key',
  'api_key.test_failed': 'API Key 测试失败',
  'api_key.update': '修改 API Key',
  'model_capability.upsert': '保存模型能力',
  'session.logout_all': '退出所有设备',
  'session.logout_one': '退出单个设备',
};

export function formatAuditActionLabel(action: string): string {
  return ACTION_LABELS[action] || action;
}

function shortAuditId(id?: string): string {
  if (!id) return '';
  return id.length > 10 ? `${id.slice(0, 8)}...` : id;
}

export function buildAuditActorLabelMap(users: ProxyUser[]): AuditActorLabelMap {
  return Object.fromEntries(users.map((user) => [
    user.id,
    user.name || user.email || user.username || user.id,
  ]));
}

export function formatAuditActor(log: ProxyAuditLog, actorLabels: AuditActorLabelMap = {}): string {
  if (!log.actorUserId) return '-';
  const label = actorLabels[log.actorUserId];
  if (!label) return log.actorUserId;
  return `${label} (${shortAuditId(log.actorUserId)})`;
}

function safeMetadataText(metadata?: Record<string, unknown>): string {
  if (!metadata || Object.keys(metadata).length === 0) return '';
  try {
    return JSON.stringify(metadata);
  } catch {
    return '';
  }
}

export function filterAuditLogs(
  logs: ProxyAuditLog[],
  query: string,
  actorLabels: AuditActorLabelMap = {}
): ProxyAuditLog[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return logs;

  return logs.filter((log) => {
    const haystack = [
      formatAuditActionLabel(log.action),
      log.action,
      log.actorUserId,
      log.actorUserId ? actorLabels[log.actorUserId] : '',
      log.targetType,
      log.targetId,
      log.ipAddress,
      log.userAgent,
      safeMetadataText(log.metadata),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

export function mergeAuditLogPages(current: ProxyAuditLog[], next: ProxyAuditLog[]): ProxyAuditLog[] {
  const seen = new Set<string>();
  return [...current, ...next].filter((log) => {
    if (seen.has(log.id)) return false;
    seen.add(log.id);
    return true;
  });
}

export function formatAuditLogPageSummary(visible: number, loaded: number, total: number, query = ''): string {
  const safeTotal = Math.max(total, loaded);
  if (query.trim()) return `${visible}/${loaded} 条匹配，已加载 ${loaded}/${safeTotal}`;
  return `已加载 ${loaded}/${safeTotal} 条记录`;
}
