// 图片生成服务：凭据回退与取消时机。
//
// 与 videoGenerationResilience.test.cjs 对称。这两条链路即将被抽成同一个
// runGenerationTask，所以先把它们各自的行为钉住，抽取后才能确认行为没变。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-image-resilience-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');
process.env.WORKBENCH_ALLOW_PRIVATE_MEDIA_FETCH = 'true';

const {
  createUser,
  db,
  getTask,
  listTaskAssets,
  listTaskLogs,
  updateTask,
} = require('./db.cjs');
const { LocalAssetStorage } = require('./assetStorage.cjs');
const { createImageGenerationService } = require('./services/imageGenerationService.cjs');
const { joinUrl } = require('./services/proxyService.cjs');

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.WORKBENCH_ALLOW_PRIVATE_MEDIA_FETCH;
});

const PUBLIC_BASE = 'https://workbench.example';
const API_BASE = 'https://api.example.com';
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let userSeq = 0;
function nextUser(label) {
  userSeq += 1;
  const email = `${label}-${userSeq}@example.com`;
  return createUser({ email, username: email, name: label, passwordHash: 'test' });
}

function buildService({ proxyRequest, resolveApiCredentials }) {
  return createImageGenerationService({
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs')),
    joinUrl,
    publicAsset: (asset) => ({ id: asset.id, type: asset.type, url: asset.url, fileName: asset.fileName }),
    proxyRequest,
    resolveApiCredentials,
  });
}

function createBody(overrides = {}) {
  return {
    apiKeyId: 'key-primary',
    providerId: 'openai-compatible',
    model: 'gpt-image-1',
    prompt: 'a product photo on a desk',
    size: '1024x1024',
    n: 1,
    ...overrides,
  };
}

function createTaskFor(service, userId, body = createBody()) {
  return service.createImageTask(userId, { ...body, publicBaseUrl: PUBLIC_BASE }, 'running');
}

function successPayload() {
  return { status: 200, data: { data: [{ b64_json: ONE_PIXEL_PNG }] } };
}

test('图片任务在上游 503 时回退到下一个平台模型路由，并落盘成功产物', async () => {
  const user = nextUser('image-fallback');
  const posts = [];
  const service = buildService({
    proxyRequest: async (_url, options) => {
      posts.push(options.headers.Authorization);
      if (posts.length === 1) {
        return { status: 503, statusText: 'Service Unavailable', data: { error: 'upstream down' } };
      }
      return successPayload();
    },
    resolveApiCredentials: async () => ({
      baseUrl: API_BASE,
      apiKey: 'primary-key',
      providerId: 'openai-compatible',
      apiKeyId: 'key-primary',
      platformModelId: 'pm-1',
      platformRouteId: 'route-a',
      fallbackCredentials: [{
        baseUrl: API_BASE,
        apiKey: 'fallback-key',
        providerId: 'openai-compatible',
        apiKeyId: 'key-fallback',
        platformModelId: 'pm-1',
        platformRouteId: 'route-b',
      }],
    }),
  });

  const task = createTaskFor(service, user.id);
  const result = await service.runImageTask({
    req: { headers: { host: 'workbench.example' }, protocol: 'https' },
    userId: user.id,
    body: createBody(),
    secrets: {},
    task,
  });

  assert.equal(result.status, 200);
  assert.equal(posts.length, 2, '应当向上游提交两次');
  assert.equal(posts[0], 'Bearer primary-key');
  assert.equal(posts[1], 'Bearer fallback-key');

  const fallbackLog = listTaskLogs(task.id).find((log) => log.event === 'platform_model_route_fallback');
  assert.ok(fallbackLog, '应当写入回退日志');
  assert.equal(fallbackLog.level, 'warn');
  assert.equal(fallbackLog.data.attempt, 1);
  assert.equal(fallbackLog.data.platformRouteId, 'route-a');
  assert.equal(fallbackLog.data.upstreamStatus, 503);

  assert.equal(getTask(task.id).status, 'succeeded');
  assert.equal(listTaskAssets(task.id).length, 1);
  assert.equal(listTaskAssets(task.id)[0].type, 'image');
});

