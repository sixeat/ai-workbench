const assert = require('node:assert/strict');
const test = require('node:test');

const {
  apiKeyUpdateAuditMetadata,
  createApiKeyManagementService,
  listQuery,
} = require('./services/apiKeyManagementService.cjs');

function createRepository(initial = []) {
  const apiKeys = new Map();
  const auditLogs = [];
  for (const item of initial) {
    apiKeys.set(item.id, {
      baseUrl: '',
      isEnabled: true,
      name: item.providerId,
      ...item,
    });
  }

  function visibleToUser(key, userId, includeServer) {
    return key?.ownerUserId === userId || (includeServer && key?.keyScope === 'server');
  }

  function list(userId, includeServer, query = {}) {
    const search = String(query.search || '').toLowerCase();
    return Array.from(apiKeys.values())
      .filter((key) => visibleToUser(key, userId, includeServer))
      .filter((key) => !query.providerId || key.providerId === query.providerId)
      .filter((key) => !query.keyScope || key.keyScope === query.keyScope)
      .filter((key) => !query.status || (query.status === 'enabled' ? key.isEnabled : !key.isEnabled))
      .filter((key) => !search || [key.name, key.providerId, key.baseUrl].some((value) => String(value || '').toLowerCase().includes(search)))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(Number(query.offset || 0), Number(query.offset || 0) + Number(query.limit || 100));
  }

  return {
    apiKeys,
    auditLogs,
    countApiKeys(userId, includeServer, query = {}) {
      return list(userId, includeServer, { ...query, limit: 10_000, offset: 0 }).length;
    },
    createAuditLog(log) {
      auditLogs.push(log);
      return log;
    },
    deleteApiKey(id) {
      return apiKeys.delete(id);
    },
    getApiKey(id) {
      return apiKeys.get(id) || null;
    },
    getApiKeyForUser(id, userId, includeServer) {
      const key = apiKeys.get(id);
      return visibleToUser(key, userId, includeServer) ? key : null;
    },
    listApiKeys: list,
    upsertApiKey(input) {
      const id = input.id || `key-${apiKeys.size + 1}`;
      const next = {
        baseUrl: '',
        id,
        isEnabled: true,
        name: input.providerId,
        ...apiKeys.get(id),
        ...input,
      };
      apiKeys.set(id, next);
      return next;
    },
  };
}

function createService(repository, options = {}) {
  return createApiKeyManagementService({
    apiKeyRepository: repository,
    encryptSecret: (value) => `encrypted:${value}`,
    getRequestUserId: (req) => req.authUser?.id || 'user-1',
    keyBelongsToUser: (apiKey, userId) => apiKey && (apiKey.ownerUserId === userId || apiKey.keyScope === 'server'),
    maxUserApiKeys: options.maxUserApiKeys || 2,
    testApiKey: options.testApiKey,
  });
}

test('api key management query clamps pagination and keeps filters', () => {
  assert.deepEqual(listQuery({
    keyScope: 'user',
    limit: 999,
    offset: -10,
    providerId: 'seedance',
    q: 'video',
    status: 'enabled',
  }), {
    keyScope: 'user',
    limit: 500,
    offset: 0,
    providerId: 'seedance',
    search: 'video',
    status: 'enabled',
  });
});

