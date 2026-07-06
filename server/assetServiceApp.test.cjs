const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-asset-service-test-'));
process.env.WORKBENCH_DATA_DIR = path.join(tempDir, 'data');
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'data', 'test.sqlite');
process.env.IMAGE_OUTPUT_DIR = path.join(tempDir, 'outputs');
process.env.WORKBENCH_DEPLOYMENT_MODE = 'server';
process.env.WORKBENCH_KEY_SECRET = 'asset-service-test-secret-0123456789';
process.env.WORKBENCH_REQUIRE_LOGIN = 'true';

const { createUser, db } = require('./db.cjs');
const {
  assetServiceIdentityRequired,
  createAssetServiceApp,
  resolveAssetServiceHost,
  resolveAssetServicePort,
} = require('./assetServiceApp.cjs');

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
  const runtime = createAssetServiceApp({ env });
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
    WORKBENCH_KEY_SECRET: 'asset-service-test-secret-0123456789',
    WORKBENCH_REQUIRE_LOGIN: 'true',
    ...extra,
  };
}

function imageDataUrl(content = 'asset bytes') {
  return `data:image/png;base64,${Buffer.from(content).toString('base64')}`;
}

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('asset-service defaults to an internal host and dedicated port', () => {
  assert.equal(resolveAssetServiceHost({}), '127.0.0.1');
  assert.equal(resolveAssetServicePort({}), 3002);
  assert.equal(resolveAssetServicePort({ WORKBENCH_ASSET_SERVICE_PORT: '4200' }), 4200);
});

test('asset-service identity is required only for asset boundaries', () => {
  assert.equal(assetServiceIdentityRequired('/api/assets'), true);
  assert.equal(assetServiceIdentityRequired('/api/assets/upload'), true);
  assert.equal(assetServiceIdentityRequired('/api/images/image-1'), true);
  assert.equal(assetServiceIdentityRequired('/api/asset-collections'), true);
  assert.equal(assetServiceIdentityRequired('/api/asset-collection-templates'), true);
  assert.equal(assetServiceIdentityRequired('/api/admin/health'), true);
  assert.equal(assetServiceIdentityRequired('/api/health'), false);
  assert.equal(assetServiceIdentityRequired('/api/tasks'), false);
  assert.equal(assetServiceIdentityRequired('/api/workflows'), false);
});

test('asset-service exposes health and does not mount unrelated backend modules', async () => {
  await withRuntime(serverEnv(), async ({ baseUrl, runtime }) => {
    assert.equal(runtime.config.host, '127.0.0.1');

    const health = await fetchJson(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.data.status, 'ok');
    assert.equal(health.data.serveStatic, false);

    const tasks = await fetchJson(`${baseUrl}/api/tasks`, {
      headers: { 'x-workbench-user-id': 'any-user' },
    });
    const workflows = await fetchJson(`${baseUrl}/api/workflows`, {
      headers: { 'x-workbench-user-id': 'any-user' },
    });
    const chat = await fetchJson(`${baseUrl}/api/chat`, {
      headers: { 'x-workbench-user-id': 'any-user' },
      method: 'POST',
    });
    assert.equal(tasks.status, 404);
    assert.equal(workflows.status, 404);
    assert.equal(chat.status, 404);
  });
});

test('asset-service requires gateway user context in server mode', async () => {
  await withRuntime(serverEnv(), async ({ baseUrl }) => {
    const response = await fetchJson(`${baseUrl}/api/assets`);

    assert.equal(response.status, 401);
    assert.deepEqual(response.data, { error: 'Gateway user context is required.' });
  });
});

