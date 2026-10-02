const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-video-service-test-'));
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

test('video generation keeps local task running and finalizes it after upstream succeeds', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(Buffer.from('fake mp4'), {
    status: 200,
    headers: { 'content-type': 'video/mp4' },
  });

  const user = createUser({
    email: 'video-owner@example.com',
    username: 'video-owner@example.com',
    name: 'Video Owner',
    passwordHash: 'test',
  });
  const assetStorage = new LocalAssetStorage(path.join(tempDir, 'outputs'));
  const requests = [];
  const service = createVideoGenerationService({
    assetStorage,
    joinUrl,
    publicAsset: (asset) => ({
      id: asset.id,
      type: asset.type,
      url: asset.url,
      fileName: asset.fileName,
    }),
    proxyRequest: async (url, options) => {
      requests.push({ url, method: options.method, body: options.body });
      if (options.method === 'GET') {
        return {
          status: 200,
          data: {
            id: 'ark-task-1',
            status: 'succeeded',
            content: [
              { type: 'video_url', video_url: { url: 'https://cdn.example/result.mp4' } },
            ],
          },
        };
      }
      return {
        status: 200,
        data: {
          id: 'ark-task-1',
          status: 'queued',
        },
      };
    },
    resolveApiCredentials: async () => ({
      baseUrl: 'https://ark.cn-beijing.volces.com',
      apiKey: 'test-key',
      providerId: 'seedance',
    }),
  });

  try {
    const created = await service.generateVideo({
      req: { headers: { host: 'workbench.example' }, protocol: 'https' },
      userId: user.id,
      body: {
        apiKeyId: 'key-1',
        providerId: 'seedance',
        model: 'doubao-seedance-2-0-mini-260615',
        prompt: 'make a short video',
        duration: 5,
        ratio: '16:9',
      },
      secrets: {},
    });

    assert.equal(created.status, 202);
    const taskId = created.data.taskId;
    const runningTask = getTask(taskId);
    assert.equal(runningTask.status, 'running');
    assert.equal(runningTask.output.upstream.taskId, 'ark-task-1');

    const finalized = await service.getVideoTask({
      taskId,
      userId: user.id,
      query: {},
      secrets: {},
    });

    assert.equal(finalized.status, 200);
    const completedTask = getTask(taskId);
    assert.equal(completedTask.status, 'succeeded');
    assert.equal(completedTask.output.video.type, 'video');
    assert.equal(listTaskAssets(taskId).length, 1);
    assert.equal(listTaskAssets(taskId)[0].type, 'video');
    const logs = listTaskLogs(taskId);
    assert.equal(logs.some((log) => log.event === 'upstream_video_request_submitted'), true);
    assert.equal(logs.some((log) => log.event === 'upstream_video_response'), true);
    assert.equal(logs.some((log) => log.event === 'upstream_video_submitted'), true);
    assert.equal(JSON.stringify(logs).includes('test-key'), false);
    const successLog = listTaskLogs(taskId).find((log) => log.event === 'upstream_video_succeeded');
    assert.equal(successLog.data.upstreamTaskId, 'ark-task-1');
    assert.equal(successLog.data.assetId, completedTask.output.video.id);
    assert.equal(typeof successLog.data.durationMs, 'number');
    assert.ok(requests.some((request) => request.url.endsWith('/api/v3/contents/generations/tasks/ark-task-1')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('video task persists multimodal content so worker can resume from stored input', async () => {
  const user = createUser({
    email: 'video-resume-content@example.com',
    username: 'video-resume-content@example.com',
    name: 'Video Resume Content',
    passwordHash: 'test',
  });
  const content = [
    { type: 'text', text: 'make a first person tea ad' },
    { type: 'image_url', image_url: { url: 'https://cdn.example/first.png' }, role: 'reference_image' },
    { type: 'video_url', video_url: { url: 'https://cdn.example/ref.mp4' }, role: 'reference_video' },
    { type: 'audio_url', audio_url: { url: 'https://cdn.example/ref.mp3' }, role: 'reference_audio' },
  ];
  const requests = [];
  const service = createVideoGenerationService({
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs-resume-content')),
    joinUrl,
    publicAsset: (asset) => asset,
    proxyRequest: async (url, options) => {
      requests.push({ url, body: options.body, timeoutMs: options.timeoutMs });
      return {
        status: 200,
        data: { id: 'ark-resume-content-task', status: 'queued' },
      };
    },
    resolveApiCredentials: async () => ({
      baseUrl: 'https://ark.cn-beijing.volces.com',
      apiKey: 'test-key',
      providerId: 'seedance',
    }),
  });
  const task = service.createVideoTask(user.id, {
    apiKeyId: 'key-1',
    providerId: 'seedance',
    model: 'doubao-seedance-2-0-mini-260615',
    content,
    duration: 11,
    ratio: '16:9',
    generate_audio: true,
  }, 'running');

  const result = await service.runVideoTask({
    req: { headers: { host: 'workbench.example' }, protocol: 'https' },
    userId: user.id,
    body: {},
    task,
    secrets: {},
  });

  const submittedBody = requests[0].body;
  assert.equal(result.status, 202);
  assert.deepEqual(task.input.content, content);
  assert.equal(task.input.generate_audio, true);
  assert.deepEqual(submittedBody.content, content);
  assert.equal(submittedBody.generate_audio, true);
  assert.equal(submittedBody.duration, 11);
  assert.equal(requests[0].timeoutMs, 0);
});

test('video task lookup normalizes upstream errors and marks the local task failed', async () => {
  const user = createUser({
    email: 'video-error@example.com',
    username: 'video-error@example.com',
    name: 'Video Error',
    passwordHash: 'test',
  });
  const service = createVideoGenerationService({
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs-error')),
    joinUrl,
    publicAsset: (asset) => asset,
    proxyRequest: async () => ({
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'x-tt-logid': 'volc-log-1' },
      data: {
        code: 'RateLimitExceeded',
        message: 'Too many video task queries.',
        secret: 'should-not-be-stored',
      },
    }),
    resolveApiCredentials: async () => ({
      baseUrl: 'https://ark.cn-beijing.volces.com',
      apiKey: 'test-key',
      providerId: 'seedance',
    }),
  });
  const task = service.createVideoTask(user.id, {
    apiKeyId: 'key-1',
    providerId: 'seedance',
    model: 'doubao-seedance-2-0-mini-260615',
    prompt: 'make a short video',
    duration: 5,
    ratio: '16:9',
  }, 'running');
  updateTask(task.id, {
    status: 'running',
    output: {
      providerId: 'seedance',
      credential: { apiKeyId: 'key-1' },
      upstream: { taskId: 'ark-task-rate-limited' },
    },
  });

  const result = await service.getVideoTask({
    taskId: task.id,
    userId: user.id,
    query: {},
    secrets: {},
  });

  const updated = getTask(task.id);
  assert.equal(result.status, 429);
  assert.equal(result.data.error.upstreamCode, 'RateLimitExceeded');
  assert.equal(result.data.error.upstreamRequestId, 'volc-log-1');
  assert.equal(updated.status, 'failed');
  assert.equal(updated.error.upstreamCode, 'RateLimitExceeded');
  assert.equal(updated.error.upstreamMessage, 'Too many video task queries.');
  assert.equal(JSON.stringify(updated.error).includes('should-not-be-stored'), false);
  const failedLog = listTaskLogs(task.id).find((log) => log.event === 'upstream_video_lookup_failed');
  assert.equal(failedLog.data.upstreamTaskId, 'ark-task-rate-limited');
  assert.equal(failedLog.data.upstreamStatus, 429);
  assert.equal(failedLog.data.error.upstreamCode, 'RateLimitExceeded');
});

test('video generation rejects unsupported model modes before provider request', async () => {
  const user = createUser({
    email: 'video-mode@example.com',
    username: 'video-mode@example.com',
    name: 'Video Mode',
    passwordHash: 'test',
  });
  let proxyCalled = false;
  const service = createVideoGenerationService({
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs-mode')),
    joinUrl,
    publicAsset: (asset) => asset,
    proxyRequest: async () => {
      proxyCalled = true;
      return { status: 200, data: {} };
    },
    resolveApiCredentials: async () => ({
      baseUrl: 'https://dashscope.aliyuncs.com',
      apiKey: 'test-key',
      providerId: 'aliyun-bailian',
    }),
  });

  const body = {
    apiKeyId: 'key-1',
    providerId: 'aliyun-bailian',
    model: 'wan2.7-t2v',
    mode: 'image-to-video',
    prompt: 'animate this image',
    images: [{ url: 'https://cdn.example/input.png' }],
    duration: 5,
    ratio: '16:9',
  };
  const task = service.createVideoTask(user.id, body, 'running');

  const result = await service.runVideoTask({
    req: { headers: { host: 'workbench.example' }, protocol: 'https' },
    userId: user.id,
    body,
    task,
    secrets: {},
  });

  const updated = getTask(task.id);
  assert.equal(result.status, 400);
  assert.equal(result.data.error, 'This model only supports these video modes: text-to-video.');
  assert.equal(proxyCalled, false);
  assert.equal(updated.status, 'failed');
  assert.equal(updated.error.message, 'This model only supports these video modes: text-to-video.');
});

test('video task lookup normalizes provider task failure payloads', async () => {
  const user = createUser({
    email: 'video-task-failed@example.com',
    username: 'video-task-failed@example.com',
    name: 'Video Task Failed',
    passwordHash: 'test',
  });
  const service = createVideoGenerationService({
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs-task-failed')),
    joinUrl,
    publicAsset: (asset) => asset,
    proxyRequest: async () => ({
      status: 200,
      headers: { 'x-tt-logid': 'volc-task-log-1' },
      data: {
        id: 'ark-task-sensitive',
        status: 'failed',
        error: {
          code: 'SensitiveContentDetected',
          message: 'The input was blocked by the content policy.',
        },
        apiKey: 'should-not-be-stored',
      },
    }),
    resolveApiCredentials: async () => ({
      baseUrl: 'https://ark.cn-beijing.volces.com',
      apiKey: 'test-key',
      providerId: 'seedance',
    }),
  });
  const task = service.createVideoTask(user.id, {
    apiKeyId: 'key-1',
    providerId: 'seedance',
    model: 'doubao-seedance-2-0-mini-260615',
    prompt: 'make a short video',
    duration: 5,
    ratio: '16:9',
  }, 'running');
  updateTask(task.id, {
    status: 'running',
    output: {
      providerId: 'seedance',
      credential: { apiKeyId: 'key-1' },
      upstream: { taskId: 'ark-task-sensitive' },
    },
  });

  const result = await service.getVideoTask({
    taskId: task.id,
    userId: user.id,
    query: {},
    secrets: {},
  });

  const updated = getTask(task.id);
  assert.equal(result.status, 200);
  assert.equal(result.data.task.status, 'failed');
  assert.equal(updated.status, 'failed');
  assert.equal(updated.error.message, 'Video task failed upstream.');
  assert.equal(updated.error.upstreamCategory, 'content_policy');
  assert.equal(updated.error.upstreamCode, 'SensitiveContentDetected');
  assert.equal(updated.error.upstreamMessage, 'The input was blocked by the content policy.');
  assert.equal(updated.error.upstreamRequestId, 'volc-task-log-1');
  assert.equal(updated.error.upstreamTaskStatus, 'failed');
  assert.equal(JSON.stringify(updated.error).includes('should-not-be-stored'), false);

  const failedLog = listTaskLogs(task.id).find((log) => log.event === 'upstream_video_failed');
  assert.equal(failedLog.data.error.upstreamCategory, 'content_policy');
  assert.equal(failedLog.data.error.upstreamCode, 'SensitiveContentDetected');
  assert.equal(failedLog.data.error.upstreamTaskStatus, 'failed');
});

test('百炼视频任务：提交存对上游任务号，查询用对路径与凭据', async () => {
  // 这两个都是真实踩过的坑：
  // 1. summarizeVideoUpstream 先取 request_id，导致用「请求编号」当任务号去查（永远 UNKNOWN）
  // 2. getVideoTask 只按 providerId 解析适配器，兜底成 seedance，
  //    于是拿火山方舟的 /api/v3/... 路径去问百炼（永远 500）
  const user = createUser({
    email: 'video-bailian@example.com',
    username: 'video-bailian@example.com',
    name: 'Bailian Video',
    passwordHash: 'test',
  });
  const calls = [];
  const service = createVideoGenerationService({
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs')),
    joinUrl,
    publicAsset: (asset) => asset,
    proxyRequest: async (url, options) => {
      calls.push({ method: options.method, url });
      if (options.method === 'GET') {
        return { status: 200, data: { output: { task_id: 'dash-task-1', task_status: 'RUNNING' } } };
      }
      // 百炼真实提交响应：request_id 与 output.task_id 同时存在
      return {
        status: 200,
        data: {
          request_id: 'dash-request-id-not-a-task',
          output: { task_id: 'dash-task-1', task_status: 'PENDING' },
        },
      };
    },
    resolveApiCredentials: async () => ({
      adapterId: 'dashscope-video',
      apiKey: 'bailian-key',
      baseUrl: 'https://dashscope.aliyuncs.com',
      model: 'wan2.7-t2v',
      platformModelId: 'pm-bailian',
      providerId: 'aliyun-bailian',
    }),
  });

  const created = await service.generateVideo({
    req: { headers: { host: 'workbench.example' }, protocol: 'https' },
    userId: user.id,
    body: {
      platformModelId: 'pm-bailian',
      providerId: 'aliyun-bailian',
      model: 'wan2.7-t2v',
      mode: 'text-to-video',
      prompt: '一只橘猫',
      duration: 2,
      resolution: '720P',
      aspectRatio: '16:9',
    },
    secrets: {},
  });

  assert.equal(created.status, 202);
  const taskId = created.data.taskId;

  // 坑 1：存下来的必须是任务号，不是请求编号
  const stored = getTask(taskId);
  assert.equal(stored.output.upstream.taskId, 'dash-task-1');
  assert.equal(
    stored.output.upstream.taskId.includes('request-id'),
    false,
    '不能把 request_id 当成上游任务号'
  );
  // adapterId 必须存下来，查询阶段要靠它选路径
  assert.equal(stored.output.credential.adapterId, 'dashscope-video');
  // 提交必须走百炼的合成路径
  assert.match(calls[0].url, /\/api\/v1\/services\/aigc\/video-generation\/video-synthesis$/);

  const queried = await service.getVideoTask({ taskId, userId: user.id, query: {}, secrets: {} });
  assert.ok(
    calls.length >= 2,
    `查询应当向上游发一次请求，实际只发了 ${calls.length} 次（返回状态 ${queried.status}）`
  );

  // 坑 2：查询必须复用提交时存下的 adapterId，走同一条协议路径
  const queryUrl = calls[1].url;
  assert.match(queryUrl, /\/api\/v1\/tasks\/dash-task-1$/, `查询路径错误: ${queryUrl}`);
  assert.equal(
    queryUrl.includes('/api/v3/contents/generations/tasks/'),
    false,
    '不能拿火山方舟的路径去查百炼任务'
  );
});

test('火山方舟视频任务仍然走自己的路径（修复不能破坏原路径）', async () => {
  const user = createUser({
    email: 'video-ark@example.com',
    username: 'video-ark@example.com',
    name: 'Ark Video',
    passwordHash: 'test',
  });
  const calls = [];
  const service = createVideoGenerationService({
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs')),
    joinUrl,
    publicAsset: (asset) => asset,
    proxyRequest: async (url, options) => {
      calls.push({ method: options.method, url });
      if (options.method === 'GET') {
        return { status: 200, data: { id: 'ark-task-1', status: 'RUNNING' } };
      }
      return { status: 200, data: { id: 'ark-task-1', status: 'queued' } };
    },
    resolveApiCredentials: async () => ({
      adapterId: 'seedance-video',
      apiKey: 'ark-key',
      baseUrl: 'https://ark.cn-beijing.volces.com',
      model: 'doubao-seedance-2-0-mini-260615',
      providerId: 'seedance',
    }),
  });

  const created = await service.generateVideo({
    req: { headers: { host: 'workbench.example' }, protocol: 'https' },
    userId: user.id,
    body: {
      providerId: 'seedance',
      model: 'doubao-seedance-2-0-mini-260615',
      prompt: 'make a short video',
      duration: 5,
    },
    secrets: {},
  });

  const taskId = created.data.taskId;
  assert.equal(getTask(taskId).output.upstream.taskId, 'ark-task-1');
  assert.match(calls[0].url, /\/api\/v3\/contents\/generations\/tasks$/);

  await service.getVideoTask({ taskId, userId: user.id, query: {}, secrets: {} });
  assert.match(calls[1].url, /\/api\/v3\/contents\/generations\/tasks\/ark-task-1$/);
});

test('查询必须复用存下的 adapterId，而不是只靠 providerId 重新推断', async () => {
  // 精确命中 getVideoTask 里的适配器解析。
  // 直接构造一条"提交已完成"的任务：凭据里 providerId 与 adapterId 并存，
  // 而 adapterId 才是提交时真正用过的那个。查询若忽略它，就会拿另一套协议去问上游。
  const user = createUser({
    email: 'video-adapter-reuse@example.com',
    username: 'video-adapter-reuse@example.com',
    name: 'Adapter Reuse',
    passwordHash: 'test',
  });
  const calls = [];
  const service = createVideoGenerationService({
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs')),
    joinUrl,
    publicAsset: (asset) => asset,
    proxyRequest: async (url, options) => {
      calls.push({ method: options.method, url });
      return { status: 200, data: { output: { task_id: 'mixed-task', task_status: 'RUNNING' } } };
    },
    resolveApiCredentials: async () => ({
      adapterId: 'dashscope-video',
      apiKey: 'bailian-key',
      baseUrl: 'https://dashscope.aliyuncs.com',
      platformModelId: 'pm-mixed',
      providerId: 'seedance',
    }),
  });

  const task = service.createVideoTask(user.id, {
    providerId: 'seedance',
    model: 'wan2.7-t2v',
    prompt: '一只橘猫',
    duration: 2,
  }, 'running');

  // 提交已完成：adapterId 是提交时真正用过的那个（百炼）
  updateTask(task.id, {
    status: 'running',
    output: {
      providerId: 'seedance',
      credential: { adapterId: 'dashscope-video', platformModelId: 'pm-mixed' },
      upstream: { taskId: 'mixed-task', status: 'PENDING' },
    },
  });

  await service.getVideoTask({ taskId: task.id, userId: user.id, query: {}, secrets: {} });

  assert.ok(calls.length >= 1, `查询应当发请求，实际 ${calls.length} 次`);
  const queryUrl = calls[0].url;
  assert.match(
    queryUrl,
    /\/api\/v1\/tasks\/mixed-task$/,
    `查询必须复用存下的 adapterId；只按 providerId 推断会走到另一套协议。实际 URL: ${queryUrl}`
  );
});

test('video task finalization enforces user asset storage quota before saving generated video', async () => {
  const originalFetch = global.fetch;
  let savedCount = 0;
  global.fetch = async () => new Response(Buffer.from('too large video'), {
    status: 200,
    headers: { 'content-type': 'video/mp4' },
  });

  const user = createUser({
    email: 'video-quota@example.com',
    username: 'video-quota@example.com',
    name: 'Video Quota',
    passwordHash: 'test',
  });
  const service = createVideoGenerationService({
    assetStorage: {
      async save(buffer, meta = {}) {
        savedCount += 1;
        const now = new Date().toISOString();
        return {
          id: `unexpected-video-${savedCount}`,
          type: meta.type || 'video',
          storageDriver: 'local-fs',
          url: `/api/assets/unexpected-video-${savedCount}`,
          legacyUrl: `/api/images/unexpected-video-${savedCount}`,
          fileName: `unexpected-video-${savedCount}.mp4`,
          filePath: path.join(tempDir, `unexpected-video-${savedCount}.mp4`),
          mime: meta.mime || 'video/mp4',
          prompt: meta.prompt || '',
          model: meta.model || '',
          providerId: meta.providerId || '',
          sizeBytes: buffer.length,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        };
      },
    },
    joinUrl,
    publicAsset: (asset) => asset,
    proxyRequest: async () => ({
      status: 200,
      headers: { 'x-tt-logid': 'video-quota-log-1' },
      data: {
        id: 'ark-task-video-quota',
        status: 'succeeded',
        content: [
          { type: 'video_url', video_url: { url: 'https://cdn.example/quota.mp4' } },
        ],
      },
    }),
    resolveApiCredentials: async () => ({
      baseUrl: 'https://ark.cn-beijing.volces.com',
      apiKey: 'test-key',
      providerId: 'seedance',
    }),
    uploadLimits: {
      maxUserAssetBytes: 4,
    },
  });
  const task = service.createVideoTask(user.id, {
    apiKeyId: 'key-1',
    providerId: 'seedance',
    model: 'doubao-seedance-2-0-mini-260615',
    prompt: 'make a quota video',
    duration: 5,
    ratio: '16:9',
  }, 'running');
  updateTask(task.id, {
    status: 'running',
    output: {
      providerId: 'seedance',
      credential: { apiKeyId: 'key-1' },
      upstream: { taskId: 'ark-task-video-quota' },
    },
  });

  try {
    const result = await service.getVideoTask({
      taskId: task.id,
      userId: user.id,
      query: {},
      secrets: {},
    });

    const updated = getTask(task.id);
    assert.equal(result.status, 413);
    assert.equal(updated.status, 'failed');
    assert.match(updated.error.message, /storage quota/i);
    assert.equal(savedCount, 0);
    assert.equal(listTaskAssets(task.id).length, 0);
    const failedLog = listTaskLogs(task.id).find((log) => log.event === 'upstream_video_asset_save_failed');
    assert.match(failedLog.data.error.message, /storage quota/i);
  } finally {
    global.fetch = originalFetch;
  }
});
