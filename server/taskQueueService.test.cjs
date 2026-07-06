const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-task-queue-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const {
  createTask,
  createUser,
  db,
  getTask,
  listTaskLogs,
  updateTask,
} = require('./db.cjs');
const { createTaskQueueService } = require('./services/taskQueueService.cjs');

function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    function tick() {
      if (predicate()) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error('Timed out waiting for condition.'));
      return setTimeout(tick, 20);
    }
    tick();
  });
}

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('task queue claims queued tasks and records worker logs', async () => {
  const user = createUser({
    email: 'queue-owner@example.com',
    username: 'queue-owner@example.com',
    name: 'Queue Owner',
    passwordHash: 'test',
  });
  const task = createTask({
    userId: user.id,
    nodeType: 'image',
    providerId: 'openai-compatible',
    model: 'gpt-image-test',
    status: 'queued',
    input: {
      prompt: 'queued image',
      sourceTaskId: 'source-task-1',
      upstream: { taskId: 'provider-input-task' },
    },
  });
  const handled = [];
  const queue = createTaskQueueService({
    handlers: {
      image: async (claimed, payload) => {
        handled.push({ taskId: claimed.id, payload });
        updateTask(claimed.id, {
          status: 'succeeded',
          output: {
            upstream: { taskId: 'provider-output-task' },
            data: [{ id: 'asset-1', type: 'image', url: '/api/assets/asset-1' }],
          },
        });
      },
    },
  });

  queue.enqueue(task, { source: 'test' });
  await waitFor(() => getTask(task.id).status === 'succeeded');
  queue.stop();

  assert.deepEqual(handled, [{ taskId: task.id, payload: { source: 'test' } }]);
  assert.equal(getTask(task.id).status, 'succeeded');
  assert.equal(listTaskLogs(task.id).some((log) => log.event === 'queued'), true);
  assert.equal(listTaskLogs(task.id).some((log) => log.event === 'started'), true);
  assert.equal(listTaskLogs(task.id).some((log) => log.event === 'succeeded'), true);
  const queuedLog = listTaskLogs(task.id).find((log) => log.event === 'queued');
  assert.deepEqual(queuedLog.data.input.upstreamTaskIds, ['source-task-1', 'provider-input-task']);
  assert.equal(queuedLog.data.input.promptPreview, 'queued image');
  const succeededLog = listTaskLogs(task.id).find((log) => log.event === 'succeeded');
  assert.equal(succeededLog.data.model, 'gpt-image-test');
  assert.equal(typeof succeededLog.data.durationMs, 'number');
  assert.deepEqual(succeededLog.data.upstreamTaskIds, ['source-task-1', 'provider-input-task', 'provider-output-task']);
});

test('task queue logs safe input summaries for multimodal tasks', async () => {
  const user = createUser({
    email: 'queue-summary@example.com',
    username: 'queue-summary@example.com',
    name: 'Queue Summary',
    passwordHash: 'test',
  });
  const task = createTask({
    userId: user.id,
    nodeType: 'video',
    providerId: 'seedance',
    model: 'seedance-test',
    status: 'queued',
    input: {
      apiKey: 'sk-should-not-be-logged',
      apiKeyId: 'key-safe',
      requestKind: 'video',
      duration: 8,
      ratio: '16:9',
      quality: 'high',
      count: 2,
      content: [
        { type: 'text', text: 'Create a cinematic product video.' },
        { type: 'image_url', image_url: { url: 'https://example.com/private-image.png' } },
        { type: 'video_url', video_url: { url: 'https://example.com/private-video.mp4' } },
        { type: 'audio_url', audio_url: { url: 'https://example.com/private-audio.mp3' } },
      ],
    },
  });
  const queue = createTaskQueueService({
    handlers: {
      video: async (claimed) => {
        updateTask(claimed.id, {
          status: 'succeeded',
          output: { upstream: { taskId: 'video-output-task' } },
        });
      },
    },
  });

  queue.enqueue(task);
  await waitFor(() => getTask(task.id).status === 'succeeded');
  queue.stop();

  const queuedLog = listTaskLogs(task.id).find((log) => log.event === 'queued');
  assert.equal(queuedLog.data.input.promptPreview, 'Create a cinematic product video.');
  assert.equal(queuedLog.data.input.apiKeyId, 'key-safe');
  assert.equal(queuedLog.data.input.requestKind, 'video');
  assert.equal(queuedLog.data.input.duration, 8);
  assert.equal(queuedLog.data.input.ratio, '16:9');
  assert.equal(queuedLog.data.input.quality, 'high');
  assert.equal(queuedLog.data.input.count, 2);
  assert.equal(queuedLog.data.input.contentItemCount, 4);
  assert.equal(queuedLog.data.input.imageCount, 1);
  assert.equal(queuedLog.data.input.videoCount, 1);
  assert.equal(queuedLog.data.input.audioCount, 1);
  assert.equal(JSON.stringify(queuedLog.data).includes('sk-should-not-be-logged'), false);
  assert.equal(JSON.stringify(queuedLog.data).includes('private-image.png'), false);
});

