import test from 'node:test';
import assert from 'node:assert/strict';
import { apiKeyScopeLabel, canManageApiKeyScope, summarizeApiKeyQuota } from './apiKeyScopeDisplay';

test('apiKeyScopeLabel explains user and shared server key scopes', () => {
  assert.equal(apiKeyScopeLabel('user'), '我的 API');
  assert.equal(apiKeyScopeLabel('server'), '服务器共享 Key');
  assert.equal(apiKeyScopeLabel('custom'), 'custom');
});

test('canManageApiKeyScope only lets admins manage shared server keys', () => {
  assert.equal(canManageApiKeyScope('user', false), true);
  assert.equal(canManageApiKeyScope('server', false), false);
  assert.equal(canManageApiKeyScope('server', true), true);
});

test('summarizeApiKeyQuota shows remaining personal key capacity', () => {
  assert.equal(
    summarizeApiKeyQuota({ userKeyCount: 3, maxUserApiKeys: 5, remainingUserKeys: 2 }),
    '我的 API 3/5，还可保存 2 个'
  );
  assert.equal(summarizeApiKeyQuota(null), '我的 API 配额未返回');
});
