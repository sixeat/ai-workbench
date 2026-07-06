import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatQueueBacklog,
  formatQueueCapacity,
  formatQueueName,
  formatQueueNodeTypes,
  getQueueHealthState,
  summarizeQueues,
} from './adminHealthDisplay';

test('admin health display formats queue labels and counts', () => {
  assert.equal(formatQueueName('text'), '文本队列');
  assert.equal(formatQueueName('generation'), '生成队列');
  assert.equal(formatQueueName('custom'), 'custom');
  assert.equal(formatQueueName(''), '未命名队列');

  assert.equal(formatQueueNodeTypes(['text', 'image', 'video']), '文本 / 图片 / 视频');
  assert.equal(formatQueueNodeTypes(['custom-node']), 'custom-node');
  assert.equal(formatQueueNodeTypes([]), '未绑定节点');

  assert.equal(formatQueueCapacity({ activeCount: 2, concurrency: 4 }), '2/4 活跃');
  assert.equal(formatQueueBacklog({ queuedCount: 7 }), '7 个排队');
});

test('admin health display summarizes queue states', () => {
  assert.deepEqual(getQueueHealthState({ stopped: true }), {
    label: '已停止',
    tone: 'danger',
    description: 'worker 已停止，排队任务不会继续执行。',
  });

  assert.deepEqual(getQueueHealthState({ activeCount: 2, concurrency: 2, queuedCount: 3 }), {
    label: '积压中',
    tone: 'warning',
    description: 'worker 已满载，后续任务正在等待空位。',
  });

  assert.equal(getQueueHealthState({ activeCount: 1, concurrency: 2, queuedCount: 0 }).label, '运行中');
  assert.equal(getQueueHealthState({ scheduled: true, queuedCount: 1 }).label, '等待调度');
  assert.equal(getQueueHealthState({ activeCount: 0, queuedCount: 0 }).label, '空闲');
});

test('admin health display summarizes all queues', () => {
  assert.equal(summarizeQueues(), '暂无队列状态');
  assert.equal(summarizeQueues([
    { name: 'text', activeCount: 1, queuedCount: 2 },
    { name: 'generation', activeCount: 3, queuedCount: 5 },
  ]), '2 个队列，4 个运行中，7 个排队');
});