test('task queue records failed logs when a handler marks the task failed', async () => {
  const user = createUser({
    email: 'queue-failed@example.com',
    username: 'queue-failed@example.com',
    name: 'Queue Failed',
    passwordHash: 'test',
  });
  const task = createTask({
    userId: user.id,
    nodeType: 'text',
    providerId: 'openai-compatible',
    model: 'gpt-test',
    status: 'queued',
    input: { prompt: 'fail me' },
  });
  const queue = createTaskQueueService({
    handlers: {
      text: async (claimed) => {
        updateTask(claimed.id, {
          status: 'failed',
          error: { message: 'Upstream rejected the request.' },
          durationMs: 12,
        });
      },
    },
  });

  queue.enqueue(task);
  await waitFor(() => getTask(task.id).status === 'failed');
  queue.stop();

  const failedLog = listTaskLogs(task.id).find((log) => log.event === 'failed');
  assert.equal(failedLog.message, 'Upstream rejected the request.');
  assert.equal(failedLog.data.durationMs, 12);
  assert.equal(failedLog.data.model, 'gpt-test');
  assert.deepEqual(failedLog.data.error, { message: 'Upstream rejected the request.' });
});

test('task queue logs safe failed data when a worker throws', async () => {
  const user = createUser({
    email: 'queue-throw@example.com',
    username: 'queue-throw@example.com',
    name: 'Queue Throw',
    passwordHash: 'test',
  });
  const task = createTask({
    userId: user.id,
    nodeType: 'image',
    providerId: 'openai-compatible',
    model: 'gpt-image-test',
    status: 'queued',
    input: {
      prompt: 'throw me',
      apiKey: 'sk-should-not-be-logged',
      upstreamTaskIds: ['input-upstream-task'],
      upstream: { taskId: 'nested-upstream-task' },
    },
  });
  const queue = createTaskQueueService({
    handlers: {
      image: async () => {
        throw new Error('Raw provider failure with sk-should-not-be-logged and https://private.example/image.png');
      },
    },
  });

  queue.enqueue(task);
  await waitFor(() => getTask(task.id).status === 'failed');
  await queue.stop();

  const updated = getTask(task.id);
  const failedLog = listTaskLogs(task.id).find((log) => log.event === 'failed');
  assert.equal(updated.error.message, 'Task execution failed.');
  assert.equal(failedLog.message, 'Task execution failed.');
  assert.equal(failedLog.data.model, 'gpt-image-test');
  assert.equal(typeof failedLog.data.durationMs, 'number');
  assert.deepEqual(failedLog.data.upstreamTaskIds, ['input-upstream-task', 'nested-upstream-task']);
  assert.equal(JSON.stringify(failedLog).includes('sk-should-not-be-logged'), false);
  assert.equal(JSON.stringify(failedLog).includes('private.example'), false);
});

test('task queue keeps cancelled status when a cancelled worker later throws', async () => {
  const user = createUser({
    email: 'queue-cancel-throw@example.com',
    username: 'queue-cancel-throw@example.com',
    name: 'Queue Cancel Throw',
    passwordHash: 'test',
  });
  const task = createTask({
    userId: user.id,
    nodeType: 'video',
    providerId: 'seedance',
    model: 'seedance-test',
    status: 'queued',
    input: {
      prompt: 'cancel then throw',
      upstreamTaskIds: ['input-video-task'],
      upstream: { taskId: 'nested-video-task' },
    },
  });
  const queue = createTaskQueueService({
    handlers: {
      video: async (claimed) => {
        updateTask(claimed.id, {
          status: 'cancelled',
          error: { message: 'Cancellation requested while task was running.' },
        });
        throw new Error('Late provider error with sk-should-not-be-logged and https://private.example/video.mp4');
      },
    },
  });

  queue.enqueue(task);
  await waitFor(() => listTaskLogs(task.id).some((log) => log.event === 'cancelled'));
  await queue.stop();

  const updated = getTask(task.id);
  const logs = listTaskLogs(task.id);
  const cancelledLog = logs.find((log) => log.event === 'cancelled');
  assert.equal(updated.status, 'cancelled');
  assert.equal(logs.some((log) => log.event === 'failed'), false);
  assert.equal(cancelledLog.message, 'Task was cancelled.');
  assert.equal(cancelledLog.data.model, 'seedance-test');
  assert.deepEqual(cancelledLog.data.upstreamTaskIds, ['input-video-task', 'nested-video-task']);
  assert.equal(JSON.stringify(cancelledLog).includes('sk-should-not-be-logged'), false);
  assert.equal(JSON.stringify(cancelledLog).includes('private.example'), false);
});

