import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeWorkflowVersionDiff } from './workflowVersionDiff';

test('workflow version diff reports equal snapshots', () => {
  const snapshot = {
    nodes: [{ id: 'node-a', type: 'textInput', data: { label: '主题' } }],
    edges: [{ id: 'edge-a-b', source: 'node-a', target: 'node-b' }],
  };

  const summary = summarizeWorkflowVersionDiff(snapshot, snapshot);

  assert.equal(summary.isSame, true);
  assert.equal(summary.label, '与当前版本一致');
  assert.deepEqual(summary.nodeDiff, { added: 0, removed: 0, changed: 0 });
  assert.deepEqual(summary.edgeDiff, { added: 0, removed: 0, changed: 0 });
});

test('workflow version diff summarizes added removed and changed items', () => {
  const current = {
    nodes: [
      { id: 'node-a', type: 'textInput', data: { label: '主题' } },
      { id: 'node-b', type: 'imageGen', data: { model: 'new-model' } },
      { id: 'node-c', type: 'preview' },
    ],
    edges: [
      { id: 'edge-a-b', source: 'node-a', target: 'node-b' },
      { id: 'edge-b-c', source: 'node-b', target: 'node-c' },
    ],
  };
  const version = {
    nodes: [
      { id: 'node-a', data: { label: '主题' }, type: 'textInput' },
      { id: 'node-b', type: 'imageGen', data: { model: 'old-model' } },
      { id: 'node-d', type: 'videoGen' },
    ],
    edges: [
      { id: 'edge-a-b', source: 'node-a', target: 'node-b' },
      { id: 'edge-b-d', source: 'node-b', target: 'node-d' },
    ],
  };

  const summary = summarizeWorkflowVersionDiff(current, version);

  assert.equal(summary.isSame, false);
  assert.deepEqual(summary.nodeDiff, { added: 1, removed: 1, changed: 1 });
  assert.deepEqual(summary.edgeDiff, { added: 1, removed: 1, changed: 0 });
  assert.equal(summary.label, '节点 +1 / -1 / 改 1，连线 +1 / -1');
});
