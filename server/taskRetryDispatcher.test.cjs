const assert = require('node:assert/strict');
const test = require('node:test');

const { createTaskRetryDispatcher, taskKind } = require('./services/taskRetryDispatcher.cjs');

test('task retry dispatcher routes text tasks to the text retry handler', async () => {
  const calls = [];
  const retryTask = createTaskRetryDispatcher({
    retryTextTask: async ({ task, userId }) => {
      calls.push({ handler: 'text', taskId: task.id, userId });
      return { status: 202, data: { taskId: 'next-text-task' } };
    },
    retryGenerationTask: async () => {
      throw new Error('generation retry should not be called');
    },
  });

  const result = await retryTask({
    req: {},
    userId: 'user-1',
    task: { id: 'failed-text-task', nodeType: 'text' },
  });

  assert.equal(result.status, 202);
  assert.equal(result.data.taskId, 'next-text-task');
  assert.deepEqual(calls, [{ handler: 'text', taskId: 'failed-text-task', userId: 'user-1' }]);
});

test('task retry dispatcher routes image and video tasks to the generation retry handler', async () => {
  const calls = [];
  const retryTask = createTaskRetryDispatcher({
    retryTextTask: async () => {
      throw new Error('text retry should not be called');
    },
    retryGenerationTask: async ({ task }) => {
      calls.push(task.id);
      return { status: 202, data: { taskId: `next-${task.id}` } };
    },
  });

  const imageResult = await retryTask({ req: {}, userId: 'user-1', task: { id: 'failed-image-task', nodeType: 'image' } });
  const videoResult = await retryTask({ req: {}, userId: 'user-1', task: { id: 'failed-video-task', kind: 'video' } });

  assert.equal(imageResult.data.taskId, 'next-failed-image-task');
  assert.equal(videoResult.data.taskId, 'next-failed-video-task');
  assert.deepEqual(calls, ['failed-image-task', 'failed-video-task']);
});

test('task retry dispatcher returns safe errors for unsupported or unavailable retries', async () => {
  const unsupportedRetry = createTaskRetryDispatcher();
  assert.equal(taskKind({ nodeType: 'TEXT' }), 'text');

  const unsupported = await unsupportedRetry({
    req: {},
    userId: 'user-1',
    task: { id: 'failed-audio-task', nodeType: 'audio' },
  });
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.data.error, 'Retry is not supported for audio tasks.');

  const missingTextHandler = createTaskRetryDispatcher({
    retryGenerationTask: async () => ({ status: 202, data: {} }),
  });
  const unavailable = await missingTextHandler({
    req: {},
    userId: 'user-1',
    task: { id: 'failed-text-task', nodeType: 'text' },
  });
  assert.equal(unavailable.status, 501);
  assert.equal(unavailable.data.error, 'Text retry is not available.');
});