test('task queue skips queued tasks that are cancelled before worker drain', async () => {
  const user = createUser({
    email: 'queue-cancel-before-drain@example.com',
    username: 'queue-cancel-before-drain@example.com',
    name: 'Queue Cancel Before Drain',
    passwordHash: 'test',
  });
  const task = createTask({
    userId: user.id,
    nodeType: 'image',
    providerId: 'openai-compatible',
    model: 'gpt-image-test',
    status: 'queued',
    input: { prompt: 'cancel before drain' },
  });
  const handled = [];
  const queue = createTaskQueueService({
    recoverRunning: false,
    handlers: {
      image: async (claimed) => {
        handled.push(claimed.id);
        updateTask(claimed.id, { status: 'succeeded', output: [{ type: 'image' }] });
      },
    },
  });

  queue.enqueue(task);
  updateTask(task.id, { status: 'cancelled', error: null });

  await waitFor(() => !queue.getStats().scheduled && queue.getStats().activeCount === 0);
  await queue.stop();

  const logs = listTaskLogs(task.id);
  assert.deepEqual(handled, []);
  assert.equal(getTask(task.id).status, 'cancelled');
  assert.equal(logs.some((log) => log.event === 'queued'), true);
  assert.equal(logs.some((log) => log.event === 'started'), false);
  assert.equal(logs.some((log) => log.event === 'succeeded'), false);
});

test('task queue startup marks interrupted running tasks as recoverable failures', () => {
  const user = createUser({
    email: 'queue-recovery@example.com',
    username: 'queue-recovery@example.com',
    name: 'Queue Recovery',
    passwordHash: 'test',
  });
  const task = createTask({
    userId: user.id,
    nodeType: 'video',
    providerId: 'seedance',
    model: 'seedance-test',
    status: 'running',
    input: {
      prompt: 'interrupted video',
      upstreamTaskIds: ['source-video-task'],
    },
    output: {
      upstream: { taskId: 'provider-video-task' },
    },
  });
  const queue = createTaskQueueService({
    handlers: {
      video: async () => {
        throw new Error('should not run interrupted task');
      },
    },
  });

  queue.start();
  queue.stop();

  const updated = getTask(task.id);
  assert.equal(updated.status, 'failed');
  assert.equal(updated.error.recoverable, true);
  assert.equal(updated.error.nodeType, 'video');
  assert.equal(updated.error.providerId, 'seedance');
  assert.equal(updated.error.model, 'seedance-test');
  assert.deepEqual(updated.error.upstreamTaskIds, ['source-video-task', 'provider-video-task']);
  const recoveryLog = listTaskLogs(task.id).find((log) => log.event === 'recovered_interrupted_task');
  assert.equal(recoveryLog.data.nodeType, 'video');
  assert.equal(recoveryLog.data.providerId, 'seedance');
  assert.equal(recoveryLog.data.model, 'seedance-test');
  assert.deepEqual(recoveryLog.data.upstreamTaskIds, ['source-video-task', 'provider-video-task']);
  assert.equal(typeof recoveryLog.data.durationMs, 'number');
});

test('task queue startup only recovers running tasks for supported node types', () => {
  const user = createUser({
    email: 'queue-recovery-scope@example.com',
    username: 'queue-recovery-scope@example.com',
    name: 'Queue Recovery Scope',
    passwordHash: 'test',
  });
  const owned = createTask({
    userId: user.id,
    nodeType: 'recover-owned',
    providerId: 'openai-compatible',
    model: 'owned-model',
    status: 'running',
    input: { prompt: 'owned interrupted task' },
  });
  const unrelated = createTask({
    userId: user.id,
    nodeType: 'recover-unrelated',
    providerId: 'seedance',
    model: 'unrelated-model',
    status: 'running',
    input: { prompt: 'unrelated active task' },
  });
  const queue = createTaskQueueService({
    handlers: {
      'recover-owned': async () => {
        throw new Error('should not run interrupted task');
      },
    },
  });

  queue.start();
  queue.stop();

  assert.equal(getTask(owned.id).status, 'failed');
  assert.equal(getTask(owned.id).error.recoverable, true);
  assert.equal(getTask(unrelated.id).status, 'running');
  assert.equal(listTaskLogs(unrelated.id).some((log) => log.event === 'recovered_interrupted_task'), false);

  updateTask(unrelated.id, {
    status: 'cancelled',
    error: { message: 'Cleaned up after recovery scope test.' },
  });
});