test('api key management service lists visible keys and quota', () => {
  const repository = createRepository([
    { id: 'a-user', ownerUserId: 'user-1', keyScope: 'user', providerId: 'openai-compatible' },
    { id: 'b-server', ownerUserId: 'local-user', keyScope: 'server', providerId: 'seedance' },
    { id: 'c-other', ownerUserId: 'user-2', keyScope: 'user', providerId: 'anthropic' },
  ]);
  const service = createService(repository, { maxUserApiKeys: 3 });

  const response = service.listApiKeys({
    authUser: { id: 'user-1' },
    query: { limit: 10 },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.data.apiKeys.map((key) => key.id), ['a-user', 'b-server']);
  assert.deepEqual(response.data.quota, {
    maxUserApiKeys: 3,
    remainingUserKeys: 2,
    userKeyCount: 1,
  });
});

test('api key management service creates user keys and writes safe audit metadata', () => {
  const repository = createRepository();
  const service = createService(repository);

  const response = service.createApiKey({
    authUser: { id: 'user-1' },
    body: {
      apiKey: 'sk-secret',
      baseUrl: 'https://api.example.com',
      name: 'Demo Key',
      providerId: 'openai-compatible',
    },
    headers: { 'user-agent': 'Unit Test' },
    socket: { remoteAddress: '198.51.100.10' },
  });

  assert.equal(response.status, 201);
  assert.equal(response.data.apiKey.encryptedKey, 'encrypted:sk-secret');
  assert.equal(repository.auditLogs[0].action, 'api_key.create');
  assert.equal(repository.auditLogs[0].metadata.operation, 'create');
  assert.equal(JSON.stringify(repository.auditLogs[0].metadata).includes('sk-secret'), false);
  assert.equal(JSON.stringify(repository.auditLogs[0].metadata).includes('encrypted:'), false);
});

test('api key management service enforces user key quota before writing', () => {
  const repository = createRepository([
    { id: 'existing', ownerUserId: 'user-1', keyScope: 'user', providerId: 'seedance' },
  ]);
  const service = createService(repository, { maxUserApiKeys: 1 });

  const response = service.createApiKey({
    authUser: { id: 'user-1' },
    body: {
      apiKey: 'sk-secret',
      providerId: 'openai-compatible',
    },
  });

  assert.equal(response.status, 429);
  assert.equal(repository.apiKeys.has('key-2'), false);
  assert.equal(repository.auditLogs.length, 0);
});

test('api key management service stops server key operations when admin guard rejects', () => {
  const repository = createRepository();
  const service = createService(repository);

  const response = service.createApiKey({
    authUser: { id: 'user-1' },
    body: {
      apiKey: 'server-secret',
      keyScope: 'server',
      providerId: 'seedance',
    },
  }, {
    ensureAdmin: () => false,
  });

  assert.equal(response, null);
  assert.equal(repository.apiKeys.size, 0);
  assert.equal(repository.auditLogs.length, 0);
});

test('api key management service updates only changed audit flags', () => {
  const existing = {
    baseUrl: 'https://api.example.com',
    id: 'key-1',
    isEnabled: true,
    name: 'Demo Key',
    ownerUserId: 'user-1',
    providerId: 'seedance',
  };
  const next = {
    ...existing,
    isEnabled: false,
    name: 'Renamed Key',
  };

  assert.deepEqual(apiKeyUpdateAuditMetadata(existing, next, {
    isEnabled: false,
    name: 'Renamed Key',
  }), {
    changedBaseUrl: false,
    changedEnabled: true,
    changedName: true,
    changedProvider: false,
    changedSecret: false,
    isEnabled: false,
    operation: 'update',
    previousIsEnabled: true,
    previousProviderId: 'seedance',
    providerId: 'seedance',
  });
});

test('api key management service tests keys and audits success or safe failure', async () => {
  const repository = createRepository([
    { id: 'test-key', ownerUserId: 'user-1', keyScope: 'user', providerId: 'seedance' },
  ]);
  const service = createService(repository, {
    testApiKey: async (input) => {
      if (input.model === 'fail') {
        throw Object.assign(new Error('Provider rejected this key.'), { expose: true, status: 401 });
      }
      return {
        models: { ok: true },
        selectedModel: input.model,
        tests: {
          image: { ok: false },
          text: { ok: true },
          video: { ok: true },
        },
      };
    },
  });

  const success = await service.testSavedApiKey({
    authUser: { id: 'user-1' },
    body: { model: 'seedance-demo', testText: true },
    params: { apiKeyId: 'test-key' },
  });
  const failure = await service.testSavedApiKey({
    authUser: { id: 'user-1' },
    body: { model: 'fail' },
    params: { apiKeyId: 'test-key' },
  });

  assert.equal(success.status, 200);
  assert.equal(failure.status, 401);
  assert.deepEqual(repository.auditLogs.map((log) => log.action), [
    'api_key.test',
    'api_key.test_failed',
  ]);
  assert.equal(repository.auditLogs[1].metadata.message, 'Provider rejected this key.');
});
