const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-text-service-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const {
  createUser,
  db,
  getTask,
  listTaskLogs,
  updateTask,
} = require('./db.cjs');
const { createTextGenerationService } = require('./services/textGenerationService.cjs');
const { joinUrl } = require('./services/proxyService.cjs');

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('text generation service writes output and logs to its task', async () => {
  const user = createUser({
    email: 'text-owner@example.com',
    username: 'text-owner@example.com',
    name: 'Text Owner',
    passwordHash: 'test',
  });
  const requests = [];
  const service = createTextGenerationService({
    joinUrl,
    proxyRequest: async (url, options) => {
      requests.push({ url, body: options.body, headers: options.headers, timeoutMs: options.timeoutMs });
      return {
        status: 200,
        data: {
          choices: [
            { message: { role: 'assistant', content: 'hello from worker' } },
          ],
        },
      };
    },
    resolveApiCredentials: async () => {
      throw new Error('saved key path should not be used');
    },
    resolveDirectCredentials: () => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'direct-key',
      providerId: 'openai-compatible',
    }),
  });
  const task = service.createTextTask(user.id, {
    baseUrl: 'https://api.example.com',
    apiKey: 'direct-key',
    providerId: 'openai-compatible',
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'hello' }],
  }, 'running');

  const result = await service.runTextTask({
    userId: user.id,
    body: {
      baseUrl: 'https://api.example.com',
      apiKey: 'direct-key',
      providerId: 'openai-compatible',
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'hello' }],
    },
    secrets: {},
    task,
  });

  const updated = getTask(task.id);
  assert.equal(result.status, 200);
  assert.equal(updated.status, 'succeeded');
  assert.equal(updated.output.choices[0].message.content, 'hello from worker');
  assert.equal(requests[0].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(requests[0].body.apiKey, undefined);
  assert.equal(requests[0].timeoutMs, 0);
  const logs = listTaskLogs(task.id);
  assert.equal(logs.some((log) => log.event === 'upstream_text_submitted'), true);
  assert.equal(logs.some((log) => log.event === 'upstream_text_response'), true);
  assert.equal(JSON.stringify(logs).includes('direct-key'), false);
});

test('text generation rejects models without chat capability before upstream request', async () => {
  const user = createUser({
    email: 'text-image-model@example.com',
    username: 'text-image-model@example.com',
    name: 'Text Image Model',
    passwordHash: 'test',
  });
  const requests = [];
  const service = createTextGenerationService({
    joinUrl,
    proxyRequest: async (url, options) => {
      requests.push({ url, body: options.body });
      return { status: 200, data: {} };
    },
    resolveApiCredentials: async () => {
      throw new Error('saved key path should not be used');
    },
    resolveDirectCredentials: () => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'direct-key',
      providerId: 'openai-compatible',
    }),
  });
  const task = service.createTextTask(user.id, {
    baseUrl: 'https://api.example.com',
    apiKey: 'direct-key',
    providerId: 'openai-compatible',
    model: 'gpt-image-2',
    messages: [{ role: 'user', content: 'hello' }],
  }, 'running');

  const result = await service.runTextTask({
    userId: user.id,
    body: {
      baseUrl: 'https://api.example.com',
      apiKey: 'direct-key',
      providerId: 'openai-compatible',
      model: 'gpt-image-2',
      messages: [{ role: 'user', content: 'hello' }],
    },
    secrets: {},
    task,
  });

  const updated = getTask(task.id);
  assert.equal(result.status, 400);
  assert.match(result.data.error, /text generation/i);
  assert.equal(updated.status, 'failed');
  assert.equal(requests.length, 0);
});