test('task queue startup drains existing queued text image and video tasks without transient payloads', async () => {
  const user = createUser({
    email: 'queue-cold-start@example.com',
    username: 'queue-cold-start@example.com',
    name: 'Queue Cold Start',
    passwordHash: 'test',
  });
  const text = createTask({
    userId: user.id,
    nodeType: 'text',
    providerId: 'openai-compatible',
    model: 'gpt-test',
    status: 'queued',
    input: { prompt: 'queued text from db' },
  });
  const image = createTask({
    userId: user.id,
    nodeType: 'image',
    providerId: 'openai-compatible',
    model: 'gpt-image-test',
    status: 'queued',
    input: { prompt: 'queued image from db' },
  });
  const video = createTask({
    userId: user.id,
    nodeType: 'video',
    providerId: 'seedance',
    model: 'seedance-test',
    status: 'queued',
    input: { prompt: 'queued video from db' },
  });
  const handled = [];
  const queue = createTaskQueueService({
    concurrency: 3,
    handlers: {
      text: async (claimed, payload) => {
        handled.push({ nodeType: claimed.nodeType, prompt: claimed.input.prompt, payload });
        updateTask(claimed.id, { status: 'succeeded', output: { text: 'ok' } });
      },
      image: async (claimed, payload) => {
        handled.push({ nodeType: claimed.nodeType, prompt: claimed.input.prompt, payload });
        updateTask(claimed.id, { status: 'succeeded', output: [{ type: 'image' }] });
      },
      video: async (claimed, payload) => {
        handled.push({ nodeType: claimed.nodeType, prompt: claimed.input.prompt, payload });
        updateTask(claimed.id, { status: 'succeeded', output: { upstream: { taskId: 'video-task' } } });
      },
    },
  });

  queue.start();
  await waitFor(() => [text.id, image.id, video.id].every((id) => getTask(id).status === 'succeeded'));
  await queue.stop();

  assert.deepEqual(
    handled
      .map((item) => ({ nodeType: item.nodeType, prompt: item.prompt, payload: item.payload }))
      .sort((a, b) => a.nodeType.localeCompare(b.nodeType)),
    [
      { nodeType: 'image', prompt: 'queued image from db', payload: {} },
      { nodeType: 'text', prompt: 'queued text from db', payload: {} },
      { nodeType: 'video', prompt: 'queued video from db', payload: {} },
    ]
  );
  assert.equal(listTaskLogs(text.id).some((log) => log.event === 'started'), true);
  assert.equal(listTaskLogs(image.id).some((log) => log.event === 'started'), true);
  assert.equal(listTaskLogs(video.id).some((log) => log.event === 'started'), true);
});

test('task queue stats expose active workers, supported node types, and exact backlog', () => {
  const user = createUser({
    email: 'queue-stats@example.com',
    username: 'queue-stats@example.com',
    name: 'Queue Stats',
    passwordHash: 'test',
  });
  createTask({
    userId: user.id,
    nodeType: 'stats-image',
    providerId: 'openai-compatible',
    model: 'gpt-image-test',
    status: 'queued',
    input: { prompt: 'queued stats image' },
  });
  createTask({
    userId: user.id,
    nodeType: 'stats-video',
    providerId: 'seedance',
    model: 'seedance-test',
    status: 'queued',
    input: { prompt: 'queued stats video' },
  });
  createTask({
    userId: user.id,
    nodeType: 'stats-other',
    status: 'queued',
    input: { prompt: 'not supported by this queue' },
  });

  const queue = createTaskQueueService({
    concurrency: 0,
    name: 'stats-generation',
    handlers: {
      'stats-image': async () => {},
      'stats-video': async () => {},
    },
    recoverRunning: false,
  });

  const stats = queue.getStats();
  assert.equal(stats.name, 'stats-generation');
  assert.deepEqual(stats.nodeTypes, ['stats-image', 'stats-video']);
  assert.equal(stats.concurrency, 0);
  assert.equal(stats.activeCount, 0);
  assert.equal(stats.queuedCount, 2);
  assert.equal(stats.scheduled, false);
  assert.equal(stats.stopped, false);
});
