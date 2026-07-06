const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-model-capability-repo-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const { db } = require('./db.cjs');
const { getModelCapabilities } = require('./modelCapabilities.cjs');
const { registerModelProxyRoutes } = require('./routes/modelProxyRoutes.cjs');

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

function createInMemoryModelCapabilityRepository(initial = []) {
  const capabilities = new Map();
  const auditLogs = [];

  for (const item of initial) {
    capabilities.set(`${item.providerId}:${item.modelPattern}`, {
      id: `${item.providerId}:${item.modelPattern}`,
      ...item,
    });
  }

  function list(options = {}) {
    const limit = Number(options.limit || 500);
    const offset = Number(options.offset || 0);
    const search = String(options.search || options.q || '').trim().toLowerCase();
    const providerId = String(options.providerId || '').trim();
    return Array.from(capabilities.values())
      .filter((item) => !providerId || item.providerId === providerId)
      .filter((item) => !search || item.providerId.toLowerCase().includes(search) || item.modelPattern.toLowerCase().includes(search))
      .sort((a, b) => `${a.providerId}:${a.modelPattern}`.localeCompare(`${b.providerId}:${b.modelPattern}`))
      .slice(offset, offset + limit);
  }

  return {
    auditLogs,
    capabilities,
    countModelCapabilities(options) {
      return list({ ...options, limit: 500, offset: 0 }).length;
    },
    createAuditLog(log) {
      auditLogs.push(log);
      return log;
    },
    listModelCapabilities: list,
    upsertModelCapability(providerId, modelPattern, capabilityValue) {
      capabilities.set(`${providerId}:${modelPattern}`, {
        capabilities: capabilityValue,
        id: `${providerId}:${modelPattern}`,
        modelPattern,
        providerId,
      });
    },
  };
}

function route(app, method, pathname) {
  return app.routes.find((item) => item.method === method && item.pathname === pathname);
}

function registerRoutesFor(repository) {
  const app = createFakeApp();
  const handlers = registerModelProxyRoutes(app, {
    autoStartQueue: false,
    enableGenericProxy: false,
    getRequestUserId: () => 'admin-user',
    joinUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    modelCapabilityRepository: repository,
    proxyAllowlist: [],
    proxyRequest: async () => ({ data: {}, status: 200 }),
    readSecrets: async () => ({}),
    requireAdmin: () => true,
    resolveApiCredentials: async () => ({ apiKey: 'key', baseUrl: 'https://api.example.com' }),
    resolveDirectCredentials: () => ({ apiKey: 'key', baseUrl: 'https://api.example.com' }),
  });
  return { app, handlers };
}

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('model capability routes can list and save through an injected repository', () => {
  const repository = createInMemoryModelCapabilityRepository([
    {
      capabilities: { imageGeneration: true },
      modelPattern: 'alpha-image-*',
      providerId: 'demo-provider',
    },
    {
      capabilities: { videoGeneration: true },
      modelPattern: 'beta-video-*',
      providerId: 'demo-provider',
    },
  ]);
  const { app, handlers } = registerRoutesFor(repository);

  const listRes = createMockRes();
  route(app, 'GET', '/api/model-capabilities').handler({
    query: {
      limit: 1,
      providerId: 'demo-provider',
      search: 'image',
    },
  }, listRes);

  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.count, 1);
  assert.equal(listRes.body.total, 1);
  assert.equal(listRes.body.capabilities[0].modelPattern, 'alpha-image-*');

  const saveRes = createMockRes();
  route(app, 'POST', '/api/model-capabilities').handler({
    authUser: { id: 'admin-user' },
    body: {
      capabilities: {
        videoGeneration: true,
        video: { durationMax: 8 },
      },
      modelPattern: 'gamma-video-*',
      providerId: 'demo-provider',
    },
    headers: { 'user-agent': 'Boundary Browser' },
    socket: { remoteAddress: '203.0.113.20' },
  }, saveRes);

  assert.equal(saveRes.statusCode, 201);
  assert.equal(saveRes.body.capability.id, 'demo-provider:gamma-video-*');
  assert.equal(repository.capabilities.get('demo-provider:gamma-video-*').capabilities.video.durationMax, 8);
  assert.deepEqual(repository.auditLogs.map((log) => log.action), ['model_capability.upsert']);
  assert.deepEqual(repository.auditLogs[0].metadata, {
    operation: 'create',
    providerId: 'demo-provider',
    modelPattern: 'gamma-video-*',
    capabilityKeys: ['video', 'videoGeneration'],
  });

  handlers.stopTextQueue();
});

test('getModelCapabilities resolves wildcard rules through an injected repository', () => {
  const repository = createInMemoryModelCapabilityRepository([
    {
      capabilities: {
        imageGeneration: true,
        image: { maxImages: 2 },
      },
      modelPattern: '*',
      providerId: 'demo-provider',
    },
    {
      capabilities: {
        image: { maxImages: 8 },
        seed: true,
      },
      modelPattern: 'pro-*',
      providerId: 'demo-provider',
    },
  ]);

  const capabilities = getModelCapabilities('demo-provider', 'pro-image-v1', repository);

  assert.equal(capabilities.imageGeneration, true);
  assert.equal(capabilities.seed, true);
  assert.equal(capabilities.image.maxImages, 8);
});
