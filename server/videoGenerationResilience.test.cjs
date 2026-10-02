// 视频生成服务：凭据回退与取消时机。
//
// 为什么单独一个文件：`runVideoTask` 是整条视频链路的核心，其中凭据回退、
// 取消检查和多模态提交顺序原本没有测试保护。服务端工作流编排要复用这段逻辑，
// 所以先用测试把它钉住，再动重构。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-video-resilience-test-'));
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
const { createVideoGenerationService } = require('./services/videoGenerationService.cjs');
const { joinUrl } = require('./services/proxyService.cjs');

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.WORKBENCH_ALLOW_PRIVATE_MEDIA_FETCH;
});

const PUBLIC_BASE = 'https://workbench.example';
const ARK_BASE = 'https://ark.cn-beijing.volces.com';

let userSeq = 0;
function nextUser(label) {
  userSeq += 1;
  const email = `${label}-${userSeq}@example.com`;
  return createUser({ email, username: email, name: label, passwordHash: 'test' });
}

function buildService({ proxyRequest, resolveApiCredentials }) {
  return createVideoGenerationService({
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs')),
    joinUrl,
    publicAsset: (asset) => ({
      id: asset.id,
      type: asset.type,
      url: asset.url,
      fileName: asset.fileName,
    }),
    proxyRequest,
    resolveApiCredentials,
  });
}

function createBody(overrides = {}) {
  return {
    apiKeyId: 'key-primary',
    providerId: 'seedance',
    model: 'doubao-seedance-2-0-mini-260615',
    prompt: 'a calm lake at sunrise',
    duration: 5,
    ratio: '16:9',
    ...overrides,
  };
}

function createTaskFor(service, userId, body = createBody()) {
  return service.createVideoTask(userId, { ...body, publicBaseUrl: PUBLIC_BASE }, 'running');
}

// 上游返回队列中的任务；查询时返回成功并给出视频地址。
function upstreamQueueThenSuccess() {
  return async (_url, options) => {
    if (options.method === 'GET') {
      return {
        status: 200,
        data: {
          id: 'ark-task-ok',
          status: 'succeeded',
          content: [{ type: 'video_url', video_url: { url: 'https://cdn.example/result.mp4' } }],
        },
      };
    }
    return { status: 200, data: { id: 'ark-task-ok', status: 'queued' } };
  };
}

