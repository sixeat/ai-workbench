const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-api-key-routes-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const {
  createUser,
  db,
  getApiKey,
  listAuditLogs,
  upsertApiKey,
} = require('./db.cjs');
const { registerApiKeyRoutes } = require('./routes/apiKeyRoutes.cjs');

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
    patch(pathname, handler) {
      routes.push({ method: 'PATCH', pathname, handler });
    },
    delete(pathname, handler) {
      routes.push({ method: 'DELETE', pathname, handler });
    },
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

function registerRoutesFor(userId, maxUserApiKeys = 1, overrides = {}) {
  const app = createFakeApp();
  registerApiKeyRoutes(app, {
    encryptSecret: (value) => `encrypted:${value}`,
    getRequestUserId: () => userId,
    keyBelongsToUser: (apiKey, ownerUserId) => apiKey && (apiKey.ownerUserId === ownerUserId || apiKey.keyScope === 'server'),
    maxUserApiKeys,
    requireAdmin: () => true,
    ...overrides,
  });
  return app;
}

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('api key route enforces per-user key quota', () => {
  const user = createUser({
    email: 'quota@example.com',
    username: 'quota@example.com',
    name: 'Quota User',
    passwordHash: 'test',
  });
  const app = registerRoutesFor(user.id, 1);
  const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/api-keys');

  const first = createMockRes();
  route.handler({ body: { providerId: 'openai-compatible', apiKey: 'key-1' } }, first);
  assert.equal(first.statusCode, 201);

  const second = createMockRes();
  route.handler({ body: { providerId: 'anthropic', apiKey: 'key-2' } }, second);
  assert.equal(second.statusCode, 429);
  assert.match(second.body.error, /limit/i);
  assert.deepEqual(second.body.quota, {
    userKeyCount: 1,
    maxUserApiKeys: 1,
    remainingUserKeys: 0,
  });
});

test('api key list route supports pagination, filters, and user isolation', () => {
  const owner = createUser({
    email: 'key-list-owner@example.com',
    username: 'key-list-owner@example.com',
    name: 'Key List Owner',
    passwordHash: 'test',
  });
  const other = createUser({
    email: 'key-list-other@example.com',
    username: 'key-list-other@example.com',
    name: 'Key List Other',
    passwordHash: 'test',
  });
  upsertApiKey({
    id: 'key-list-openai',
    ownerUserId: owner.id,
    keyScope: 'user',
    providerId: 'openai-compatible',
    name: 'Character Image Key',
    baseUrl: 'https://image.example.com',
    encryptedKey: 'encrypted:one',
    isEnabled: true,
    createdAt: '2026-01-01T00:00:01.000Z',
  });
  upsertApiKey({
    id: 'key-list-seedance',
    ownerUserId: owner.id,
    keyScope: 'user',
    providerId: 'seedance',
    name: 'Video Key',
    baseUrl: 'https://video.example.com',
    encryptedKey: 'encrypted:two',
    isEnabled: false,
    createdAt: '2026-01-01T00:00:02.000Z',
  });
  upsertApiKey({
    id: 'key-list-server',
    ownerUserId: 'local-user',
    keyScope: 'server',
    providerId: 'aliyun-bailian',
    name: 'Shared Server Key',
    encryptedKey: 'encrypted:server',
    isEnabled: true,
    createdAt: '2026-01-01T00:00:03.000Z',
  });
  upsertApiKey({
    id: 'key-list-other-private',
    ownerUserId: other.id,
    keyScope: 'user',
    providerId: 'anthropic',
    name: 'Other Private Key',
    encryptedKey: 'encrypted:other',
    isEnabled: true,
    createdAt: '2026-01-01T00:00:04.000Z',
  });

  const app = registerRoutesFor(owner.id, 10);
  const route = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/api-keys');

  const firstPage = createMockRes();
  route.handler({ query: { limit: 2, offset: 0 } }, firstPage);
  assert.equal(firstPage.statusCode, 200);
  assert.equal(firstPage.body.count, 2);
  assert.equal(firstPage.body.total, 3);
  assert.equal(firstPage.body.limit, 2);
  assert.equal(firstPage.body.offset, 0);
  assert.deepEqual(firstPage.body.quota, {
    userKeyCount: 2,
    maxUserApiKeys: 10,
    remainingUserKeys: 8,
  });
  assert.deepEqual(firstPage.body.apiKeys.map((key) => key.id), ['key-list-server', 'key-list-seedance']);
  assert.equal(firstPage.body.apiKeys.some((key) => key.id === 'key-list-other-private'), false);

  const secondPage = createMockRes();
  route.handler({ query: { limit: 2, offset: 2 } }, secondPage);
  assert.deepEqual(secondPage.body.apiKeys.map((key) => key.id), ['key-list-openai']);

  const filtered = createMockRes();
  route.handler({
    query: {
      search: 'video',
      providerId: 'seedance',
      keyScope: 'user',
      status: 'disabled',
      limit: 10,
    },
  }, filtered);
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.apiKeys[0].id, 'key-list-seedance');
});

