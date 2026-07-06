const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-workflow-service-test-'));
process.env.WORKBENCH_DATA_DIR = path.join(tempDir, 'data');
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'data', 'test.sqlite');
process.env.WORKBENCH_DEPLOYMENT_MODE = 'server';
process.env.WORKBENCH_KEY_SECRET = 'workflow-service-test-secret-0123456789';
process.env.WORKBENCH_REQUIRE_LOGIN = 'true';

const {
  createUser,
  db,
} = require('./db.cjs');
const {
  createWorkflowServiceApp,
  resolveWorkflowServiceHost,
  resolveWorkflowServicePort,
  workflowServiceIdentityRequired,
} = require('./workflowServiceApp.cjs');

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
  const runtime = createWorkflowServiceApp({ env });
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
    WORKBENCH_KEY_SECRET: 'workflow-service-test-secret-0123456789',
    WORKBENCH_REQUIRE_LOGIN: 'true',
    ...extra,
  };
}

function userHeaders(userId, extra = {}) {
  return {
    'Content-Type': 'application/json',
    'x-workbench-user-id': userId,
    'x-workbench-user-role': 'user',
    ...extra,
  };
}

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('workflow-service defaults to an internal host and dedicated port', () => {
  assert.equal(resolveWorkflowServiceHost({}), '127.0.0.1');
  assert.equal(resolveWorkflowServicePort({}), 3005);
  assert.equal(resolveWorkflowServicePort({ WORKBENCH_WORKFLOW_SERVICE_PORT: '4500' }), 4500);
});

test('workflow-service identity is required only for workflow boundaries', () => {
  assert.equal(workflowServiceIdentityRequired('/api/workflows'), true);
  assert.equal(workflowServiceIdentityRequired('/api/workflows/workflow-1'), true);
  assert.equal(workflowServiceIdentityRequired('/api/admin/health'), true);
  assert.equal(workflowServiceIdentityRequired('/api/health'), false);
  assert.equal(workflowServiceIdentityRequired('/api/assets'), false);
  assert.equal(workflowServiceIdentityRequired('/api/tasks'), false);
  assert.equal(workflowServiceIdentityRequired('/api/auth/me'), false);
});

test('workflow-service exposes health and does not mount unrelated backend modules', async () => {
  await withRuntime(serverEnv(), async ({ baseUrl, runtime }) => {
    assert.equal(runtime.config.host, '127.0.0.1');

    const health = await fetchJson(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.data.status, 'ok');
    assert.equal(health.data.serveStatic, false);

    const assets = await fetchJson(`${baseUrl}/api/assets`, {
      headers: { 'x-workbench-user-id': 'any-user' },
    });
    const tasks = await fetchJson(`${baseUrl}/api/tasks`, {
      headers: { 'x-workbench-user-id': 'any-user' },
    });
    const chat = await fetchJson(`${baseUrl}/api/chat`, {
      headers: { 'x-workbench-user-id': 'any-user' },
      method: 'POST',
    });
    assert.equal(assets.status, 404);
    assert.equal(tasks.status, 404);
    assert.equal(chat.status, 404);
  });
});

test('workflow-service requires gateway user context in server mode', async () => {
  await withRuntime(serverEnv(), async ({ baseUrl }) => {
    const response = await fetchJson(`${baseUrl}/api/workflows`);

    assert.equal(response.status, 401);
    assert.deepEqual(response.data, { error: 'Gateway user context is required.' });
  });
});