test('asset-service can require an internal service token when configured', async () => {
  const user = createUser({
    email: 'asset-token@example.com',
    name: 'Asset Token',
    passwordHash: 'test',
    username: 'asset-token@example.com',
  });

  await withRuntime(serverEnv({
    WORKBENCH_INTERNAL_SERVICE_TOKEN: 'internal-token',
  }), async ({ baseUrl }) => {
    const rejected = await fetchJson(`${baseUrl}/api/assets`, {
      headers: {
        'x-workbench-user-id': user.id,
      },
    });
    assert.equal(rejected.status, 403);

    const accepted = await fetchJson(`${baseUrl}/api/assets`, {
      headers: {
        'x-workbench-internal-token': 'internal-token',
        'x-workbench-user-id': user.id,
      },
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.total, 0);
  });
});

test('asset-service uploads lists and streams owned assets through gateway context', async () => {
  const user = createUser({
    email: 'asset-owner@example.com',
    name: 'Asset Owner',
    passwordHash: 'test',
    username: 'asset-owner@example.com',
  });
  const other = createUser({
    email: 'asset-other@example.com',
    name: 'Asset Other',
    passwordHash: 'test',
    username: 'asset-other@example.com',
  });

  await withRuntime(serverEnv(), async ({ baseUrl }) => {
    const upload = await fetchJson(`${baseUrl}/api/assets/upload`, {
      body: JSON.stringify({
        dataUrl: imageDataUrl('owned asset bytes'),
        fileName: 'owned.png',
        prompt: 'uploaded through asset-service',
      }),
      headers: {
        'Content-Type': 'application/json',
        'x-workbench-user-id': user.id,
      },
      method: 'POST',
    });

    assert.equal(upload.status, 201);
    assert.equal(upload.data.asset.type, 'image');
    assert.equal(upload.data.asset.fileName, 'owned.png');

    const list = await fetchJson(`${baseUrl}/api/assets`, {
      headers: {
        'x-workbench-user-id': user.id,
      },
    });
    assert.equal(list.status, 200);
    assert.equal(list.data.total, 1);
    assert.deepEqual(list.data.assets.map((asset) => asset.id), [upload.data.asset.id]);

    const stream = await fetch(`${baseUrl}/api/assets/${upload.data.asset.id}`, {
      headers: {
        'x-workbench-user-id': user.id,
      },
    });
    assert.equal(stream.status, 200);
    assert.equal(stream.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await stream.arrayBuffer()).toString(), 'owned asset bytes');

    const legacyStream = await fetch(`${baseUrl}/api/images/${upload.data.asset.id}`, {
      headers: {
        'x-workbench-user-id': user.id,
      },
    });
    assert.equal(legacyStream.status, 200);
    assert.equal(Buffer.from(await legacyStream.arrayBuffer()).toString(), 'owned asset bytes');

    const crossUser = await fetchJson(`${baseUrl}/api/assets/${upload.data.asset.id}`, {
      headers: {
        'x-workbench-user-id': other.id,
      },
    });
    assert.equal(crossUser.status, 404);
  });
});

test('asset-service exposes collection templates and collection creation inside the asset boundary', async () => {
  const user = createUser({
    email: 'asset-collection-owner@example.com',
    name: 'Asset Collection Owner',
    passwordHash: 'test',
    username: 'asset-collection-owner@example.com',
  });

  await withRuntime(serverEnv(), async ({ baseUrl }) => {
    const templates = await fetchJson(`${baseUrl}/api/asset-collection-templates`, {
      headers: {
        'x-workbench-user-id': user.id,
      },
    });
    assert.equal(templates.status, 200);
    assert.equal(templates.data.templates.some((template) => template.category === 'character'), true);

    const create = await fetchJson(`${baseUrl}/api/asset-collections`, {
      body: JSON.stringify({
        category: 'character',
        name: 'Character Pack',
      }),
      headers: {
        'Content-Type': 'application/json',
        'x-workbench-user-id': user.id,
      },
      method: 'POST',
    });
    assert.equal(create.status, 201);
    assert.equal(create.data.collection.name, 'Character Pack');

    const list = await fetchJson(`${baseUrl}/api/asset-collections`, {
      headers: {
        'x-workbench-user-id': user.id,
      },
    });
    assert.equal(list.status, 200);
    assert.deepEqual(list.data.collections.map((collection) => collection.name), ['Character Pack']);
  });
});
