import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuditActorLabelMap,
  filterAuditLogs,
  formatAuditLogPageSummary,
  formatAuditActionLabel,
  formatAuditActor,
  mergeAuditLogPages,
} from './auditLogDisplay';
import type { ProxyAuditLog, ProxyUser } from './apiProxy';

function log(id: string, patch: Partial<ProxyAuditLog>): ProxyAuditLog {
  return {
    id,
    action: 'api_key.update',
    actorUserId: 'user-1',
    targetType: 'api_key',
    targetId: 'key-1',
    ipAddress: '127.0.0.1',
    userAgent: 'Browser',
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

function user(id: string, patch: Partial<ProxyUser>): ProxyUser {
  return {
    id,
    username: 'user@example.com',
    email: 'user@example.com',
    name: '',
    role: 'user',
    isEnabled: true,
    ...patch,
  };
}

test('formatAuditActionLabel translates known audit actions', () => {
  assert.equal(formatAuditActionLabel('admin.user.status_update'), '修改用户状态');
  assert.equal(formatAuditActionLabel('custom.action'), 'custom.action');
});

test('filterAuditLogs searches action labels, targets, actors, IP, and metadata', () => {
  const logs = [
    log('a', { action: 'admin.user.status_update', targetId: 'disabled-user' }),
    log('b', { action: 'model_capability.upsert', metadata: { providerId: 'seedance' } }),
    log('c', { actorUserId: 'admin-2', ipAddress: '203.0.113.5' }),
  ];

  assert.deepEqual(filterAuditLogs(logs, '修改用户状态').map((item) => item.id), ['a']);
  assert.deepEqual(filterAuditLogs(logs, 'seedance').map((item) => item.id), ['b']);
  assert.deepEqual(filterAuditLogs(logs, '203.0.113.5').map((item) => item.id), ['c']);
  assert.deepEqual(filterAuditLogs(logs, '').map((item) => item.id), ['a', 'b', 'c']);
});

test('audit actor helpers show readable user labels and make them searchable', () => {
  const actorLabels = buildAuditActorLabelMap([
    user('admin-user-123456', { name: '张三', email: 'admin@example.com' }),
  ]);
  const logs = [
    log('a', { actorUserId: 'admin-user-123456' }),
    log('b', { actorUserId: 'unknown-user' }),
  ];

  assert.equal(formatAuditActor(logs[0], actorLabels), '张三 (admin-us...)');
  assert.equal(formatAuditActor(logs[1], actorLabels), 'unknown-user');
  assert.deepEqual(filterAuditLogs(logs, '张三', actorLabels).map((item) => item.id), ['a']);
});

test('mergeAuditLogPages deduplicates overlapping audit pages', () => {
  const merged = mergeAuditLogPages(
    [log('a', {}), log('b', {})],
    [log('b', { action: 'api_key.delete' }), log('c', {})]
  );

  assert.deepEqual(merged.map((item) => item.id), ['a', 'b', 'c']);
  assert.equal(merged[1].action, 'api_key.update');
});

test('formatAuditLogPageSummary explains loaded and filtered audit counts', () => {
  assert.equal(formatAuditLogPageSummary(20, 80, 200), '已加载 80/200 条记录');
  assert.equal(formatAuditLogPageSummary(3, 80, 200, 'seedance'), '3/80 条匹配，已加载 80/200');
  assert.equal(formatAuditLogPageSummary(0, 10, 0), '已加载 10/10 条记录');
});