test('workflow-service can require an internal service token when configured', async () => {
  await withRuntime(serverEnv({
    WORKBENCH_INTERNAL_SERVICE_TOKEN: 'internal-token',
  }), async ({ baseUrl }) => {
    const rejected = await fetchJson(`${baseUrl}/api/workflows`, {
      headers: userHeaders('workflow-token-user'),
    });
    assert.equal(rejected.status, 403);

    const accepted = await fetchJson(`${baseUrl}/api/workflows`, {
      headers: userHeaders('workflow-token-user', {
        'x-workbench-internal-token': 'internal-token',
      }),
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.total, 0);
  });
});

test('workflow-service creates, versions, restores, duplicates and deletes owned workflows', async () => {
  createUser({
    email: 'workflow-owner@example.com',
    id: 'workflow-owner',
    name: 'Workflow Owner',
    passwordHash: 'test',
    username: 'workflow-owner@example.com',
  });
  createUser({
    email: 'workflow-other@example.com',
    id: 'workflow-other',
    name: 'Workflow Other',
    passwordHash: 'test',
    username: 'workflow-other@example.com',
  });

  await withRuntime(serverEnv(), async ({ baseUrl }) => {
    const headers = userHeaders('workflow-owner');
    const create = await fetchJson(`${baseUrl}/api/workflows`, {
      body: JSON.stringify({
        id: 'workflow-service-flow',
        name: 'Storyboard Flow',
        nodes: [{ id: 'node-1' }],
      }),
      headers,
      method: 'POST',
    });
    assert.equal(create.status, 201);
    assert.equal(create.data.workflow.nodeCount, 1);

    const update = await fetchJson(`${baseUrl}/api/workflows/workflow-service-flow`, {
      body: JSON.stringify({
        name: 'Storyboard Flow v2',
        nodes: [{ id: 'node-1' }, { id: 'node-2' }],
      }),
      headers,
      method: 'PUT',
    });
    assert.equal(update.status, 200);
    assert.equal(update.data.workflow.nodeCount, 2);

    const list = await fetchJson(`${baseUrl}/api/workflows?search=storyboard`, { headers });
    assert.equal(list.status, 200);
    assert.equal(list.data.total, 1);

    const versions = await fetchJson(`${baseUrl}/api/workflows/workflow-service-flow/versions`, { headers });
    assert.equal(versions.status, 200);
    assert.equal(versions.data.total, 2);

    const firstVersion = versions.data.versions.find((version) => version.versionNumber === 1);
    const restore = await fetchJson(`${baseUrl}/api/workflows/workflow-service-flow/versions/${firstVersion.id}/restore`, {
      headers,
      method: 'POST',
    });
    assert.equal(restore.status, 200);
    assert.equal(restore.data.workflow.nodeCount, 1);
    assert.equal(restore.data.workflow.metadata.restoredFromVersionNumber, 1);

    const duplicateVersion = await fetchJson(`${baseUrl}/api/workflows/workflow-service-flow/versions/${firstVersion.id}/duplicate`, {
      headers,
      method: 'POST',
    });
    assert.equal(duplicateVersion.status, 201);
    assert.equal(duplicateVersion.data.workflow.metadata.copiedFromWorkflowId, 'workflow-service-flow');

    const duplicateWorkflow = await fetchJson(`${baseUrl}/api/workflows/workflow-service-flow/duplicate`, {
      headers,
      method: 'POST',
    });
    assert.equal(duplicateWorkflow.status, 201);
    assert.equal(duplicateWorkflow.data.workflow.metadata.copiedFromWorkflowId, 'workflow-service-flow');

    const crossUserGet = await fetchJson(`${baseUrl}/api/workflows/workflow-service-flow`, {
      headers: userHeaders('workflow-other'),
    });
    assert.equal(crossUserGet.status, 404);

    const deleted = await fetchJson(`${baseUrl}/api/workflows/workflow-service-flow`, {
      headers,
      method: 'DELETE',
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.data.ok, true);
  });
});

test('workflow-service admin health requires gateway admin role', async () => {
  await withRuntime(serverEnv({
    WORKBENCH_INTERNAL_SERVICE_TOKEN: 'internal-token',
  }), async ({ baseUrl }) => {
    const blocked = await fetchJson(`${baseUrl}/api/admin/health`, {
      headers: userHeaders('workflow-user', {
        'x-workbench-internal-token': 'internal-token',
      }),
    });
    assert.equal(blocked.status, 403);

    const accepted = await fetchJson(`${baseUrl}/api/admin/health`, {
      headers: userHeaders('workflow-admin', {
        'x-workbench-internal-token': 'internal-token',
        'x-workbench-user-role': 'admin',
      }),
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.status, 'ok');
    assert.equal(accepted.data.host, '127.0.0.1');
  });
});
