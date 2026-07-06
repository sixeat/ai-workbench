import test from 'node:test';
import assert from 'node:assert/strict';

import { formatWorkflowPageSummary, workflowStorageWarning } from './workflowStorageDisplay';

test('formatWorkflowPageSummary labels remote and local workflow pages', () => {
  assert.equal(formatWorkflowPageSummary({ loaded: 12, total: 30, storage: 'remote' }), '已加载 12/30 个');
  assert.equal(formatWorkflowPageSummary({ loaded: 2, total: 5, search: '角色', storage: 'remote' }), '2/5 个匹配');
  assert.equal(formatWorkflowPageSummary({ loaded: 3, total: 8, storage: 'local' }), '本地副本 已加载 3/8 个');
  assert.equal(formatWorkflowPageSummary({ loaded: 1, total: 4, search: '分镜', storage: 'local' }), '本地副本 1/4 个匹配');
});

test('workflowStorageWarning explains local fallback only', () => {
  assert.equal(workflowStorageWarning('remote'), '');
  assert.match(workflowStorageWarning('local'), /本地副本/);
  assert.match(workflowStorageWarning('local'), /重新保存/);
});
