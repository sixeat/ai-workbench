const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-model-service-test-'));
process.env.WORKBENCH_DATA_DIR = path.join(tempDir, 'data');
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'data', 'test.sqlite');
process.env.WORKBENCH_DEPLOYMENT_MODE = 'server';
process.env.WORKBENCH_KEY_SECRET = 'model-service-test-secret-0123456789';
process.env.WORKBENCH_REQUIRE_LOGIN = 'true';

const {
  createUser,
  db,
  getApiKey,
  getTask,
  listModelCapabilities,
} = require('./db.cjs');
const {
  createModelServiceApp,
  modelServiceIdentityRequired,
  resolveModelServiceHost,
  resolveModelServicePort,
} = require('./modelServiceApp.cjs');

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        server,
      });
    });
    server.on('error', reject);
  });
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function withRuntime(env, fn) {
  const runtime = createModelServiceApp({
    env,
    startWorkers: false,
  });
  const { baseUrl, server } = await listen(runtime.app);

  try {
    return await fn({ baseUrl, runtime });
  } finally {
    await closeServer(server);
    await runtime.stop();
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return {
    data,
    headers: response.headers,
    status: response.status,
  };
}

function serverEnv(extra = {}) {
  return {
    ...process.env,
    WORKBENCH_DEPLOYMENT_MODE: 'server',
    WORKBENCH_KEY_SECRET: 'model-service-test-secret-0123456789',
    WORKBENCH_REQUIRE_LOGIN: 'true',
    ...extra,
  };
}

function internalHeaders(user, extra = {}) {
  return {
    'Content-Type': 'application/json',
    'x-workbench-user-id': user.id,
    'x-workbench-user-role': user.role || 'user',
    ...extra,
  };
}

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('model-service defaults to an internal host and dedicated port', () => {
  assert.equal(resolveModelServiceHost({}), '127.0.0.1');
  assert.equal(resolveModelServicePort({}), 3003);
  assert.equal(resolveModelServicePort({ WORKBENCH_MODEL_SERVICE_PORT: '4300' }), 4300);
});

test('model-service identity is required only for model boundaries', () => {
  assert.equal(modelServiceIdentityRequired('/api/api-keys'), true);
  assert.equal(modelServiceIdentityRequired('/api/chat'), true);
  assert.equal(modelServiceIdentityRequired('/api/claude'), true);
  assert.equal(modelServiceIdentityRequired('/api/model-capabilities'), true);
  assert.equal(modelServiceIdentityRequired('/api/model-capability-presets'), true);
  assert.equal(modelServiceIdentityRequired('/api/models'), true);
  assert.equal(modelServiceIdentityRequired('/api/providers'), true);
  assert.equal(modelServiceIdentityRequired('/api/proxy'), true);
  assert.equal(modelServiceIdentityRequired('/api/admin/health'), true);
  assert.equal(modelServiceIdentityRequired('/api/health'), false);
  assert.equal(modelServiceIdentityRequired('/api/assets'), false);
  assert.equal(modelServiceIdentityRequired('/api/tasks'), false);
});

test('model-service exposes health and does not mount unrelated backend modules', async () => {
  await withRuntime(serverEnv(), async ({ baseUrl, runtime }) => {
    assert.equal(runtime.config.host, '127.0.0.1');
    assert.equal(runtime.config.startWorkers, false);

    const health = await fetchJson(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.data.status, 'ok');
    assert.equal(health.data.serveStatic, false);

    const assets = await fetchJson(`${baseUrl}/api/assets`, {
      headers: { 'x-workbench-user-id': 'any-user' },
    });
    const workflows = await fetchJson(`${baseUrl}/api/workflows`, {
      headers: { 'x-workbench-user-id': 'any-user' },
    });
    const tasks = await fetchJson(`${baseUrl}/api/tasks`, {
      headers: { 'x-workbench-user-id': 'any-user' },
    });
    assert.equal(assets.status, 404);
    assert.equal(workflows.status, 404);
    assert.equal(tasks.status, 404);
  });
});

test('model-service requires gateway user context in server mode', async () => {
  await withRuntime(serverEnv(), async ({ baseUrl }) => {
    const response = await fetchJson(`${baseUrl}/api/providers`);

    assert.equal(response.status, 401);
    assert.deepEqual(response.data, { error: 'Gateway user context is required.' });
  });
});

test('model-service can require an internal service token when configured', async () => {
  const user = createUser({
    email: 'model-token@example.com',
    name: 'Model Token',
    passwordHash: 'test',
    username: 'model-token@example.com',
  });

  await withRuntime(serverEnv({
    WORKBENCH_INTERNAL_SERVICE_TOKEN: 'internal-token',
  }), async ({ baseUrl }) => {
    const rejected = await fetchJson(`${baseUrl}/api/providers`, {
      headers: {
        'x-workbench-user-id': user.id,
      },
    });
    assert.equal(rejected.status, 403);

    const accepted = await fetchJson(`${baseUrl}/api/providers`, {
      headers: {
        'x-workbench-internal-token': 'internal-token',
        'x-workbench-user-id': user.id,
      },
    });
    assert.equal(accepted.status, 200);
    assert.ok(accepted.data.count > 0);
  });
});

test('model-service keeps admin operations behind the gateway-injected role', async () => {
  const user = createUser({
    email: 'model-user@example.com',
    name: 'Model User',
    passwordHash: 'test',
    role: 'user',
    username: 'model-user@example.com',
  });
  const admin = createUser({
    email: 'model-admin@example.com',
    name: 'Model Admin',
    passwordHash: 'test',
    role: 'admin',
    username: 'model-admin@example.com',
  });

  await withRuntime(serverEnv(), async ({ baseUrl }) => {
    const blockedServerKey = await fetchJson(`${baseUrl}/api/api-keys`, {
      body: JSON.stringify({
        apiKey: 'server-secret',
        keyScope: 'server',
        providerId: 'openai-compatible',
      }),
      headers: internalHeaders(user),
      method: 'POST',
    });
    assert.equal(blockedServerKey.status, 403);

    const createdServerKey = await fetchJson(`${baseUrl}/api/api-keys`, {
      body: JSON.stringify({
        apiKey: 'server-secret',
        keyScope: 'server',
        name: 'Shared OpenAI',
        providerId: 'openai-compatible',
      }),
      headers: internalHeaders(admin),
      method: 'POST',
    });
    assert.equal(createdServerKey.status, 201);
    assert.equal(createdServerKey.data.apiKey.keyScope, 'server');
    assert.equal(getApiKey(createdServerKey.data.apiKey.id, true).keyScope, 'server');

    const blockedCapability = await fetchJson(`${baseUrl}/api/model-capabilities`, {
      body: JSON.stringify({
        capabilities: { imageGeneration: true },
        modelPattern: 'blocked-*',
        providerId: 'demo',
      }),
      headers: internalHeaders(user),
      method: 'POST',
    });
    assert.equal(blockedCapability.status, 403);

    const savedCapability = await fetchJson(`${baseUrl}/api/model-capabilities`, {
      body: JSON.stringify({
        capabilities: { imageGeneration: true },
        modelPattern: 'demo-image-*',
        providerId: 'demo',
      }),
      headers: internalHeaders(admin),
      method: 'POST',
    });
    assert.equal(savedCapability.status, 201);
    assert.equal(savedCapability.data.capability.providerId, 'demo');
    assert.equal(listModelCapabilities({ providerId: 'demo' }).length, 1);
  });
});

test('model-service exposes provider templates and model capability presets to authenticated users', async () => {
  const user = createUser({
    email: 'model-reader@example.com',
    name: 'Model Reader',
    passwordHash: 'test',
    username: 'model-reader@example.com',
  });

  await withRuntime(serverEnv(), async ({ baseUrl }) => {
    const providers = await fetchJson(`${baseUrl}/api/providers`, {
      headers: internalHeaders(user),
    });
    assert.equal(providers.status, 200);
    assert.equal(providers.data.providers.some((provider) => provider.id === 'openai-compatible'), true);

    const presets = await fetchJson(`${baseUrl}/api/model-capability-presets`, {
      headers: internalHeaders(user),
    });
    assert.equal(presets.status, 200);
    assert.ok(presets.data.count > 0);
  });
});

test('model-service chat route enqueues text tasks without consuming them by default', async () => {
  const user = createUser({
    email: 'model-chat@example.com',
    name: 'Model Chat',
    passwordHash: 'test',
    username: 'model-chat@example.com',
  });

  await withRuntime(serverEnv(), async ({ baseUrl, runtime }) => {
    const response = await fetchJson(`${baseUrl}/api/chat`, {
      body: JSON.stringify({
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'hello from model service' }],
        providerId: 'openai-compatible',
      }),
      headers: internalHeaders(user),
      method: 'POST',
    });

    assert.equal(response.status, 202);
    assert.equal(response.data.status, 'queued');
    assert.equal(response.data.task.userId, user.id);
    assert.equal(getTask(response.data.taskId).status, 'queued');
    assert.equal(runtime.handlers.modelProxyHandlers.getTextQueueStats().scheduled, false);
  });
});
