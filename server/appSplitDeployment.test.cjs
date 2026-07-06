const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-app-split-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');
process.env.WORKBENCH_DEPLOYMENT_MODE = 'server';
process.env.WORKBENCH_KEY_SECRET = 'split-deployment-test-secret-0123456789';
process.env.WORKBENCH_REQUIRE_LOGIN = 'true';

const { db } = require('./db.cjs');
const { createWorkbenchApp } = require('./app.cjs');

const splitServerEnv = {
  ...process.env,
  PROXY_HOST: '127.0.0.1',
  WORKBENCH_ADMIN_EMAIL: 'admin@example.com',
  WORKBENCH_ADMIN_NAME: 'Admin',
  WORKBENCH_ADMIN_PASSWORD: 'split-admin-password-123',
  WORKBENCH_ALLOW_PUBLIC_REGISTRATION: 'false',
  WORKBENCH_COOKIE_DOMAIN: '.example.com',
  WORKBENCH_COOKIE_SAMESITE: 'None',
  WORKBENCH_COOKIE_SECURE: 'true',
  WORKBENCH_CORS_ORIGIN: 'https://workbench.example.com',
  WORKBENCH_DEPLOYMENT_MODE: 'server',
  WORKBENCH_KEY_SECRET: 'split-deployment-test-secret-0123456789',
  WORKBENCH_REQUIRE_INVITATION_CODE: 'false',
  WORKBENCH_REQUIRE_LOGIN: 'true',
  WORKBENCH_SERVE_STATIC: 'false',
  WORKBENCH_START_WORKERS: 'false',
};

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
  const runtime = createWorkbenchApp({
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

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('server split deployment keeps the backend API-only and public health minimal', async () => {
  await withRuntime(splitServerEnv, async ({ baseUrl, runtime }) => {
    assert.equal(runtime.config.deploymentMode, 'server');
    assert.equal(runtime.config.serveStatic, false);
    assert.equal(runtime.config.startWorkers, false);

    const health = await fetchJson(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.data.status, 'ok');
    assert.equal(health.data.deploymentMode, 'server');
    assert.equal(health.data.serveStatic, false);
    assert.equal(Object.hasOwn(health.data, 'dbPath'), false);
    assert.equal(Object.hasOwn(health.data, 'outputDir'), false);

    const frontendRoot = await fetch(`${baseUrl}/`);
    const frontendIndex = await fetch(`${baseUrl}/index.html`);
    assert.equal(frontendRoot.status, 404);
    assert.equal(frontendIndex.status, 404);
  });
});

test('server split deployment sends CORS credentials only for the configured frontend origin', async () => {
  await withRuntime(splitServerEnv, async ({ baseUrl }) => {
    const allowed = await fetch(`${baseUrl}/api/health`, {
      headers: {
        Origin: 'https://workbench.example.com',
      },
    });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://workbench.example.com');
    assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');

    const disallowed = await fetch(`${baseUrl}/api/health`, {
      headers: {
        Origin: 'https://evil.example',
      },
    });
    assert.notEqual(disallowed.headers.get('access-control-allow-origin'), 'https://evil.example');
  });
});

test('server split deployment login cookie supports cross-origin frontend sessions', async () => {
  await withRuntime(splitServerEnv, async ({ baseUrl }) => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://workbench.example.com',
      },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'split-admin-password-123',
      }),
    });

    assert.equal(login.status, 200);
    assert.equal(login.headers.get('access-control-allow-origin'), 'https://workbench.example.com');
    assert.equal(login.headers.get('access-control-allow-credentials'), 'true');

    const cookie = login.headers.get('set-cookie') || '';
    assert.match(cookie, /ai_workbench_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=None/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /Domain=\.example\.com/);
  });
});
