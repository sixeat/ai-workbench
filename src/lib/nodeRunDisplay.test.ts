import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatNodeRunDuration,
  formatNodeRunStatus,
  formatNodeRunTaskStatus,
  isNodeRunImageAsset,
  shortNodeRunTaskId,
  summarizeNodeRunForDisplay,
  uniqueNodeRunAssetIds,
} from './nodeRunDisplay';

test('node run display formats status, duration, and task id', () => {
  assert.equal(formatNodeRunStatus('running'), '运行中');
  assert.equal(formatNodeRunStatus('completed'), '已完成');
  assert.equal(formatNodeRunStatus('error'), '失败');
  assert.equal(formatNodeRunDuration(420), '420ms');
  assert.equal(formatNodeRunDuration(1530), '1.5s');
  assert.equal(formatNodeRunDuration(undefined), '-');
  assert.equal(shortNodeRunTaskId('task-1234567890'), 'task-123...');
  assert.equal(formatNodeRunTaskStatus('queued'), '排队中');
  assert.equal(formatNodeRunTaskStatus('succeeded'), '已成功');
  assert.equal(formatNodeRunTaskStatus(undefined), '-');
});

test('node run display summarizes visible assets and overflow', () => {
  const summary = summarizeNodeRunForDisplay({
    status: 'completed',
    taskId: 'task-image-batch',
    durationMs: 2300,
    assetCount: 5,
    assets: [
      { id: 'a', type: 'image', url: '/api/assets/a.png' },
      { id: 'b', type: 'image', url: '/api/assets/b.png' },
      { id: 'c', type: 'image', url: '/api/assets/c.png' },
      { id: 'd', type: 'image', url: '/api/assets/d.png' },
    ],
  });

  assert.equal(summary?.statusLabel, '已完成');
  assert.equal(summary?.durationLabel, '2.3s');
  assert.equal(summary?.assetLabel, '5 个产物');
  assert.equal(summary?.visibleAssets.length, 3);
  assert.equal(summary?.overflowAssetCount, 2);
});

test('node run display detects image assets by type or filename', () => {
  assert.equal(isNodeRunImageAsset({ type: 'image', url: '/api/assets/1' }), true);
  assert.equal(isNodeRunImageAsset({ type: 'asset', url: '/api/assets/1.webp' }), true);
  assert.equal(isNodeRunImageAsset({ type: 'video', url: '/api/assets/1.mp4' }), false);
});

test('node run display deduplicates addable asset ids', () => {
  assert.deepEqual(
    uniqueNodeRunAssetIds([
      { id: 'asset-a', type: 'image', url: '/api/assets/asset-a' },
      { id: '', type: 'image', url: '/api/assets/no-id' },
      { id: 'asset-a', type: 'image', url: '/api/assets/asset-a-copy' },
      { id: 'asset-b', type: 'video', url: '/api/assets/asset-b' },
    ]),
    ['asset-a', 'asset-b']
  );
});
