const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-queued-routes-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');
process.env.WORKBENCH_ALLOW_PRIVATE_MEDIA_FETCH = 'true';

const {
  createTask,
  createUser,
  db,
  getTask,
  listTaskAssets,
  listTaskLogs,
} = require('./db.cjs');
const { LocalAssetStorage } = require('./assetStorage.cjs');
const { registerGenerationRoutes } = require('./routes/generationRoutes.cjs');
const { registerModelProxyRoutes } = require('./routes/modelProxyRoutes.cjs');
const { registerTaskRoutes } = require('./routes/taskRoutes.cjs');
const { createTaskService } = require('./services/taskService.cjs');
const { joinUrl } = require('./services/proxyService.cjs');

function createFakeApp() {
  const routes = [];
  return {
    routes,
    get(pathname, handler) {
      routes.push({ method: 'GET', pathname, handler });
    },
    post(pathname, handler) {
      routes.push({ method: 'POST', pathname, handler });
    },
  };
}

function createMockReq(body = {}) {
  return {
    body,
    headers: { host: 'workbench.example' },
    protocol: 'https',
    query: {},
    params: {},
  };
}

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

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

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.WORKBENCH_ALLOW_PRIVATE_MEDIA_FETCH;
});

test('model proxy routes can enqueue text tasks without starting a worker', async () => {
  const user = createUser({
    email: 'api-only-text@example.com',
    username: 'api-only-text@example.com',
    name: 'API Only Text',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const upstreamRequests = [];
  const handlers = registerModelProxyRoutes(app, {
    autoStartQueue: false,
    enableGenericProxy: false,
    joinUrl,
    proxyAllowlist: [],
    proxyRequest: async (url, options) => {
      upstreamRequests.push({ url, body: options.body });
      return { status: 200, data: { choices: [{ message: { content: 'should not run' } }] } };
    },
    getRequestUserId: () => user.id,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({ baseUrl: 'https://api.example.com', apiKey: 'saved-key', providerId: 'openai-compatible' }),
    requireAdmin: () => true,
    resolveDirectCredentials: () => ({ baseUrl: 'https://api.example.com', apiKey: 'direct-key', providerId: 'openai-compatible' }),
  });

  try {
    const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/chat');
    const res = createMockRes();
    await route.handler(createMockReq({
      baseUrl: 'https://api.example.com',
      apiKey: 'direct-key',
      providerId: 'openai-compatible',
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'hello from api only' }],
    }), res);

    assert.equal(res.statusCode, 202);
    assert.equal(res.body.task.status, 'queued');
    assert.equal(getTask(res.body.taskId).status, 'queued');
    assert.deepEqual(upstreamRequests, []);
    assert.equal(handlers.getTextQueueStats().stopped, false);
    assert.equal(handlers.getTextQueueStats().scheduled, false);
  } finally {
    await handlers.stopTextQueue();
  }
});

