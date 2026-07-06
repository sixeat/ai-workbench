const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createModelListService,
  normalizeModelItems,
} = require('./services/modelListService.cjs');

function createService(overrides = {}) {
  const calls = {
    proxyRequests: [],
    resolvedApiCredentials: [],
    resolvedDirectCredentials: [],
  };

  const service = createModelListService({
    getRequestUserId: (req) => req.authUser?.id || 'local-user',
    joinUrl: (baseUrl, endpoint) => `${String(baseUrl).replace(/\/+$/, '')}${endpoint}`,
    proxyRequest: async (url, options) => {
      calls.proxyRequests.push({ options, url });
      return overrides.proxyResult || {
        data: {
          data: [
            { id: 'zeta-model', owned_by: 'demo' },
            { id: 'alpha-model' },
            { id: '' },
          ],
        },
        status: 200,
      };
    },
    readSecrets: async () => overrides.secrets || { apiKey: 'secret-key' },
    resolveApiCredentials: async (input) => {
      calls.resolvedApiCredentials.push(input);
      return overrides.apiCredentials || {
        apiKey: 'saved-key',
        baseUrl: 'https://saved.example.com',
      };
    },
    resolveDirectCredentials: async (body, secrets) => {
      calls.resolvedDirectCredentials.push({ body, secrets });
      return overrides.directCredentials || {
        apiKey: body.apiKey || secrets.apiKey,
        baseUrl: body.baseUrl || body.apiBaseUrl,
      };
    },
  });

  return { calls, service };
}

test('model list service normalizes and sorts OpenAI-compatible model items', () => {
  const models = normalizeModelItems({
    data: [
      { id: 'z-model', owned_by: 'team-z' },
      { id: 'a-model' },
      { name: 'fallback-name' },
      { id: '' },
    ],
  });

  assert.deepEqual(models, [
    { id: 'a-model', ownedBy: undefined },
    { id: 'fallback-name', ownedBy: undefined },
    { id: 'z-model', ownedBy: 'team-z' },
  ]);
});

test('model list service resolves direct credentials and fetches /v1/models', async () => {
  const { calls, service } = createService();

  const response = await service.listModels({
    body: {
      apiBaseUrl: 'https://direct.example.com',
      apiKey: 'direct-key',
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.data.models.map((item) => item.id), ['alpha-model', 'zeta-model']);
  assert.equal(calls.resolvedDirectCredentials.length, 1);
  assert.equal(calls.resolvedApiCredentials.length, 0);
  assert.equal(calls.proxyRequests[0].url, 'https://direct.example.com/v1/models');
  assert.deepEqual(calls.proxyRequests[0].options.headers, {
    Authorization: 'Bearer direct-key',
  });
});

test('model list service resolves saved API key credentials by request user', async () => {
  const { calls, service } = createService();

  await service.listModels({
    authUser: { id: 'user-123' },
    body: {
      apiKeyId: 'key-1',
      providerId: 'openai-compatible',
    },
  });

  assert.equal(calls.resolvedDirectCredentials.length, 0);
  assert.equal(calls.resolvedApiCredentials.length, 1);
  assert.equal(calls.resolvedApiCredentials[0].userId, 'user-123');
  assert.equal(calls.resolvedApiCredentials[0].body.apiKeyId, 'key-1');
  assert.equal(calls.proxyRequests[0].url, 'https://saved.example.com/v1/models');
  assert.deepEqual(calls.proxyRequests[0].options.headers, {
    Authorization: 'Bearer saved-key',
  });
});

test('model list service rejects missing base URL before proxying', async () => {
  const { calls, service } = createService({
    directCredentials: {
      apiKey: 'direct-key',
      baseUrl: '',
    },
  });

  await assert.rejects(
    () => service.listModels({ body: { apiKey: 'direct-key' } }),
    /Base URL is required/
  );
  assert.equal(calls.proxyRequests.length, 0);
});

test('model list service returns upstream model-list errors without throwing', async () => {
  const { service } = createService({
    proxyResult: {
      data: {
        error: {
          message: 'invalid credential',
        },
      },
      status: 401,
    },
  });

  const response = await service.listModels({
    body: {
      apiBaseUrl: 'https://direct.example.com',
      apiKey: 'bad-key',
    },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.data, {
    error: 'invalid credential',
  });
});