test('视频任务在上游 429 时回退到下一个平台模型路由，并在任务日志记录回退', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(Buffer.from('fake mp4'), {
    status: 200,
    headers: { 'content-type': 'video/mp4' },
  });

  try {
    const user = nextUser('video-fallback');
    const posts = [];
    const service = buildService({
      proxyRequest: async (url, options) => {
        if (options.method === 'GET') return upstreamQueueThenSuccess()(url, options);
        posts.push({ url, authorization: options.headers.Authorization });
        // 第一条路由限流，第二条成功
        if (posts.length === 1) return { status: 429, statusText: 'Too Many Requests', data: { error: 'rate limited' } };
        return { status: 200, data: { id: 'ark-task-ok', status: 'queued' } };
      },
      resolveApiCredentials: async () => ({
        baseUrl: ARK_BASE,
        apiKey: 'primary-key',
        providerId: 'seedance',
        apiKeyId: 'key-primary',
        platformModelId: 'pm-1',
        platformRouteId: 'route-a',
        fallbackCredentials: [{
          baseUrl: ARK_BASE,
          apiKey: 'fallback-key',
          providerId: 'seedance',
          apiKeyId: 'key-fallback',
          platformModelId: 'pm-1',
          platformRouteId: 'route-b',
        }],
      }),
    });

    const created = await service.generateVideo({
      req: { headers: { host: 'workbench.example' }, protocol: 'https' },
      userId: user.id,
      body: createBody(),
      secrets: {},
    });

    assert.equal(created.status, 202);
    assert.equal(posts.length, 2, '应当向上游提交两次');
    assert.equal(posts[0].authorization, 'Bearer primary-key');
    assert.equal(posts[1].authorization, 'Bearer fallback-key', '第二次应当换用回退凭据');

    const taskId = created.data.taskId;
    const fallbackLog = listTaskLogs(taskId).find((log) => log.event === 'platform_model_route_fallback');
    assert.ok(fallbackLog, '应当写入 platform_model_route_fallback 日志');
    assert.equal(fallbackLog.level, 'warn');
    assert.equal(fallbackLog.data.attempt, 1);
    assert.equal(fallbackLog.data.apiKeyId, 'key-primary');
    assert.equal(fallbackLog.data.platformRouteId, 'route-a');
    assert.equal(fallbackLog.data.upstreamStatus, 429);

    const succeededLogs = listTaskLogs(taskId).filter((log) => log.event === 'upstream_video_submitted');
    assert.equal(succeededLogs.length, 1, '只有成功那次才记录 submitted');
    assert.equal(succeededLogs[0].data.platformRouteId, 'route-b');

    const finalized = await service.getVideoTask({ taskId, userId: user.id, query: {}, secrets: {} });
    assert.equal(finalized.status, 200);
    assert.equal(getTask(taskId).status, 'succeeded');
    assert.equal(listTaskAssets(taskId).length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('视频任务在 4xx 业务错误时不回退，直接失败并保留上游错误', async () => {
  const user = nextUser('video-no-fallback');
  const posts = [];
  const service = buildService({
    proxyRequest: async (_url, options) => {
      posts.push(options.method);
      return {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'x-request-id': 'req-video-400' },
        data: { error: { message: 'Invalid parameter: duration', code: 'InvalidParameter' } },
      };
    },
    resolveApiCredentials: async () => ({
      baseUrl: ARK_BASE,
      apiKey: 'primary-key',
      providerId: 'seedance',
      fallbackCredentials: [{ baseUrl: ARK_BASE, apiKey: 'fallback-key', providerId: 'seedance' }],
    }),
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  const task = createTaskFor(service, user.id);
  let result;
  try {
    result = await service.runVideoTask({
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
  assert.equal(posts.length, 1, '4xx 业务错误不应回退到第二条路由');
  const failed = getTask(task.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.upstreamCode, 'InvalidParameter');
  assert.equal(failed.error.upstreamRequestId, 'req-video-400');
  assert.equal(listTaskAssets(task.id).length, 0);
});

test('视频任务在所有路由都失败时标记 failed，且回退次数等于凭据数', async () => {
  const user = nextUser('video-all-fail');
  const posts = [];
  const service = buildService({
    proxyRequest: async (_url, options) => {
      posts.push(options.method);
      return { status: 503, statusText: 'Service Unavailable', data: { error: 'upstream down' } };
    },
    resolveApiCredentials: async () => ({
      baseUrl: ARK_BASE,
      apiKey: 'primary-key',
      providerId: 'seedance',
      fallbackCredentials: [{ baseUrl: ARK_BASE, apiKey: 'fallback-key', providerId: 'seedance' }],
    }),
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  const task = createTaskFor(service, user.id);
  let result;
  try {
    result = await service.runVideoTask({
      req: { headers: { host: 'workbench.example' }, protocol: 'https' },
      userId: user.id,
      body: createBody(),
      secrets: {},
      task,
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(result.status, 503);
  assert.equal(posts.length, 2, '两条路由都应尝试');
  assert.equal(getTask(task.id).status, 'failed');
  assert.equal(listTaskLogs(task.id).filter((log) => log.event === 'platform_model_route_fallback').length, 1);
  assert.equal(listTaskAssets(task.id).length, 0);
});

test('视频任务在前一条路由缺少 API Key 时跳过它，改用下一条可用凭据', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(Buffer.from('fake mp4'), {
    status: 200,
    headers: { 'content-type': 'video/mp4' },
  });

  try {
    const user = nextUser('video-skip-empty');
    const posts = [];
    const service = buildService({
      proxyRequest: async (url, options) => {
        if (options.method === 'GET') return upstreamQueueThenSuccess()(url, options);
        posts.push(options.headers.Authorization);
        return { status: 200, data: { id: 'ark-task-ok', status: 'queued' } };
      },
      resolveApiCredentials: async () => ({
        // 第一条没有 apiKey：非末次应当直接跳过，而不是报 400
        baseUrl: ARK_BASE,
        apiKey: '',
        providerId: 'seedance',
        fallbackCredentials: [{ baseUrl: ARK_BASE, apiKey: 'fallback-key', providerId: 'seedance' }],
      }),
    });

    const created = await service.generateVideo({
      req: { headers: { host: 'workbench.example' }, protocol: 'https' },
      userId: user.id,
      body: createBody(),
      secrets: {},
    });

    assert.equal(created.status, 202, '缺 Key 的第一条不应当直接失败');
    assert.equal(posts.length, 1);
    assert.equal(posts[0], 'Bearer fallback-key');
    // 跳过缺 Key 的路由不写回退日志（回退日志只针对上游失败）
    assert.equal(
      listTaskLogs(created.data.taskId).filter((log) => log.event === 'platform_model_route_fallback').length,
      0
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('视频任务在没有任何可用凭据时失败，且不向上游发请求', async () => {
  const user = nextUser('video-no-credentials');
  let posted = 0;
  const service = buildService({
    proxyRequest: async () => {
      posted += 1;
      return { status: 200, data: {} };
    },
    resolveApiCredentials: async () => ({ baseUrl: '', apiKey: '', providerId: 'seedance' }),
  });

  const task = createTaskFor(service, user.id);
  const result = await service.runVideoTask({
    req: { headers: { host: 'workbench.example' }, protocol: 'https' },
    userId: user.id,
    body: createBody(),
    secrets: {},
    task,
  });

  assert.equal(result.status, 400);
  assert.equal(result.data.error, 'Base URL is required');
  assert.equal(posted, 0, '不应向上游发请求');
  assert.equal(getTask(task.id).status, 'failed');
});

test('worker 启动前任务已被取消：不提交上游，记录 cancelled_before_start 并返回 409', async () => {
  const user = nextUser('video-cancel-before');
  let posted = 0;
  const service = buildService({
    proxyRequest: async () => {
      posted += 1;
      return { status: 200, data: {} };
    },
    resolveApiCredentials: async () => ({ baseUrl: ARK_BASE, apiKey: 'k', providerId: 'seedance' }),
  });

  const task = createTaskFor(service, user.id);
  updateTask(task.id, { status: 'cancelled' });

  const result = await service.runVideoTask({
    req: { headers: { host: 'workbench.example' }, protocol: 'https' },
    userId: user.id,
    body: createBody(),
    secrets: {},
    task,
  });

  assert.equal(result.status, 409);
  assert.equal(result.data.error, 'Task was cancelled.');
  assert.equal(posted, 0, '取消后不应提交上游');
  const logs = listTaskLogs(task.id);
  assert.equal(logs.some((log) => log.event === 'cancelled_before_start'), true);
  assert.equal(logs.some((log) => log.event === 'upstream_video_submitted'), false);
  assert.equal(getTask(task.id).status, 'cancelled');
});

test('上游已提交但随后被取消：不落盘、记 cancelled_after_upstream、返回 409', async () => {
  const user = nextUser('video-cancel-after');
  let taskId = '';
  const service = buildService({
    proxyRequest: async () => {
      // 模拟"用户在上游返回前取消"
      updateTask(taskId, { status: 'cancelled' });
      return { status: 200, data: { id: 'ark-task-late', status: 'queued' } };
    },
    resolveApiCredentials: async () => ({ baseUrl: ARK_BASE, apiKey: 'k', providerId: 'seedance' }),
  });

  const task = createTaskFor(service, user.id);
  taskId = task.id;

  const result = await service.runVideoTask({
    req: { headers: { host: 'workbench.example' }, protocol: 'https' },
    userId: user.id,
    body: createBody(),
    secrets: {},
    task,
  });

  assert.equal(result.status, 409);
  assert.equal(result.data.error, 'Task was cancelled.');
  const logs = listTaskLogs(task.id);
  // 注意事件顺序：上游提交成功的日志在取消检查**之前**写入，
  // 所以取消后仍会留下 upstream_video_submitted（说明确实提交过），
  // 紧接着才是 cancelled_after_upstream（说明产物被丢弃）。
  assert.equal(logs.some((log) => log.event === 'upstream_video_submitted'), true);
  assert.equal(logs.some((log) => log.event === 'cancelled_after_upstream'), true);
  const cancelledLog = logs.find((log) => log.event === 'cancelled_after_upstream');
  assert.equal(cancelledLog.data.upstreamTaskId, 'ark-task-late');
  assert.equal(listTaskAssets(task.id).length, 0, '取消后不应写入资产');
  assert.equal(getTask(task.id).status, 'cancelled', '取消状态不应被覆盖为 running');
});