test('generation routes can enqueue image tasks without starting a worker', async () => {
  const user = createUser({
    email: 'api-only-image@example.com',
    username: 'api-only-image@example.com',
    name: 'API Only Image',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const upstreamRequests = [];
  const assetStorage = {
    async save() {
      throw new Error('asset save should not run in API-only mode');
    },
  };
  const handlers = registerGenerationRoutes(app, {
    assetStorage,
    autoStartQueue: false,
    getRequestUserId: () => user.id,
    joinUrl,
    proxyRequest: async (url, options) => {
      upstreamRequests.push({ url, body: options.body });
      return { status: 200, data: { data: [] } };
    },
    publicAsset: (asset) => asset,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({ baseUrl: 'https://api.example.com', apiKey: 'saved-key', providerId: 'openai-compatible' }),
  });

  try {
    const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/images');
    const res = createMockRes();
    await route.handler(createMockReq({
      providerId: 'openai-compatible',
      model: 'gpt-image-test',
      prompt: 'image from api only',
    }), res);

    assert.equal(res.statusCode, 202);
    assert.equal(res.body.task.status, 'queued');
    assert.equal(getTask(res.body.taskId).status, 'queued');
    assert.deepEqual(upstreamRequests, []);
    assert.equal(handlers.getGenerationQueueStats().stopped, false);
    assert.equal(handlers.getGenerationQueueStats().scheduled, false);
  } finally {
    await handlers.stopGenerationQueue();
  }
});

test('chat route creates a queued text task and worker completes it', async () => {
  const user = createUser({
    email: 'queued-text@example.com',
    username: 'queued-text@example.com',
    name: 'Queued Text',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const upstreamRequests = [];
  const handlers = registerModelProxyRoutes(app, {
    enableGenericProxy: false,
    joinUrl,
    proxyAllowlist: [],
    proxyRequest: async (url, options) => {
      upstreamRequests.push({ url, body: options.body });
      return {
      status: 200,
      data: { choices: [{ message: { role: 'assistant', content: 'queued ok' } }] },
      };
    },
    getRequestUserId: () => user.id,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => {
      throw new Error('saved key path should not be used');
    },
    requireAdmin: () => true,
    resolveDirectCredentials: () => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'direct-key',
      providerId: 'openai-compatible',
    }),
  });

  try {
    const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/chat');
    const res = createMockRes();
    await route.handler(createMockReq({
      baseUrl: 'https://api.example.com',
      apiKey: 'direct-key',
      providerId: 'openai-compatible',
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'hello' }],
      upstreamTaskIds: ['upstream-text-task'],
    }), res);

    assert.equal(res.statusCode, 202);
    assert.equal(res.body.task.status, 'queued');
    await waitFor(() => getTask(res.body.taskId).status === 'succeeded');
    const updated = getTask(res.body.taskId);
    assert.deepEqual(updated.input.upstreamTaskIds, ['upstream-text-task']);
    assert.equal(updated.output.choices[0].message.content, 'queued ok');
    assert.equal(upstreamRequests[0].body.upstreamTaskIds, undefined);
    assert.equal(listTaskLogs(res.body.taskId).some((log) =>
      log.event === 'queued' &&
      log.data.input.upstreamTaskIds.includes('upstream-text-task')
    ), true);
  } finally {
    await handlers.stopTextQueue();
  }
});

