const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-auth-service-test-'));
process.env.WORKBENCH_DATA_DIR = path.join(tempDir, 'data');
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'data', 'test.sqlite');
process.env.WORKBENCH_DEPLOYMENT_MODE = 'server';
process.env.WORKBENCH_KEY_SECRET = 'auth-service-test-secret-0123456789';
process.env.WORKBENCH_REQUIRE_LOGIN = 'true';

const {
  createUser,
  db,
} = require('./db.cjs');
const {
  SESSION_COOKIE_NAME,
  hashPassword,
  parseCookies,
} = require('./auth.cjs');
const {
  authServiceIdentityRequired,
  createAuthServiceApp,
  resolveAuthServiceHost,
  resolveAuthServicePort,
} = require('./authServiceApp.cjs');

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
  const runtime = createAuthServiceApp({ env });
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
    WORKBENCH_KEY_SECRET: 'auth-service-test-secret-0123456789',
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

test('auth-service defaults to an internal host and dedicated port', () => {
  assert.equal(resolveAuthServiceHost({}), '127.0.0.1');
  assert.equal(resolveAuthServicePort({}), 3004);
  assert.equal(resolveAuthServicePort({ WORKBENCH_AUTH_SERVICE_PORT: '4400' }), 4400);
});

test('auth-service identity is required only for admin boundaries', () => {
  assert.equal(authServiceIdentityRequired('/api/admin/users'), true);
  assert.equal(authServiceIdentityRequired('/api/admin/health'), true);
  assert.equal(authServiceIdentityRequired('/api/auth/me'), false);
  assert.equal(authServiceIdentityRequired('/api/auth/login'), false);
  assert.equal(authServiceIdentityRequired('/api/assets'), false);
  assert.equal(authServiceIdentityRequired('/api/tasks'), false);
});

test('auth-service exposes health and does not mount unrelated backend modules', async () => {
  await withRuntime(serverEnv(), async ({ baseUrl, runtime }) => {
    assert.equal(runtime.config.host, '127.0.0.1');

    const health = await fetchJson(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.data.status, 'ok');
    assert.equal(health.data.serveStatic, false);

    const assets = await fetchJson(`${baseUrl}/api/assets`);
    const tasks = await fetchJson(`${baseUrl}/api/tasks`);
    const chat = await fetchJson(`${baseUrl}/api/chat`, { method: 'POST' });
    assert.equal(assets.status, 404);
    assert.equal(tasks.status, 404);
    assert.equal(chat.status, 404);
  });
});

test('auth-service login creates a cookie and /me reads the session', async () => {
  const user = createUser({
    email: 'auth-login@example.com',
    name: 'Auth Login',
    passwordHash: hashPassword('correct-password'),
    username: 'auth-login@example.com',
  });

  await withRuntime(serverEnv(), async ({ baseUrl }) => {
    const anonymous = await fetchJson(`${baseUrl}/api/auth/me`);
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.data.authenticated, false);

    const login = await fetchJson(`${baseUrl}/api/auth/login`, {
      body: JSON.stringify({
        email: user.email,
        password: 'correct-password',
      }),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Auth Service Test Browser',
      },
      method: 'POST',
    });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.id, user.id);

    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, new RegExp(`${SESSION_COOKIE_NAME}=`));
    assert.ok(parseCookies(cookie)[SESSION_COOKIE_NAME]);

    const me = await fetchJson(`${baseUrl}/api/auth/me`, {
      headers: {
        Cookie: cookie,
      },
    });
    assert.equal(me.status, 200);
    assert.equal(me.data.authenticated, true);
    assert.equal(me.data.user.id, user.id);
  });
});

test('auth-service logout clears the current session cookie', async () => {
  const user = createUser({
    email: 'auth-logout@example.com',
    name: 'Auth Logout',
    passwordHash: hashPassword('logout-password'),
    username: 'auth-logout@example.com',
  });

  await withRuntime(serverEnv(), async ({ baseUrl }) => {
    const login = await fetchJson(`${baseUrl}/api/auth/login`, {
      body: JSON.stringify({
        email: user.email,
        password: 'logout-password',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    assert.equal(login.status, 200);

    const logout = await fetchJson(`${baseUrl}/api/auth/logout`, {
      headers: {
        Cookie: login.headers.get('set-cookie'),
      },
      method: 'POST',
    });
    assert.equal(logout.status, 200);
    assert.equal(logout.data.ok, true);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  });
});

test('auth-service admin routes require gateway identity and admin role', async () => {
  const user = createUser({
    email: 'auth-user@example.com',
    name: 'Auth User',
    passwordHash: 'test',
    role: 'user',
    username: 'auth-user@example.com',
  });
  const admin = createUser({
    email: 'auth-admin@example.com',
    name: 'Auth Admin',
    passwordHash: 'test',
    role: 'admin',
    username: 'auth-admin@example.com',
  });

  await withRuntime(serverEnv({
    WORKBENCH_INTERNAL_SERVICE_TOKEN: 'internal-token',
  }), async ({ baseUrl }) => {
    const missingToken = await fetchJson(`${baseUrl}/api/admin/users`, {
      headers: internalHeaders(admin),
    });
    assert.equal(missingToken.status, 403);

    const blockedUser = await fetchJson(`${baseUrl}/api/admin/users`, {
      headers: internalHeaders(user, {
        'x-workbench-internal-token': 'internal-token',
      }),
    });
    assert.equal(blockedUser.status, 403);

    const acceptedAdmin = await fetchJson(`${baseUrl}/api/admin/users`, {
      headers: internalHeaders(admin, {
        'x-workbench-internal-token': 'internal-token',
      }),
    });
    assert.equal(acceptedAdmin.status, 200);
    assert.equal(acceptedAdmin.data.users.some((item) => item.id === admin.id), true);
  });
});