test('图片任务在 400 业务错误时不回退，直接失败', async () => {
  const user = nextUser('image-no-fallback');
  const posts = [];
  const service = buildService({
    proxyRequest: async (_url, options) => {
      posts.push(options.method);
      return {
        status: 400,
        statusText: 'Bad Request',
        data: { error: { message: 'size is not supported by this model', code: 'InvalidParameter' } },
      };
    },
    resolveApiCredentials: async () => ({
      baseUrl: API_BASE,
      apiKey: 'primary-key',
      providerId: 'openai-compatible',
      fallbackCredentials: [{ baseUrl: API_BASE, apiKey: 'fallback-key', providerId: 'openai-compatible' }],
    }),
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  const task = createTaskFor(service, user.id);
  let result;
  try {
    result = await service.runImageTask({
      req: { headers: { host: 'workbench.example' }, protocol: 'https' },
      userId: user.id,
      body: createBody(),
      secrets: {},
      task,
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(result.status, 400);
  assert.equal(posts.length, 1, '4xx 不应回退');
  assert.equal(getTask(task.id).status, 'failed');
  assert.equal(listTaskAssets(task.id).length, 0);
});

test('图片任务在前一条路由缺少 API Key 时跳过它', async () => {
  const user = nextUser('image-skip-empty');
  const posts = [];
  const service = buildService({
    proxyRequest: async (_url, options) => {
      posts.push(options.headers.Authorization);
      return successPayload();
    },
    resolveApiCredentials: async () => ({
      baseUrl: API_BASE,
      apiKey: '',
      providerId: 'openai-compatible',
      fallbackCredentials: [{ baseUrl: API_BASE, apiKey: 'fallback-key', providerId: 'openai-compatible' }],
    }),
  });

  const task = createTaskFor(service, user.id);
  const result = await service.runImageTask({
    req: { headers: { host: 'workbench.example' }, protocol: 'https' },
    userId: user.id,
    body: createBody(),
    secrets: {},
    task,
  });

  assert.equal(result.status, 200);
  assert.equal(posts.length, 1);
  assert.equal(posts[0], 'Bearer fallback-key');
});

test('图片任务在没有任何可用凭据时失败，且不向上游发请求', async () => {
  const user = nextUser('image-no-credentials');
  let posted = 0;
  const service = buildService({
    proxyRequest: async () => {
      posted += 1;
      return successPayload();
    },
    resolveApiCredentials: async () => ({ baseUrl: '', apiKey: '', providerId: 'openai-compatible' }),
  });

  const task = createTaskFor(service, user.id);
  const result = await service.runImageTask({
    req: { headers: { host: 'workbench.example' }, protocol: 'https' },
    userId: user.id,
    body: createBody(),
    secrets: {},
    task,
  });

  assert.equal(result.status, 400);
  assert.equal(result.data.error, 'Base URL is required');
  assert.equal(posted, 0);
  assert.equal(getTask(task.id).status, 'failed');
});

test('图片任务在 worker 启动前已被取消：不提交上游、不落盘、返回 409', async () => {
  const user = nextUser('image-cancel-before');
  let posted = 0;
  const service = buildService({
    proxyRequest: async () => {
      posted += 1;
      return successPayload();
    },
    resolveApiCredentials: async () => ({ baseUrl: API_BASE, apiKey: 'k', providerId: 'openai-compatible' }),
  });

  const task = createTaskFor(service, user.id);
  updateTask(task.id, { status: 'cancelled' });

  const result = await service.runImageTask({
    req: { headers: { host: 'workbench.example' }, protocol: 'https' },
    userId: user.id,
    body: createBody(),
    secrets: {},
    task,
  });

  assert.equal(result.status, 409);
  assert.equal(posted, 0, '取消后不应提交上游');
  const logs = listTaskLogs(task.id);
  assert.equal(logs.some((log) => log.event === 'cancelled_before_start'), true);
  assert.equal(logs.some((log) => log.event === 'upstream_image_submitted'), false);
  assert.equal(listTaskAssets(task.id).length, 0);
  assert.equal(getTask(task.id).status, 'cancelled');
});

test('图片任务在上游返回后被取消：丢弃已下载的产物、不落盘', async () => {
  const user = nextUser('image-cancel-after');
  let taskId = '';
  const service = buildService({
    proxyRequest: async () => {
      // 模拟"用户在上游返回前取消"
      updateTask(taskId, { status: 'cancelled' });
      return successPayload();
    },
    resolveApiCredentials: async () => ({ baseUrl: API_BASE, apiKey: 'k', providerId: 'openai-compatible' }),
  });

  const task = createTaskFor(service, user.id);
  taskId = task.id;

  const result = await service.runImageTask({
    req: { headers: { host: 'workbench.example' }, protocol: 'https' },
    userId: user.id,
    body: createBody(),
    secrets: {},
    task,
  });

  assert.equal(result.status, 409);
  const logs = listTaskLogs(task.id);
  assert.equal(logs.some((log) => log.event === 'cancelled_after_upstream'), true);
  assert.equal(listTaskAssets(task.id).length, 0, '取消后不应写入资产');
  assert.equal(getTask(task.id).status, 'cancelled', '取消状态不应被覆盖为 succeeded');
});