test('video route creates a queued video task and worker submits upstream', async () => {
  const user = createUser({
    email: 'queued-video@example.com',
    username: 'queued-video@example.com',
    name: 'Queued Video',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const handlers = registerGenerationRoutes(app, {
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs')),
    getRequestUserId: () => user.id,
    joinUrl,
    proxyRequest: async () => ({
      status: 200,
      data: { id: 'upstream-video-task', status: 'queued' },
    }),
    publicAsset: (asset) => asset,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({
      baseUrl: 'https://ark.cn-beijing.volces.com',
      apiKey: 'video-key',
      providerId: 'seedance',
    }),
  });

  try {
    const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/videos');
    const res = createMockRes();
    await route.handler(createMockReq({
      apiKeyId: 'video-key-id',
      providerId: 'seedance',
      model: 'doubao-seedance-2-0-mini-260615',
      prompt: 'make a short video',
      duration: 5,
      ratio: '16:9',
    }), res);

    assert.equal(res.statusCode, 202);
    assert.equal(res.body.task.status, 'queued');
    await waitFor(() => getTask(res.body.taskId).status === 'running');
    assert.equal(getTask(res.body.taskId).output.upstream.taskId, 'upstream-video-task');
  } finally {
    await handlers.stopGenerationQueue();
  }
});

test('image route creates a queued image task and worker saves generated asset', async () => {
  const user = createUser({
    email: 'queued-image@example.com',
    username: 'queued-image@example.com',
    name: 'Queued Image',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const upstreamRequests = [];
  const handlers = registerGenerationRoutes(app, {
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs-image-queue')),
    getRequestUserId: () => user.id,
    joinUrl,
    proxyRequest: async (url, options) => {
      upstreamRequests.push({
        url,
        body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body,
      });
      return {
        status: 200,
        data: { data: [{ b64_json: Buffer.from('queued image bytes').toString('base64') }] },
      };
    },
    publicAsset: (asset) => asset,
    readSecrets: async () => ({}),
    resolveApiCredentials: async ({ body }) => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'image-key',
      providerId: body.providerId || 'openai-compatible',
    }),
  });

  try {
    const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/images');
    const res = createMockRes();
    await route.handler(createMockReq({
      apiKeyId: 'image-key-id',
      providerId: 'openai-compatible',
      model: 'gpt-image-1',
      prompt: 'paint a small robot',
      size: '1024x1024',
      n: 1,
      upstreamTaskIds: ['upstream-image-task'],
    }), res);

    assert.equal(res.statusCode, 202);
    assert.equal(res.body.task.status, 'queued');
    await waitFor(() => getTask(res.body.taskId).status === 'succeeded');

    const updated = getTask(res.body.taskId);
    const logs = listTaskLogs(res.body.taskId);
    assert.equal(updated.output.length, 1);
    assert.equal(updated.output[0].type, 'image');
    assert.equal(fs.existsSync(updated.output[0].filePath), true);
    assert.deepEqual(updated.input.upstreamTaskIds, ['upstream-image-task']);
    assert.equal(upstreamRequests[0].url, 'https://api.example.com/v1/images/generations');
    assert.equal(upstreamRequests[0].body.upstreamTaskIds, undefined);
    assert.equal(logs.some((log) =>
      log.event === 'queued' &&
      log.data.input.promptPreview === 'paint a small robot' &&
      log.data.input.upstreamTaskIds.includes('upstream-image-task')
    ), true);
    assert.equal(logs.some((log) =>
      log.event === 'succeeded' &&
      log.data.model === 'gpt-image-1' &&
      log.data.upstreamTaskIds.includes('upstream-image-task')
    ), true);
  } finally {
    await handlers.stopGenerationQueue();
  }
});

test('task cancel route prevents a queued image worker from calling upstream', async () => {
  const user = createUser({
    email: 'queued-image-cancel-route@example.com',
    username: 'queued-image-cancel-route@example.com',
    name: 'Queued Image Cancel Route',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const upstreamRequests = [];
  const handlers = registerGenerationRoutes(app, {
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs-image-cancel-route')),
    getRequestUserId: () => user.id,
    joinUrl,
    proxyRequest: async (url, options) => {
      upstreamRequests.push({ url, options });
      return {
        status: 200,
        data: { data: [{ b64_json: Buffer.from('should not be generated').toString('base64') }] },
      };
    },
    publicAsset: (asset) => asset,
    readSecrets: async () => ({}),
    resolveApiCredentials: async ({ body }) => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'image-key',
      providerId: body.providerId || 'openai-compatible',
    }),
  });
  const taskService = createTaskService({
    publicAsset: (asset) => asset,
  });
  registerTaskRoutes(app, {
    getRequestUserId: () => user.id,
    taskService,
    retryGenerationTask: async () => {
      throw new Error('retry should not be called');
    },
  });

  try {
    const imageRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/images');
    const cancelRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/tasks/:taskId/cancel');
    const imageRes = createMockRes();
    await imageRoute.handler(createMockReq({
      apiKeyId: 'image-key-id',
      providerId: 'openai-compatible',
      model: 'gpt-image-1',
      prompt: 'cancel this before upstream',
      size: '1024x1024',
      n: 1,
    }), imageRes);

    const cancelReq = createMockReq();
    cancelReq.params = { taskId: imageRes.body.taskId };
    const cancelRes = createMockRes();
    cancelRoute.handler(cancelReq, cancelRes);

    await waitFor(() => {
      const stats = handlers.getGenerationQueueStats();
      return !stats.scheduled && stats.activeCount === 0;
    });

    const task = getTask(imageRes.body.taskId);
    const logs = listTaskLogs(imageRes.body.taskId);
    assert.equal(imageRes.statusCode, 202);
    assert.equal(cancelRes.statusCode, 200);
    assert.equal(cancelRes.body.task.status, 'cancelled');
    assert.equal(task.status, 'cancelled');
    assert.deepEqual(upstreamRequests, []);
    assert.equal(logs.some((log) => log.event === 'queued'), true);
    assert.equal(logs.some((log) => log.event === 'cancel_requested'), true);
    assert.equal(logs.some((log) => log.event === 'started'), false);
    assert.equal(logs.some((log) => log.event === 'succeeded'), false);
  } finally {
    await handlers.stopGenerationQueue();
  }
});

test('task cancel route keeps a running image task cancelled after upstream returns', async () => {
  const user = createUser({
    email: 'running-image-cancel-route@example.com',
    username: 'running-image-cancel-route@example.com',
    name: 'Running Image Cancel Route',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const upstreamRequests = [];
  const upstreamStarted = createDeferred();
  const upstreamResponse = createDeferred();
  const handlers = registerGenerationRoutes(app, {
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs-image-running-cancel-route')),
    getRequestUserId: () => user.id,
    joinUrl,
    proxyRequest: async (url, options) => {
      upstreamRequests.push({ url, options });
      upstreamStarted.resolve();
      return upstreamResponse.promise;
    },
    publicAsset: (asset) => asset,
    readSecrets: async () => ({}),
    resolveApiCredentials: async ({ body }) => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'image-key',
      providerId: body.providerId || 'openai-compatible',
    }),
  });
  const taskService = createTaskService({
    publicAsset: (asset) => asset,
  });
  registerTaskRoutes(app, {
    getRequestUserId: () => user.id,
    taskService,
    retryGenerationTask: async () => {
      throw new Error('retry should not be called');
    },
  });

  try {
    const imageRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/images');
    const cancelRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/tasks/:taskId/cancel');
    const imageRes = createMockRes();
    await imageRoute.handler(createMockReq({
      apiKeyId: 'image-key-id',
      providerId: 'openai-compatible',
      model: 'gpt-image-1',
      prompt: 'cancel this while upstream is running',
      size: '1024x1024',
      n: 1,
    }), imageRes);

    await upstreamStarted.promise;
    await waitFor(() => getTask(imageRes.body.taskId).status === 'running');

    const cancelReq = createMockReq();
    cancelReq.params = { taskId: imageRes.body.taskId };
    const cancelRes = createMockRes();
    cancelRoute.handler(cancelReq, cancelRes);

    upstreamResponse.resolve({
      status: 200,
      data: { data: [{ b64_json: Buffer.from('should not be saved').toString('base64') }] },
    });

    await waitFor(() => {
      const stats = handlers.getGenerationQueueStats();
      return !stats.scheduled && stats.activeCount === 0;
    });

    const task = getTask(imageRes.body.taskId);
    const logs = listTaskLogs(imageRes.body.taskId);
    assert.equal(imageRes.statusCode, 202);
    assert.equal(cancelRes.statusCode, 200);
    assert.equal(cancelRes.body.task.status, 'cancelled');
    assert.equal(task.status, 'cancelled');
    assert.deepEqual(task.output, null);
    assert.equal(listTaskAssets(task.id).length, 0);
    assert.equal(upstreamRequests.length, 1);
    assert.equal(logs.some((log) => log.event === 'started'), true);
    assert.equal(logs.some((log) => log.event === 'cancel_requested'), true);
    assert.equal(logs.some((log) => log.event === 'cancelled_after_upstream'), true);
    assert.equal(logs.some((log) => log.event === 'cancelled'), true);
    assert.equal(logs.some((log) => log.event === 'succeeded'), false);
  } finally {
    upstreamResponse.resolve({
      status: 200,
      data: { data: [{ b64_json: Buffer.from('cleanup').toString('base64') }] },
    });
    await handlers.stopGenerationQueue();
  }
});

test('task cancel route keeps a running video task cancelled after upstream returns', async () => {
  const user = createUser({
    email: 'running-video-cancel-route@example.com',
    username: 'running-video-cancel-route@example.com',
    name: 'Running Video Cancel Route',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const upstreamRequests = [];
  const upstreamStarted = createDeferred();
  const upstreamResponse = createDeferred();
  const handlers = registerGenerationRoutes(app, {
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs-video-running-cancel-route')),
    getRequestUserId: () => user.id,
    joinUrl,
    proxyRequest: async (url, options) => {
      upstreamRequests.push({ url, options });
      upstreamStarted.resolve();
      return upstreamResponse.promise;
    },
    publicAsset: (asset) => asset,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({
      baseUrl: 'https://ark.cn-beijing.volces.com',
      apiKey: 'video-key',
      providerId: 'seedance',
    }),
  });
  const taskService = createTaskService({
    publicAsset: (asset) => asset,
  });
  registerTaskRoutes(app, {
    getRequestUserId: () => user.id,
    taskService,
    retryGenerationTask: async () => {
      throw new Error('retry should not be called');
    },
  });

  try {
    const videoRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/videos');
    const cancelRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/tasks/:taskId/cancel');
    const videoRes = createMockRes();
    await videoRoute.handler(createMockReq({
      apiKeyId: 'video-key-id',
      providerId: 'seedance',
      model: 'doubao-seedance-2-0-mini-260615',
      prompt: 'cancel this video while upstream is running',
      duration: 5,
      ratio: '16:9',
    }), videoRes);

    await upstreamStarted.promise;
    await waitFor(() => getTask(videoRes.body.taskId).status === 'running');

    const cancelReq = createMockReq();
    cancelReq.params = { taskId: videoRes.body.taskId };
    const cancelRes = createMockRes();
    cancelRoute.handler(cancelReq, cancelRes);

    upstreamResponse.resolve({
      status: 200,
      data: { id: 'upstream-video-after-cancel', status: 'queued' },
    });

    await waitFor(() => {
      const stats = handlers.getGenerationQueueStats();
      return !stats.scheduled && stats.activeCount === 0;
    });

    const task = getTask(videoRes.body.taskId);
    const logs = listTaskLogs(videoRes.body.taskId);
    assert.equal(videoRes.statusCode, 202);
    assert.equal(cancelRes.statusCode, 200);
    assert.equal(cancelRes.body.task.status, 'cancelled');
    assert.equal(task.status, 'cancelled');
    assert.deepEqual(task.output, null);
    assert.equal(listTaskAssets(task.id).length, 0);
    assert.equal(upstreamRequests.length, 1);
    assert.equal(logs.some((log) => log.event === 'started'), true);
    assert.equal(logs.some((log) => log.event === 'upstream_video_submitted'), true);
    assert.equal(logs.some((log) => log.event === 'cancel_requested'), true);
    assert.equal(logs.some((log) =>
      log.event === 'cancelled_after_upstream' &&
      log.data.upstreamTaskId === 'upstream-video-after-cancel'
    ), true);
    assert.equal(logs.some((log) => log.event === 'cancelled'), true);
    assert.equal(logs.some((log) => log.event === 'succeeded'), false);
  } finally {
    upstreamResponse.resolve({
      status: 200,
      data: { id: 'cleanup-video-task', status: 'queued' },
    });
    await handlers.stopGenerationQueue();
  }
});

test('sync generation routes are unavailable unless explicitly enabled', async () => {
  const user = createUser({
    email: 'sync-disabled@example.com',
    username: 'sync-disabled@example.com',
    name: 'Sync Disabled',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const modelHandlers = registerModelProxyRoutes(app, {
    enableGenericProxy: false,
    joinUrl,
    proxyAllowlist: [],
    proxyRequest: async () => ({ status: 200, data: {} }),
    getRequestUserId: () => user.id,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
    requireAdmin: () => true,
    resolveDirectCredentials: () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
  });
  const generationHandlers = registerGenerationRoutes(app, {
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs-sync-disabled')),
    getRequestUserId: () => user.id,
    joinUrl,
    proxyRequest: async () => ({ status: 200, data: {} }),
    publicAsset: (asset) => asset,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
  });

  try {
    const syncRoutes = app.routes
      .filter((item) => item.pathname.endsWith('/sync'))
      .map((item) => item.pathname)
      .sort();
    assert.deepEqual(syncRoutes, []);
  } finally {
    await modelHandlers.stopTextQueue();
    await generationHandlers.stopGenerationQueue();
  }
});

test('sync generation routes can be enabled for local migration only', async () => {
  const user = createUser({
    email: 'sync-enabled@example.com',
    username: 'sync-enabled@example.com',
    name: 'Sync Enabled',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const modelHandlers = registerModelProxyRoutes(app, {
    enableGenericProxy: false,
    joinUrl,
    proxyAllowlist: [],
    proxyRequest: async () => ({ status: 200, data: {} }),
    getRequestUserId: () => user.id,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
    requireAdmin: () => true,
    resolveDirectCredentials: () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
    allowSyncGeneration: true,
  });
  const generationHandlers = registerGenerationRoutes(app, {
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs-sync-enabled')),
    getRequestUserId: () => user.id,
    joinUrl,
    proxyRequest: async () => ({ status: 200, data: {} }),
    publicAsset: (asset) => asset,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
    allowSyncGeneration: true,
  });

  try {
    const syncRoutes = app.routes
      .filter((item) => item.pathname.endsWith('/sync'))
      .map((item) => item.pathname)
      .sort();
    assert.deepEqual(syncRoutes, ['/api/chat/sync', '/api/claude/sync', '/api/images/sync', '/api/videos/sync']);
  } finally {
    await modelHandlers.stopTextQueue();
    await generationHandlers.stopGenerationQueue();
  }
});

test('text and generation queues expose configured concurrency in stats', async () => {
  const user = createUser({
    email: 'queue-concurrency@example.com',
    username: 'queue-concurrency@example.com',
    name: 'Queue Concurrency',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const modelHandlers = registerModelProxyRoutes(app, {
    enableGenericProxy: false,
    joinUrl,
    proxyAllowlist: [],
    proxyRequest: async () => ({ status: 200, data: {} }),
    getRequestUserId: () => user.id,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
    requireAdmin: () => true,
    resolveDirectCredentials: () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
    textQueueConcurrency: 5,
  });
  const generationHandlers = registerGenerationRoutes(app, {
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs-queue-concurrency')),
    getRequestUserId: () => user.id,
    joinUrl,
    proxyRequest: async () => ({ status: 200, data: {} }),
    publicAsset: (asset) => asset,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
    generationQueueConcurrency: 3,
  });

  try {
    assert.equal(modelHandlers.getTextQueueStats().concurrency, 5);
    assert.equal(generationHandlers.getGenerationQueueStats().concurrency, 3);
  } finally {
    await modelHandlers.stopTextQueue();
    await generationHandlers.stopGenerationQueue();
  }
});

test('text retry logs source and replacement task relationship', async () => {
  const user = createUser({
    email: 'retry-text-log@example.com',
    username: 'retry-text-log@example.com',
    name: 'Retry Text Log',
    passwordHash: 'test',
  });
  const failed = createTask({
    userId: user.id,
    nodeType: 'text',
    providerId: 'openai-compatible',
    model: 'gpt-test',
    status: 'failed',
    input: {
      baseUrl: 'https://api.example.com',
      providerId: 'openai-compatible',
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'retry text' }],
      upstreamTaskIds: ['old-upstream-text-input'],
      sourceTaskId: 'source-text-task',
    },
    output: {
      upstream: { taskId: 'old-upstream-text-output' },
    },
  });
  const app = createFakeApp();
  const handlers = registerModelProxyRoutes(app, {
    enableGenericProxy: false,
    joinUrl,
    proxyAllowlist: [],
    proxyRequest: async () => ({
      status: 200,
      data: { choices: [{ message: { role: 'assistant', content: 'retried ok' } }] },
    }),
    getRequestUserId: () => user.id,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => {
      throw new Error('saved key path should not be used');
    },
    requireAdmin: () => true,
    resolveDirectCredentials: () => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'direct-key',
      providerId: 'openai-compatible',
    }),
  });

  try {
    const result = await handlers.retryTextTask({ userId: user.id, task: failed });
    assert.equal(result.status, 202);
    const nextTask = result.data.task;
    assert.equal(nextTask.retryOf, failed.id);

    const sourceLog = listTaskLogs(failed.id).find((log) => log.event === 'retry_created');
    const nextLog = listTaskLogs(nextTask.id).find((log) => log.event === 'created_from_retry');
    assert.equal(sourceLog.data.newTaskId, nextTask.id);
    assert.equal(sourceLog.data.model, 'gpt-test');
    assert.equal(sourceLog.data.upstreamTaskId, 'old-upstream-text-output');
    assert.deepEqual(sourceLog.data.upstreamTaskIds, [
      'old-upstream-text-input',
      'source-text-task',
      'old-upstream-text-output',
    ]);
    assert.equal(nextLog.data.sourceTaskId, failed.id);
    assert.equal(nextLog.data.retryOf, failed.id);
    assert.deepEqual(nextLog.data.upstreamTaskIds, sourceLog.data.upstreamTaskIds);
  } finally {
    await handlers.stopTextQueue();
  }
});

test('image and video retries log source and replacement task relationship', async () => {
  const user = createUser({
    email: 'retry-generation-log@example.com',
    username: 'retry-generation-log@example.com',
    name: 'Retry Generation Log',
    passwordHash: 'test',
  });
  const failedImage = createTask({
    userId: user.id,
    nodeType: 'image',
    providerId: 'openai-compatible',
    model: 'gpt-image-test',
    status: 'failed',
    input: {
      apiKeyId: 'image-key-id',
      providerId: 'openai-compatible',
      model: 'gpt-image-test',
      prompt: 'retry image',
      size: '1024x1024',
      n: 1,
      response_format: 'b64_json',
      upstreamTaskIds: ['old-upstream-image-input'],
      sourceTaskId: 'source-image-task',
    },
    output: {
      upstream: { taskId: 'old-upstream-image-output' },
    },
  });
  const failedVideo = createTask({
    userId: user.id,
    nodeType: 'video',
    providerId: 'seedance',
    model: 'doubao-seedance-2-0-mini-260615',
    status: 'failed',
    input: {
      apiKeyId: 'video-key-id',
      providerId: 'seedance',
      model: 'doubao-seedance-2-0-mini-260615',
      prompt: 'retry video',
      mode: 'images-to-video',
      content: [
        { type: 'text', text: 'retry video with persisted content' },
        { type: 'image_url', image_url: { url: 'https://cdn.example/retry-first.png' }, role: 'reference_image' },
        { type: 'video_url', video_url: { url: 'https://cdn.example/retry-ref.mp4' }, role: 'reference_video' },
        { type: 'audio_url', audio_url: { url: 'https://cdn.example/retry-ref.mp3' }, role: 'reference_audio' },
      ],
      duration: 5,
      ratio: '16:9',
      generate_audio: true,
      upstreamTaskIds: ['old-upstream-video-input'],
    },
    output: {
      upstream: { taskId: 'old-upstream-video-task' },
    },
  });
  const app = createFakeApp();
  const handlers = registerGenerationRoutes(app, {
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'retry-outputs')),
    getRequestUserId: () => user.id,
    joinUrl,
    proxyRequest: async (url) => {
      if (url.includes('/v1/images/generations')) {
        return {
          status: 200,
          data: { data: [{ b64_json: Buffer.from('fake image').toString('base64') }] },
        };
      }
      return {
        status: 200,
        data: { id: 'new-upstream-video-task', status: 'queued' },
      };
    },
    publicAsset: (asset) => asset,
    readSecrets: async () => ({}),
    resolveApiCredentials: async ({ body }) => ({
      baseUrl: body.providerId === 'seedance'
        ? 'https://ark.cn-beijing.volces.com'
        : 'https://api.example.com',
      apiKey: 'retry-key',
      providerId: body.providerId || 'openai-compatible',
    }),
  });

  try {
    const req = createMockReq();
    const imageResult = await handlers.retryGenerationTask({ req, userId: user.id, task: failedImage });
    const videoResult = await handlers.retryGenerationTask({ req, userId: user.id, task: failedVideo });

    assert.equal(imageResult.status, 202);
    assert.equal(videoResult.status, 202);

    const nextImage = imageResult.data.task;
    const nextVideo = videoResult.data.task;
    assert.equal(nextImage.retryOf, failedImage.id);
    assert.equal(nextVideo.retryOf, failedVideo.id);
    assert.equal(nextVideo.input.mode, 'images-to-video');
    assert.deepEqual(nextVideo.input.content, failedVideo.input.content);
    assert.equal(nextVideo.input.generate_audio, true);

    const imageSourceLog = listTaskLogs(failedImage.id).find((log) => log.event === 'retry_created');
    const imageNextLog = listTaskLogs(nextImage.id).find((log) => log.event === 'created_from_retry');
    assert.equal(imageSourceLog.data.newTaskId, nextImage.id);
    assert.equal(imageSourceLog.data.model, 'gpt-image-test');
    assert.equal(imageSourceLog.data.upstreamTaskId, 'old-upstream-image-output');
    assert.deepEqual(imageSourceLog.data.upstreamTaskIds, [
      'old-upstream-image-input',
      'source-image-task',
      'old-upstream-image-output',
    ]);
    assert.equal(imageNextLog.data.sourceTaskId, failedImage.id);
    assert.deepEqual(imageNextLog.data.upstreamTaskIds, imageSourceLog.data.upstreamTaskIds);

    const videoSourceLog = listTaskLogs(failedVideo.id).find((log) => log.event === 'retry_created');
    const videoNextLog = listTaskLogs(nextVideo.id).find((log) => log.event === 'created_from_retry');
    assert.equal(videoSourceLog.data.newTaskId, nextVideo.id);
    assert.equal(videoSourceLog.data.upstreamTaskId, 'old-upstream-video-task');
    assert.deepEqual(videoSourceLog.data.upstreamTaskIds, [
      'old-upstream-video-input',
      'old-upstream-video-task',
    ]);
    assert.equal(videoNextLog.data.sourceTaskId, failedVideo.id);
    assert.deepEqual(videoNextLog.data.upstreamTaskIds, videoSourceLog.data.upstreamTaskIds);
  } finally {
    await handlers.stopGenerationQueue();
  }
});
