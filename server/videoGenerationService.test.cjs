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
      requests.push({ url, body: options.body });
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
