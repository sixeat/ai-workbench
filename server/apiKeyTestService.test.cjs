const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-api-key-test-service-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const { db } = require('./db.cjs');
const { createApiKeyTestService } = require('./services/apiKeyTestService.cjs');

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('api key test service reads model list without running paid generation by default', async () => {
  const calls = [];
  const service = createApiKeyTestService({
    joinUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    proxyRequest: async (url, options) => {
      calls.push({ url, options });
      return {
        status: 200,
        data: {
          data: [
            { id: 'gpt-4o-mini' },
            { id: 'gpt-image-1' },
          ],
        },
      };
    },
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'secret',
      providerId: 'openai-compatible',
      keyScope: 'user',
    }),
  });

  const result = await service.testApiKey({
    req: {},
    userId: 'user-1',
    apiKeyId: 'key-1',
    providerId: 'openai-compatible',
  });

  assert.equal(result.models.ok, true);
  assert.equal(result.models.method, 'model_list');
  assert.equal(result.models.networkRequest, true);
  assert.equal(result.models.billable, false);
  assert.equal(result.models.count, 2);
  assert.equal(result.tests.text.skipped, true);
  assert.equal(result.tests.text.method, 'not_requested');
  assert.equal(result.tests.text.networkRequest, false);
  assert.equal(result.tests.text.billable, false);
  assert.equal(result.tests.image.skipped, true);
  assert.equal(result.tests.image.method, 'not_requested');
  assert.equal(result.tests.image.networkRequest, false);
  assert.equal(result.tests.image.billable, false);
  assert.equal(result.tests.video.skipped, true);
  assert.equal(result.tests.video.method, 'not_requested');
  assert.equal(result.tests.video.networkRequest, false);
  assert.equal(result.tests.video.billable, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.com/v1/models');
});

test('api key test service can run an explicit lightweight text ping', async () => {
  const calls = [];
  const service = createApiKeyTestService({
    joinUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    proxyRequest: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/v1/models')) {
        return { status: 200, data: { data: [{ id: 'gpt-4o-mini' }] } };
      }
      return { status: 200, data: { choices: [{ message: { content: 'OK' } }] } };
    },
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'secret',
      providerId: 'openai-compatible',
      keyScope: 'user',
    }),
  });

  const result = await service.testApiKey({
    req: {},
    userId: 'user-1',
    apiKeyId: 'key-1',
    providerId: 'openai-compatible',
    model: 'gpt-4o-mini',
    testText: true,
  });

  assert.equal(result.tests.text.ok, true);
  assert.equal(result.tests.text.method, 'text_ping');
  assert.equal(result.tests.text.networkRequest, true);
  assert.equal(result.tests.text.billable, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://api.example.com/v1/chat/completions');
});

test('api key test service can explicitly check image and video capabilities without paid generation', async () => {
  const calls = [];
  const service = createApiKeyTestService({
    joinUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    proxyRequest: async (url, options) => {
      calls.push({ url, options });
      return { status: 200, data: { data: [{ id: 'gpt-image-1' }] } };
    },
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'secret',
      providerId: 'openai-compatible',
      keyScope: 'user',
    }),
  });

  const result = await service.testApiKey({
    req: {},
    userId: 'user-1',
    apiKeyId: 'key-1',
    providerId: 'openai-compatible',
    model: 'gpt-image-1',
    testImage: true,
    testVideo: true,
  });

  assert.equal(result.tests.image.ok, true);
  assert.equal(result.tests.image.skipped, true);
  assert.equal(result.tests.image.method, 'capability_table');
  assert.equal(result.tests.image.networkRequest, false);
  assert.equal(result.tests.image.billable, false);
  assert.match(result.tests.image.reason, /No paid image generation/);
  assert.equal(result.capabilities.responseFormatB64, true);
  assert.equal(result.capabilities.responseFormatUrl, true);
  assert.equal(result.tests.video.ok, false);
  assert.equal(result.tests.video.method, 'capability_table');
  assert.equal(result.tests.video.networkRequest, false);
  assert.equal(result.tests.video.billable, false);
  assert.match(result.tests.video.reason, /not marked as supporting video generation/);
  assert.equal(calls.length, 1);
});

test('api key test service skips model list when provider has no model endpoint', async () => {
  const service = createApiKeyTestService({
    joinUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    proxyRequest: async () => {
      throw new Error('model list should be skipped');
    },
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({
      baseUrl: 'https://ark.example.com',
      apiKey: 'secret',
      providerId: 'seedance',
      keyScope: 'user',
    }),
  });

  const result = await service.testApiKey({
    req: {},
    userId: 'user-1',
    apiKeyId: 'key-1',
    providerId: 'seedance',
    model: 'doubao-seedance-2-0-mini-260615',
  });

  assert.equal(result.models.skipped, true);
  assert.equal(result.models.method, 'not_available');
  assert.equal(result.models.networkRequest, false);
  assert.equal(result.models.billable, false);
  assert.equal(result.tests.video.ok, true);
  assert.equal(result.tests.image.ok, false);
});

test('api key test service redacts provider errors before returning them', async () => {
  const service = createApiKeyTestService({
    joinUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    proxyRequest: async () => ({
      status: 401,
      data: {
        error: {
          message: 'Bearer sk-secret123456 failed for https://private.example.com/models',
          code: 'invalid_api_key',
        },
      },
    }),
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'secret',
      providerId: 'openai-compatible',
      keyScope: 'user',
    }),
  });

  const result = await service.testApiKey({
    req: {},
    userId: 'user-1',
    apiKeyId: 'key-1',
    providerId: 'openai-compatible',
  });

  assert.equal(result.models.ok, false);
  assert.equal(result.models.error.includes('sk-secret123456'), false);
  assert.equal(result.models.error.includes('private.example.com'), false);
  assert.equal(result.models.error, 'HTTP 401: Bearer [redacted] failed for [redacted-url]');
});