test('api key route does not allow overwriting another user key by id', () => {
  const owner = createUser({
    email: 'key-owner@example.com',
    username: 'key-owner@example.com',
    name: 'Key Owner',
    passwordHash: 'test',
  });
  const attacker = createUser({
    email: 'key-attacker@example.com',
    username: 'key-attacker@example.com',
    name: 'Key Attacker',
    passwordHash: 'test',
  });
  const ownedKey = upsertApiKey({
    id: 'owned-key',
    ownerUserId: owner.id,
    keyScope: 'user',
    providerId: 'openai-compatible',
    name: 'Owner Key',
    encryptedKey: 'encrypted:owner',
  });
  const app = registerRoutesFor(attacker.id, 5);
  const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/api-keys');

  const res = createMockRes();
  route.handler({
    body: {
      id: ownedKey.id,
      providerId: 'anthropic',
      apiKey: 'attacker-key',
    },
  }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(getApiKey(ownedKey.id, true).ownerUserId, owner.id);
  assert.equal(getApiKey(ownedKey.id, true).providerId, 'openai-compatible');
});

test('api key create, update, and delete write safe audit logs', () => {
  const user = createUser({
    email: 'key-audit@example.com',
    username: 'key-audit@example.com',
    name: 'Key Audit User',
    passwordHash: 'test',
  });
  const app = registerRoutesFor(user.id, 5);
  const createRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/api-keys');
  const updateRoute = app.routes.find((item) => item.method === 'PATCH' && item.pathname === '/api/api-keys/:apiKeyId');
  const deleteRoute = app.routes.find((item) => item.method === 'DELETE' && item.pathname === '/api/api-keys/:apiKeyId');

  const createRes = createMockRes();
  createRoute.handler({
    body: {
      providerId: 'openai-compatible',
      name: 'Audited Key',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-create-secret',
    },
    headers: { 'user-agent': 'Audit Browser' },
    socket: { remoteAddress: '203.0.113.30' },
  }, createRes);

  assert.equal(createRes.statusCode, 201);
  const createdKeyId = createRes.body.apiKey.id;
  const createLog = listAuditLogs().find((log) => log.action === 'api_key.create' && log.targetId === createdKeyId);
  assert.equal(createLog.actorUserId, user.id);
  assert.equal(createLog.metadata.providerId, 'openai-compatible');
  assert.equal(JSON.stringify(createLog.metadata).includes('sk-create-secret'), false);
  assert.equal(JSON.stringify(createLog.metadata).includes('encrypted:'), false);

  const updateRes = createMockRes();
  updateRoute.handler({
    params: { apiKeyId: createdKeyId },
    body: {
      name: 'Updated Key',
      apiKey: 'sk-update-secret',
      isEnabled: false,
    },
    headers: { 'user-agent': 'Audit Browser' },
    socket: { remoteAddress: '203.0.113.30' },
  }, updateRes);

  assert.equal(updateRes.statusCode, 200);
  const updateLog = listAuditLogs().find((log) => log.action === 'api_key.update' && log.targetId === createdKeyId);
  assert.equal(updateLog.metadata.changedName, true);
  assert.equal(updateLog.metadata.changedSecret, true);
  assert.equal(updateLog.metadata.changedEnabled, true);
  assert.equal(JSON.stringify(updateLog.metadata).includes('sk-update-secret'), false);
  assert.equal(JSON.stringify(updateLog.metadata).includes('encrypted:'), false);

  const deleteRes = createMockRes();
  deleteRoute.handler({
    params: { apiKeyId: createdKeyId },
    headers: { 'user-agent': 'Audit Browser' },
    socket: { remoteAddress: '203.0.113.30' },
  }, deleteRes);

  assert.equal(deleteRes.statusCode, 200);
  const deleteLog = listAuditLogs().find((log) => log.action === 'api_key.delete' && log.targetId === createdKeyId);
  assert.equal(deleteLog.metadata.ownerUserId, user.id);
  assert.equal(JSON.stringify(deleteLog.metadata).includes('sk-'), false);
  assert.equal(JSON.stringify(deleteLog.metadata).includes('encrypted:'), false);
});

test('api key upsert with an existing id writes an update audit log', () => {
  const user = createUser({
    email: 'key-upsert-audit@example.com',
    username: 'key-upsert-audit@example.com',
    name: 'Key Upsert Audit User',
    passwordHash: 'test',
  });
  const existing = upsertApiKey({
    id: 'upsert-audit-key',
    ownerUserId: user.id,
    keyScope: 'user',
    providerId: 'openai-compatible',
    name: 'Existing Key',
    encryptedKey: 'encrypted:old',
  });
  const app = registerRoutesFor(user.id, 5);
  const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/api-keys');

  const res = createMockRes();
  route.handler({
    body: {
      id: existing.id,
      providerId: 'openai-compatible',
      name: 'Upserted Key',
      apiKey: 'sk-upsert-secret',
    },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(listAuditLogs().some((log) =>
    log.action === 'api_key.update' &&
    log.targetId === existing.id &&
    log.metadata.changedSecret === true
  ), true);
  assert.equal(listAuditLogs().some((log) => log.action === 'api_key.create' && log.targetId === existing.id), false);
});

test('api key server scoped keys require admin for create, update, delete, and test', async () => {
  const user = createUser({
    email: 'server-key-user@example.com',
    username: 'server-key-user@example.com',
    name: 'Server Key User',
    passwordHash: 'test',
  });
  const serverKey = upsertApiKey({
    id: 'server-owned-key',
    ownerUserId: 'local-user',
    keyScope: 'server',
    providerId: 'openai-compatible',
    name: 'Server Owned Key',
    encryptedKey: 'encrypted:server',
    isEnabled: true,
  });
  let testCalled = false;
  const app = registerRoutesFor(user.id, 5, {
    requireAdmin: (_req, res) => {
      res.status(403).json({ error: 'Admin token is required.' });
      return false;
    },
    testApiKey: async () => {
      testCalled = true;
      return {};
    },
  });
  const createRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/api-keys');
  const updateRoute = app.routes.find((item) => item.method === 'PATCH' && item.pathname === '/api/api-keys/:apiKeyId');
  const deleteRoute = app.routes.find((item) => item.method === 'DELETE' && item.pathname === '/api/api-keys/:apiKeyId');
  const testRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/api-keys/:apiKeyId/test');

  const createRes = createMockRes();
  createRoute.handler({
    body: {
      id: 'blocked-server-key',
      keyScope: 'server',
      providerId: 'anthropic',
      apiKey: 'server-secret',
    },
  }, createRes);
  assert.equal(createRes.statusCode, 403);
  assert.equal(getApiKey('blocked-server-key', true), null);

  const updateRes = createMockRes();
  updateRoute.handler({
    params: { apiKeyId: serverKey.id },
    body: {
      name: 'Hijacked Server Key',
      apiKey: 'new-server-secret',
    },
  }, updateRes);
  assert.equal(updateRes.statusCode, 403);
  assert.equal(getApiKey(serverKey.id, true).name, 'Server Owned Key');
  assert.equal(getApiKey(serverKey.id, true).encryptedKey, 'encrypted:server');

  const deleteRes = createMockRes();
  deleteRoute.handler({
    params: { apiKeyId: serverKey.id },
  }, deleteRes);
  assert.equal(deleteRes.statusCode, 403);
  assert.ok(getApiKey(serverKey.id, true));

  const testRes = createMockRes();
  await testRoute.handler({
    params: { apiKeyId: serverKey.id },
    body: { testText: true },
  }, testRes);
  assert.equal(testRes.statusCode, 403);
  assert.equal(testCalled, false);
});

test('api key test route delegates saved keys and writes an audit log', async () => {
  const user = createUser({
    email: 'key-test@example.com',
    username: 'key-test@example.com',
    name: 'Key Test User',
    passwordHash: 'test',
  });
  const key = upsertApiKey({
    id: 'testable-key',
    ownerUserId: user.id,
    keyScope: 'user',
    providerId: 'openai-compatible',
    name: 'Testable Key',
    encryptedKey: 'encrypted:test',
    isEnabled: true,
  });
  const calls = [];
  const app = registerRoutesFor(user.id, 5, {
    testApiKey: async (input) => {
      calls.push(input);
      return {
        apiKeyId: input.apiKeyId,
        providerId: input.providerId,
        baseUrl: 'https://api.example.com',
        selectedModel: 'gpt-4o-mini',
        models: { ok: true, count: 1, models: [{ id: 'gpt-4o-mini' }] },
        capabilities: { chat: true, imageGeneration: false, videoGeneration: false },
        tests: {
          credentials: { ok: true },
          text: { ok: true, skipped: true },
          image: { ok: false, skipped: true },
          video: { ok: false, skipped: true },
        },
      };
    },
  });
  const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/api-keys/:apiKeyId/test');

  const res = createMockRes();
  await route.handler({
    params: { apiKeyId: key.id },
    body: { model: 'gpt-4o-mini', testText: true },
    headers: { 'user-agent': 'Test Browser' },
    socket: { remoteAddress: '203.0.113.20' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiKeyId, key.id);
  assert.equal(calls[0].userId, user.id);
  assert.equal(res.body.result.tests.credentials.ok, true);
  assert.equal(listAuditLogs().some((log) => log.action === 'api_key.test' && log.targetId === key.id), true);
});

test('api key test route does not expose keys owned by another user', async () => {
  const owner = createUser({
    email: 'test-owner@example.com',
    username: 'test-owner@example.com',
    name: 'Test Owner',
    passwordHash: 'test',
  });
  const attacker = createUser({
    email: 'test-attacker@example.com',
    username: 'test-attacker@example.com',
    name: 'Test Attacker',
    passwordHash: 'test',
  });
  const key = upsertApiKey({
    id: 'private-test-key',
    ownerUserId: owner.id,
    keyScope: 'user',
    providerId: 'openai-compatible',
    encryptedKey: 'encrypted:owner',
    isEnabled: true,
  });
  const app = registerRoutesFor(attacker.id, 5, {
    testApiKey: async () => {
      throw new Error('should not be called');
    },
  });
  const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/api-keys/:apiKeyId/test');

  const res = createMockRes();
  await route.handler({ params: { apiKeyId: key.id }, body: {} }, res);

  assert.equal(res.statusCode, 404);
});
