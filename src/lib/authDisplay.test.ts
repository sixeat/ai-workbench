import assert from 'node:assert/strict';
import test from 'node:test';
import { accountDisplayName, deploymentLabel, roleLabel } from './authDisplay';

test('auth display labels deployment modes in Chinese', () => {
  assert.equal(deploymentLabel('server'), '服务器模式');
  assert.equal(deploymentLabel('local'), '本地模式');
  assert.equal(deploymentLabel('custom'), 'custom');
  assert.equal(deploymentLabel(), '');
});

test('auth display labels user roles in Chinese', () => {
  assert.equal(roleLabel('admin'), '管理员');
  assert.equal(roleLabel('user'), '普通用户');
  assert.equal(roleLabel('local'), '本地用户');
  assert.equal(roleLabel('owner'), 'owner');
  assert.equal(roleLabel(), '');
});

test('auth display keeps a useful account label when no user is signed in', () => {
  assert.equal(accountDisplayName({ name: '小明', email: 'ming@example.com', username: 'ming' }, 'server'), '小明');
  assert.equal(accountDisplayName({ email: 'ming@example.com', username: 'ming' }, 'server'), 'ming@example.com');
  assert.equal(accountDisplayName({ username: 'ming' }, 'server'), 'ming');
  assert.equal(accountDisplayName(null, 'server'), '令牌访问');
  assert.equal(accountDisplayName(null, 'local'), '本地访问');
  assert.equal(accountDisplayName(null, ''), '未登录');
});
