const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-worker-service-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');
process.env.WORKBENCH_DEPLOYMENT_MODE = 'server';
process.env.WORKBENCH_KEY_SECRET = 'worker-service-test-secret-0123456789';
process.env.WORKBENCH_REQUIRE_LOGIN = 'true';

const { countTasks, createUser, db, getTask } = require('./db.cjs');
const {
  createWorkerServiceApp,
  resolveWorkerServiceHost,
  resolveWorkerServicePort,
  workerServiceIdentityRequired,
} = require('./workerServiceApp.cjs');
const { creditRepository } = require('./repositories/creditRepository.cjs');

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
  const runtime = createWorkerServiceApp({
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
    WORKBENCH_KEY_SECRET: 'worker-service-test-secret-0123456789',
    WORKBENCH_REQUIRE_LOGIN: 'true',
    ...extra,
  };
}

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('worker-service defaults to an internal host and separate port', () => {
  assert.equal(resolveWorkerServiceHost({}), '127.0.0.1');
  assert.equal(resolveWorkerServicePort({}), 3001);
  assert.equal(resolveWorkerServicePort({ PROXY_PORT: '4000' }), 4000);
  assert.equal(resolveWorkerServicePort({ WORKBENCH_WORKER_SERVICE_PORT: '4100' }), 4100);
});

test('worker-service identity is required only for owned API boundaries', () => {
  assert.equal(workerServiceIdentityRequired('/api/images'), true);
  assert.equal(workerServiceIdentityRequired('/api/videos/task-1'), true);
  assert.equal(workerServiceIdentityRequired('/api/tasks/task-1/retry'), true);
  assert.equal(workerServiceIdentityRequired('/api/admin/health'), true);
  assert.equal(workerServiceIdentityRequired('/api/health'), false);
  assert.equal(workerServiceIdentityRequired('/api/assets'), false);
  assert.equal(workerServiceIdentityRequired('/api/workflows'), false);
});

test('worker-service exposes health and does not mount unrelated backend modules', async () => {
  await withRuntime(serverEnv(), async ({ baseUrl, runtime }) => {
    assert.equal(runtime.config.host, '127.0.0.1');
    assert.equal(runtime.config.startWorkers, false);

    const health = await fetchJson(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.data.status, 'ok');
    assert.equal(health.data.serveStatic, false);

    const assets = await fetchJson(`${baseUrl}/api/assets`);
    const workflows = await fetchJson(`${baseUrl}/api/workflows`);
    const chat = await fetchJson(`${baseUrl}/api/chat`, { method: 'POST' });
    assert.equal(assets.status, 404);
    assert.equal(workflows.status, 404);
    assert.equal(chat.status, 404);
  });
});

test('worker-service requires gateway user context in server mode', async () => {
  await withRuntime(serverEnv(), async ({ baseUrl }) => {
    const response = await fetchJson(`${baseUrl}/api/images`, {
      body: JSON.stringify({
        model: 'gpt-image-test',
        prompt: 'missing gateway user context',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    assert.equal(response.status, 401);
    assert.deepEqual(response.data, { error: 'Gateway user context is required.' });
  });
});

test('worker-service can require an internal service token when configured', async () => {
  const user = createUser({
    email: 'worker-token@example.com',
    name: 'Worker Token',
    passwordHash: 'test',
    username: 'worker-token@example.com',
  });

  await withRuntime(serverEnv({
    WORKBENCH_INTERNAL_SERVICE_TOKEN: 'internal-token',
  }), async ({ baseUrl }) => {
    const rejected = await fetchJson(`${baseUrl}/api/tasks`, {
      headers: {
        'x-workbench-user-id': user.id,
      },
    });
    assert.equal(rejected.status, 403);

    const accepted = await fetchJson(`${baseUrl}/api/tasks`, {
      headers: {
        'x-workbench-internal-token': 'internal-token',
        'x-workbench-user-id': user.id,
      },
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.total, 0);
  });
});

test('worker-service enqueues generation tasks using gateway user context', async () => {
  const user = createUser({
    email: 'worker-image@example.com',
    name: 'Worker Image',
    passwordHash: 'test',
    username: 'worker-image@example.com',
  });
  creditRepository.adjustAccount({
    amount: 20,
    description: 'Test grant.',
    userId: user.id,
  });

  await withRuntime(serverEnv(), async ({ baseUrl, runtime }) => {
    const response = await fetchJson(`${baseUrl}/api/images`, {
      body: JSON.stringify({
        model: 'gpt-image-test',
        prompt: 'queued through worker-service',
        providerId: 'openai-compatible',
      }),
      headers: {
        'Content-Type': 'application/json',
        'x-workbench-user-id': user.id,
      },
      method: 'POST',
    });

    assert.equal(response.status, 202);
    assert.equal(response.data.status, 'queued');
    assert.equal(response.data.task.userId, user.id);
    const task = getTask(response.data.taskId);
    assert.equal(task.status, 'queued');
    assert.equal(task.creditCost, 10);
    assert.equal(task.creditStatus, 'charged');
    assert.equal(task.creditKeyScope, 'server_key');
    assert.equal(creditRepository.getAccount(user.id).balance, 10);
    assert.equal(runtime.handlers.generationHandlers.getGenerationQueueStats().scheduled, false);
  });
});

test('worker-service rejects server-key image tasks when credits are insufficient', async () => {
  const user = createUser({
    email: 'worker-image-no-credit@example.com',
    name: 'Worker Image No Credit',
    passwordHash: 'test',
    username: 'worker-image-no-credit@example.com',
  });

  await withRuntime(serverEnv(), async ({ baseUrl }) => {
    const response = await fetchJson(`${baseUrl}/api/images`, {
      body: JSON.stringify({
        model: 'gpt-image-test',
        prompt: 'no credits',
        providerId: 'openai-compatible',
      }),
      headers: {
        'Content-Type': 'application/json',
        'x-workbench-user-id': user.id,
      },
      method: 'POST',
    });

    assert.equal(response.status, 402);
    assert.equal(response.data.error, 'Insufficient credits.');
    assert.equal(countTasks(user.id), 0);
  });
});