test('text generation falls back to the next platform model route on retryable upstream failure', async () => {
  const user = createUser({
    email: 'text-platform-fallback@example.com',
    username: 'text-platform-fallback@example.com',
    name: 'Text Platform Fallback',
    passwordHash: 'test',
  });
  const requests = [];
  const service = createTextGenerationService({
    joinUrl,
    proxyRequest: async (url, options) => {
      requests.push({ url, body: options.body, headers: options.headers });
      if (requests.length === 1) {
        return {
          status: 429,
          statusText: 'Too Many Requests',
          data: { error: { message: 'rate limited' } },
        };
      }
      return {
        status: 200,
        data: {
          choices: [
            { message: { role: 'assistant', content: 'fallback answer' } },
          ],
        },
      };
    },
    resolveApiCredentials: async () => ({
      baseUrl: 'https://primary.example.com',
      apiKey: 'primary-key',
      providerId: 'openai-compatible',
      model: 'primary-text-model',
      platformModelId: 'platform-text',
      platformRouteId: 'route-primary',
      fallbackCredentials: [
        {
          baseUrl: 'https://fallback.example.com',
          apiKey: 'fallback-key',
          providerId: 'openai-compatible',
          model: 'fallback-text-model',
          platformModelId: 'platform-text',
          platformRouteId: 'route-fallback',
        },
      ],
    }),
    resolveDirectCredentials: () => {
      throw new Error('direct key path should not be used');
    },
  });
  const task = service.createTextTask(user.id, {
    platformModelId: 'platform-text',
    model: 'public-text-model',
    messages: [{ role: 'user', content: 'hello' }],
  }, 'running');

  const result = await service.runTextTask({
    userId: user.id,
    body: {
      platformModelId: 'platform-text',
      model: 'public-text-model',
      messages: [{ role: 'user', content: 'hello' }],
    },
    secrets: {},
    task,
  });

  const updated = getTask(task.id);
  const logs = listTaskLogs(task.id);
  assert.equal(result.status, 200);
  assert.equal(updated.status, 'succeeded');
  assert.equal(updated.output.choices[0].message.content, 'fallback answer');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://primary.example.com/v1/chat/completions');
  assert.equal(requests[1].url, 'https://fallback.example.com/v1/chat/completions');
  assert.equal(requests[0].body.model, 'primary-text-model');
  assert.equal(requests[1].body.model, 'fallback-text-model');
  assert.equal(logs.some((log) => log.event === 'platform_model_route_fallback'), true);
});

test('text generation service preserves cancellation after upstream returns', async () => {
  const user = createUser({
    email: 'text-cancel@example.com',
    username: 'text-cancel@example.com',
    name: 'Text Cancel',
    passwordHash: 'test',
  });
  const service = createTextGenerationService({
    joinUrl,
    proxyRequest: async () => {
      updateTask(task.id, {
        status: 'cancelled',
        error: { message: 'Cancellation requested while task was running.' },
      });
      return {
        status: 200,
        data: {
          choices: [
            { message: { role: 'assistant', content: 'late answer' } },
          ],
        },
      };
    },
    resolveApiCredentials: async () => {
      throw new Error('saved key path should not be used');
    },
    resolveDirectCredentials: () => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'direct-key',
      providerId: 'openai-compatible',
    }),
  });
  const task = service.createTextTask(user.id, {
    baseUrl: 'https://api.example.com',
    apiKey: 'direct-key',
    providerId: 'openai-compatible',
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'hello' }],
  }, 'running');

  const result = await service.runTextTask({
    userId: user.id,
    body: {
      baseUrl: 'https://api.example.com',
      apiKey: 'direct-key',
      providerId: 'openai-compatible',
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'hello' }],
    },
    secrets: {},
    task,
  });

  const updated = getTask(task.id);
  assert.equal(result.status, 409);
  assert.equal(updated.status, 'cancelled');
  assert.equal(updated.output, null);
  assert.equal(listTaskLogs(task.id).some((log) => log.event === 'cancelled_after_upstream'), true);
});

test('text generation service normalizes upstream error responses', async () => {
  const user = createUser({
    email: 'text-error@example.com',
    username: 'text-error@example.com',
    name: 'Text Error',
    passwordHash: 'test',
  });
  const service = createTextGenerationService({
    joinUrl,
    proxyRequest: async () => ({
      status: 400,
      statusText: 'Bad Request',
      headers: { 'x-request-id': 'req-text-1' },
      data: {
        error: {
          message: 'Model does not support this input.',
          type: 'invalid_request_error',
          code: 'unsupported_input',
        },
        token: 'should-not-be-stored',
      },
    }),
    resolveApiCredentials: async () => {
      throw new Error('saved key path should not be used');
    },
    resolveDirectCredentials: () => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'direct-key',
      providerId: 'openai-compatible',
    }),
  });
  const task = service.createTextTask(user.id, {
    baseUrl: 'https://api.example.com',
    apiKey: 'direct-key',
    providerId: 'openai-compatible',
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'hello' }],
  }, 'running');

  const result = await service.runTextTask({
    userId: user.id,
    body: {
      baseUrl: 'https://api.example.com',
      apiKey: 'direct-key',
      providerId: 'openai-compatible',
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'hello' }],
    },
    secrets: {},
    task,
  });

  const updated = getTask(task.id);
  assert.equal(result.status, 400);
  assert.equal(result.data.error.upstreamCode, 'unsupported_input');
  assert.equal(result.data.error.upstreamRequestId, 'req-text-1');
  assert.equal(updated.status, 'failed');
  assert.equal(updated.error.upstreamCode, 'unsupported_input');
  assert.equal(updated.error.upstreamMessage, 'Model does not support this input.');
  assert.equal(JSON.stringify(updated.error).includes('should-not-be-stored'), false);
});
