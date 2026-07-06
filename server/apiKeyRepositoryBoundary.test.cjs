const assert = require('node:assert/strict');
const test = require('node:test');

const { registerApiKeyRoutes } = require('./routes/apiKeyRoutes.cjs');
const { createCredentialService } = require('./services/credentialService.cjs');

function createFakeApp() {
  const routes = [];
  return {
    routes,
    delete(pathname, handler) {
      routes.push({ method: 'DELETE', pathname, handler });
    },
    get(pathname, handler) {
      routes.push({ method: 'GET', pathname, handler });
    },
    patch(pathname, handler) {
      routes.push({ method: 'PATCH', pathname, handler });
    },
    post(pathname, handler) {
      routes.push({ method: 'POST', pathname, handler });
    },
  };
}

function createMockRes() {
  return {
    body: null,
    statusCode: 200,
    json(body) {
      this.body = body;
      return this;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
  };
}

function createInMemoryApiKeyRepository() {
  const keys = new Map();
  const auditLogs = [];
  let nextId = 1;

  function visibleToUser(apiKey, userId, includeServer = true) {
    return apiKey.ownerUserId === userId || (includeServer && apiKey.keyScope === 'server');
  }

  function listVisible(userId, includeServer = true, options = {}) {
    return Array.from(keys.values()).filter((apiKey) => {
      if (!visibleToUser(apiKey, userId, includeServer)) return false;
      if (options.keyScope && apiKey.keyScope !== options.keyScope) return false;
      return true;
    });
  }

  return {
    auditLogs,
    keys,
    countApiKeys(userId, includeServer, options) {
      return listVisible(userId, includeServer, options).length;
    },
    createAuditLog(log) {
      auditLogs.push(log);
      return log;
    },
    deleteApiKey(id, userId) {
      const existing = keys.get(id);
      if (!existing || !visibleToUser(existing, userId)) return false;
      keys.delete(id);
      return true;
    },
    getApiKey(id) {
      return keys.get(id) || null;
    },
    getApiKeyForUser(id, userId) {
      const existing = keys.get(id);
      return existing && visibleToUser(existing, userId) ? existing : null;
    },
    listApiKeys(userId, includeServer, options) {
      const limit = Number(options?.limit || 100);
      const offset = Number(options?.offset || 0);
      return listVisible(userId, includeServer, options).slice(offset, offset + limit);
    },
    upsertApiKey(apiKey) {
      const existing = apiKey.id ? keys.get(apiKey.id) : null;
      const next = {
        ...existing,
        ...apiKey,
        id: apiKey.id || `fake-key-${nextId++}`,
        isEnabled: apiKey.isEnabled !== false,
      };
      keys.set(next.id, next);
      return next;
    },
  };
}

function registerRoutesFor({ apiKeyRepository, userId = 'user-1', requireAdmin = () => true }) {
  const app = createFakeApp();
  registerApiKeyRoutes(app, {
    apiKeyRepository,
    encryptSecret: (value) => `encrypted:${value}`,
    getRequestUserId: () => userId,
    keyBelongsToUser: (apiKey, ownerUserId) => apiKey && (
      apiKey.ownerUserId === ownerUserId || apiKey.keyScope === 'server'
    ),
    maxUserApiKeys: 5,
    requireAdmin,
  });
  return app;
}

function findRoute(app, method, pathname) {
  return app.routes.find((route) => route.method === method && route.pathname === pathname);
}

test('api key routes can create, list, update, and delete through an injected repository', () => {
  const apiKeyRepository = createInMemoryApiKeyRepository();
  const app = registerRoutesFor({ apiKeyRepository });

  const createRoute = findRoute(app, 'POST', '/api/api-keys');
  const createRes = createMockRes();
  createRoute.handler({
    body: {
      apiKey: 'secret-value',
      baseUrl: 'https://api.example.com',
      name: 'Example Key',
      providerId: 'openai-compatible',
    },
    headers: {},
  }, createRes);

  assert.equal(createRes.statusCode, 201);
  assert.equal(createRes.body.apiKey.ownerUserId, 'user-1');
  assert.equal(createRes.body.apiKey.encryptedKey, 'encrypted:secret-value');

  const listRoute = findRoute(app, 'GET', '/api/api-keys');
  const listRes = createMockRes();
  listRoute.handler({ query: { limit: 10 }, headers: {} }, listRes);

  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.total, 1);
  assert.deepEqual(listRes.body.quota, {
    userKeyCount: 1,
    maxUserApiKeys: 5,
    remainingUserKeys: 4,
  });

  const patchRoute = findRoute(app, 'PATCH', '/api/api-keys/:apiKeyId');
  const patchRes = createMockRes();
  patchRoute.handler({
    body: { isEnabled: false, name: 'Disabled Example Key' },
    headers: {},
    params: { apiKeyId: createRes.body.apiKey.id },
  }, patchRes);

  assert.equal(patchRes.statusCode, 200);
  assert.equal(patchRes.body.apiKey.name, 'Disabled Example Key');
  assert.equal(patchRes.body.apiKey.isEnabled, false);

  const deleteRoute = findRoute(app, 'DELETE', '/api/api-keys/:apiKeyId');
  const deleteRes = createMockRes();
  deleteRoute.handler({
    headers: {},
    params: { apiKeyId: createRes.body.apiKey.id },
  }, deleteRes);

  assert.equal(deleteRes.statusCode, 200);
  assert.equal(deleteRes.body.ok, true);
  assert.equal(apiKeyRepository.keys.size, 0);
  assert.deepEqual(
    apiKeyRepository.auditLogs.map((log) => log.action),
    ['api_key.create', 'api_key.update', 'api_key.delete']
  );
});

test('credential service resolves saved credentials through an injected repository', async () => {
  const calls = [];
  let encryptedKey = '';
  const apiKeyRepository = {
    getApiKeyForUser(apiKeyId, userId, includeSecret) {
      calls.push({ apiKeyId, includeSecret, userId });
      return {
        baseUrl: 'https://stored.example.com',
        encryptedKey,
        id: apiKeyId,
        isEnabled: true,
        keyScope: 'user',
        ownerUserId: userId,
        providerId: 'seedance',
      };
    },
  };
  const service = createCredentialService({
    apiKeyRepository,
    keyEncryptionSecret: '0123456789abcdef0123456789abcdef',
  });
  encryptedKey = service.encryptSecret('stored-secret');

  const result = await service.resolveApiCredentials({
    body: { apiKeyId: 'key-1' },
    secrets: { baseUrl: 'https://fallback.example.com' },
    userId: 'user-1',
  });

  assert.deepEqual(calls, [{ apiKeyId: 'key-1', includeSecret: true, userId: 'user-1' }]);
  assert.deepEqual(result, {
    apiKey: 'stored-secret',
    baseUrl: 'https://stored.example.com',
    keyScope: 'user',
    providerId: 'seedance',
  });
});
