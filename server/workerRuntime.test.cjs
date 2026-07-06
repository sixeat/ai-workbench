const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-worker-runtime-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const {
  createTask,
  createUser,
  db,
  getTask,
  listTaskAssets,
  listTaskLogs,
} = require('./db.cjs');
const { LocalAssetStorage } = require('./assetStorage.cjs');
const { joinUrl } = require('./services/proxyService.cjs');
const { createWorkbenchWorkerRuntime } = require('./workerRuntime.cjs');

function waitFor(predicate, timeoutMs = 1500) {
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

test('worker runtime consumes queued text image and video tasks without an HTTP app', async () => {
  const user = createUser({
    email: 'worker-runtime@example.com',
    username: 'worker-runtime@example.com',
    name: 'Worker Runtime',
    passwordHash: 'test',
  });
  const textTask = createTask({
    userId: user.id,
    nodeType: 'text',
    providerId: 'openai-compatible',
    model: 'gpt-test',
    status: 'queued',
    input: {
      baseUrl: 'https://api.example.com',
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'hello worker' }],
      requestKind: 'chat',
    },
  });
  const imageTask = createTask({
    userId: user.id,
    nodeType: 'image',
    providerId: 'openai-compatible',
    model: 'gpt-image-1',
    status: 'queued',
    input: {
      providerId: 'openai-compatible',
      model: 'gpt-image-1',
      prompt: 'paint worker image',
      size: '1024x1024',
      n: 1,
      response_format: 'b64_json',
    },
  });
  const videoTask = createTask({
    userId: user.id,
    nodeType: 'video',
    providerId: 'seedance',
    model: 'doubao-seedance-2-0-mini-260615',
    status: 'queued',
    input: {
      providerId: 'seedance',
      model: 'doubao-seedance-2-0-mini-260615',
      content: [{ type: 'text', text: 'make worker video' }],
      duration: 5,
      ratio: '16:9',
    },
  });
  const upstreamRequests = [];
  const runtime = createWorkbenchWorkerRuntime({
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs')),
    generationQueueConcurrency: 2,
    joinUrl,
    proxyRequest: async (url, options) => {
      upstreamRequests.push({
        url,
        body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body,
      });
      if (url.includes('/v1/images/generations')) {
        return {
          status: 200,
          data: { data: [{ b64_json: Buffer.from('worker image bytes').toString('base64') }] },
        };
      }
      if (url.includes('/api/v3/contents/generations/tasks')) {
        return {
          status: 200,
          data: { id: 'worker-upstream-video-task', status: 'queued' },
        };
      }
      return {
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'worker text ok' } }] },
      };
    },
    publicAsset: (asset) => asset,
    readSecrets: async () => ({}),
    resolveApiCredentials: async ({ body }) => ({
      baseUrl: body.providerId === 'seedance'
        ? 'https://ark.cn-beijing.volces.com'
        : 'https://api.example.com',
      apiKey: 'worker-key',
      providerId: body.providerId || 'openai-compatible',
    }),
    resolveDirectCredentials: (body) => ({
      baseUrl: body.baseUrl || 'https://api.example.com',
      apiKey: 'worker-direct-key',
      providerId: body.providerId || 'openai-compatible',
    }),
    textQueueConcurrency: 1,
  });

  try {
    runtime.start();
    await waitFor(() => getTask(textTask.id).status === 'succeeded');
    await waitFor(() => getTask(imageTask.id).status === 'succeeded');
    await waitFor(() => getTask(videoTask.id).status === 'running');

    assert.equal(getTask(textTask.id).output.choices[0].message.content, 'worker text ok');
    assert.equal(getTask(imageTask.id).output[0].type, 'image');
    assert.equal(listTaskAssets(imageTask.id).length, 1);
    assert.equal(getTask(videoTask.id).output.upstream.taskId, 'worker-upstream-video-task');
    assert.equal(upstreamRequests.some((request) => request.url.includes('/v1/chat/completions')), true);
    assert.equal(upstreamRequests.some((request) => request.url.includes('/v1/images/generations')), true);
    assert.equal(upstreamRequests.some((request) => request.url.includes('/api/v3/contents/generations/tasks')), true);
    assert.equal(listTaskLogs(textTask.id).some((log) => log.event === 'started'), true);
    assert.equal(listTaskLogs(imageTask.id).some((log) => log.event === 'succeeded'), true);
    assert.equal(listTaskLogs(videoTask.id).some((log) => log.event === 'upstream_video_submitted'), true);

    const queueHealth = runtime.getQueueHealth();
    assert.deepEqual(queueHealth.map((queue) => queue.name).sort(), ['generation', 'text']);
  } finally {
    await runtime.stop();
  }
});

test('worker runtime starts and stops queues idempotently', async () => {
  const calls = [];
  const queueState = {
    generationStopped: true,
    textStopped: true,
  };
  const runtime = createWorkbenchWorkerRuntime({
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs-idempotent')),
    createGenerationWorker: () => ({
      getGenerationQueueStats: () => ({
        name: 'generation',
        stopped: queueState.generationStopped,
      }),
      startGenerationQueue: () => {
        calls.push('generation:start');
        queueState.generationStopped = false;
      },
      stopGenerationQueue: async () => {
        calls.push('generation:stop');
        queueState.generationStopped = true;
      },
    }),
    createTextWorker: () => ({
      getTextQueueStats: () => ({
        name: 'text',
        stopped: queueState.textStopped,
      }),
      startTextQueue: () => {
        calls.push('text:start');
        queueState.textStopped = false;
      },
      stopTextQueue: async () => {
        calls.push('text:stop');
        queueState.textStopped = true;
      },
    }),
    joinUrl,
    proxyRequest: async () => ({ status: 200, data: {} }),
    publicAsset: (asset) => asset,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'worker-key',
      providerId: 'openai-compatible',
    }),
    resolveDirectCredentials: () => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'worker-direct-key',
      providerId: 'openai-compatible',
    }),
  });

  runtime.start();
  runtime.start();
  assert.deepEqual(calls, ['text:start', 'generation:start']);
  assert.deepEqual(
    runtime.getQueueHealth().map((queue) => [queue.name, queue.stopped]),
    [['text', false], ['generation', false]]
  );

  await runtime.stop();
  await runtime.stop();
  assert.deepEqual(calls, ['text:start', 'generation:start', 'text:stop', 'generation:stop']);
  assert.deepEqual(
    runtime.getQueueHealth().map((queue) => [queue.name, queue.stopped]),
    [['text', true], ['generation', true]]
  );
});
