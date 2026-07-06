const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-image-service-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const {
  createUser,
  db,
  getTask,
  listAssets,
} = require('./db.cjs');
const { LocalAssetStorage } = require('./assetStorage.cjs');
const {
  createImageGenerationService,
  normalizeImageBodyAliases,
} = require('./services/imageGenerationService.cjs');
const { joinUrl } = require('./services/proxyService.cjs');

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('normalizeImageBodyAliases converts frontend option names to provider option names', () => {
  const normalized = normalizeImageBodyAliases({
    promptExtend: true,
    enableSequential: true,
    thinkingMode: false,
    prompt_extend: undefined,
  });

  assert.equal(normalized.prompt_extend, true);
  assert.equal(normalized.enable_sequential, true);
  assert.equal(normalized.thinking_mode, false);
  assert.equal(Object.hasOwn(normalized, 'promptExtend'), false);
  assert.equal(Object.hasOwn(normalized, 'enableSequential'), false);
  assert.equal(Object.hasOwn(normalized, 'thinkingMode'), false);
});

test('image generation service normalizes upstream error responses', async () => {
  const originalConsoleError = console.error;
  const consoleErrors = [];
  console.error = (...args) => {
    consoleErrors.push(args);
  };
  const user = createUser({
    email: 'image-error@example.com',
    username: 'image-error@example.com',
    name: 'Image Error',
    passwordHash: 'test',
  });
  const service = createImageGenerationService({
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs')),
    joinUrl,
    publicAsset: (asset) => asset,
    proxyRequest: async () => ({
      status: 402,
      statusText: 'Payment Required',
      headers: { 'x-request-id': 'req-image-1' },
      data: {
        error: {
          message: 'Insufficient credits.',
          type: 'billing_error',
          code: 'insufficient_quota',
        },
        apiKey: 'should-not-be-stored',
      },
    }),
    resolveApiCredentials: async () => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'image-key',
      providerId: 'openai-compatible',
    }),
  });
  const task = service.createImageTask(user.id, {
    baseUrl: 'https://api.example.com',
    apiKey: 'image-key',
    providerId: 'openai-compatible',
    model: 'gpt-image-1',
    prompt: 'a product photo',
    size: '1024x1024',
    n: 1,
  }, 'running');

  let result;
  try {
    result = await service.runImageTask({
      req: { headers: { host: 'workbench.example' }, protocol: 'https' },
      userId: user.id,
      body: {
        baseUrl: 'https://api.example.com',
        apiKey: 'image-key',
        providerId: 'openai-compatible',
        model: 'gpt-image-1',
        prompt: 'a product photo',
        size: '1024x1024',
        n: 1,
      },
      secrets: {},
      task,
    });
  } finally {
    console.error = originalConsoleError;
  }

  const updated = getTask(task.id);
  assert.equal(result.status, 402);
  assert.equal(result.data.error.upstreamCode, 'insufficient_quota');
  assert.equal(result.data.error.upstreamType, 'billing_error');
  assert.equal(result.data.error.upstreamRequestId, 'req-image-1');
  assert.equal(updated.status, 'failed');
  assert.equal(updated.error.upstreamCode, 'insufficient_quota');
  assert.equal(updated.error.upstreamMessage, 'Insufficient credits.');
  assert.equal(JSON.stringify(updated.error).includes('should-not-be-stored'), false);
  assert.equal(JSON.stringify(consoleErrors).includes('should-not-be-stored'), false);
});

test('image generation service normalizes camelCase provider options before capability filtering', async () => {
  let capturedRequest = null;
  const user = createUser({
    email: 'image-provider-options@example.com',
    username: 'image-provider-options@example.com',
    name: 'Image Provider Options',
    passwordHash: 'test',
  });
  const service = createImageGenerationService({
    assetStorage: new LocalAssetStorage(path.join(tempDir, 'outputs-provider-options')),
    joinUrl,
    publicAsset: (asset) => asset,
    proxyRequest: async (url, options) => {
      capturedRequest = { url, options };
      return {
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        data: { error: { message: 'stop after request capture' } },
      };
    },
    resolveApiCredentials: async () => ({
      baseUrl: 'https://dashscope.aliyuncs.com',
      apiKey: 'image-key',
      providerId: 'aliyun-bailian',
    }),
  });
  const task = service.createImageTask(user.id, {
    providerId: 'aliyun-bailian',
    model: 'wan2.6-image',
    prompt: 'a product photo',
    size: '1K',
    n: 1,
    promptExtend: true,
  }, 'running');

  await service.runImageTask({
    req: { headers: { host: 'workbench.example' }, protocol: 'https' },
    userId: user.id,
    body: {
      providerId: 'aliyun-bailian',
      model: 'wan2.6-image',
      prompt: 'a product photo',
      size: '1K',
      n: 1,
      promptExtend: true,
    },
    secrets: {},
    task,
  });

  assert.ok(capturedRequest);
  assert.equal(
    capturedRequest.url,
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
  );
  assert.equal(capturedRequest.options.body.parameters.prompt_extend, true);
  assert.equal(Object.hasOwn(capturedRequest.options.body, 'promptExtend'), false);
});

test('image generation enforces user asset storage quota before saving generated payloads', async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  let savedCount = 0;
  const user = createUser({
    email: 'image-quota@example.com',
    username: 'image-quota@example.com',
    name: 'Image Quota',
    passwordHash: 'test',
  });
  const service = createImageGenerationService({
    assetStorage: {
      async save(buffer, meta = {}) {
        savedCount += 1;
        const now = new Date().toISOString();
        return {
          id: `unexpected-image-${savedCount}`,
          type: meta.type || 'image',
          storageDriver: 'local-fs',
          url: `/api/assets/unexpected-image-${savedCount}`,
          legacyUrl: `/api/images/unexpected-image-${savedCount}`,
          fileName: `unexpected-image-${savedCount}.png`,
          filePath: path.join(tempDir, `unexpected-image-${savedCount}.png`),
          mime: meta.mime || 'image/png',
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
      data: { data: [{ b64_json: Buffer.from('too large').toString('base64') }] },
    }),
    resolveApiCredentials: async () => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'image-key',
      providerId: 'openai-compatible',
    }),
    uploadLimits: {
      maxUserAssetBytes: 4,
    },
  });
  const task = service.createImageTask(user.id, {
    providerId: 'openai-compatible',
    model: 'gpt-image-1',
    prompt: 'a quota test image',
    size: '1024x1024',
    n: 1,
  }, 'running');

  let result;
  try {
    result = await service.runImageTask({
      req: { headers: { host: 'workbench.example' }, protocol: 'https' },
      userId: user.id,
      body: task.input,
      secrets: {},
      task,
    });
  } finally {
    console.error = originalConsoleError;
  }

  const updated = getTask(task.id);
  assert.equal(result.status, 413);
  assert.match(result.data.error, /storage quota/i);
  assert.equal(updated.status, 'failed');
  assert.match(updated.error.message, /storage quota/i);
  assert.equal(savedCount, 0);
  assert.equal(listAssets(user.id, 10).length, 0);
});
