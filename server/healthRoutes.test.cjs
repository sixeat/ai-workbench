const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAdminHealth,
  buildPublicHealth,
  registerHealthRoutes,
} = require('./routes/healthRoutes.cjs');

function createFakeApp() {
  const routes = [];
  return {
    routes,
    get(pathname, handler) {
      routes.push({ method: 'GET', pathname, handler });
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

function route(app, pathname) {
  return app.routes.find((item) => item.method === 'GET' && item.pathname === pathname);
}

function createHealthContext(overrides = {}) {
  return {
    countAllAssets: () => 7,
    countAllTasks: () => 11,
    countAllUsers: () => 3,
    countAssets: () => 2,
    countEnabledUsers: () => 2,
    countTasks: () => 5,
    dbPath: '/srv/private/data.sqlite',
    defaultUserId: 'local-user',
    deploymentMode: 'server',
    getQueueHealth: () => [
      {
        name: 'text',
        nodeTypes: ['text'],
        concurrency: 2,
        activeCount: 1,
        queuedCount: 4,
        scheduled: false,
        stopped: false,
      },
    ],
    host: '0.0.0.0',
    now: () => new Date('2026-07-05T00:00:00.000Z'),
    outputDir: '/srv/private/outputs',
    requireAdmin: () => true,
    serveStatic: false,
    ...overrides,
  };
}

test('public health stays minimal for load balancers', () => {
  const health = buildPublicHealth(createHealthContext());

  assert.deepEqual(Object.keys(health).sort(), [
    'deploymentMode',
    'serveStatic',
    'status',
    'time',
  ]);
  assert.equal(health.status, 'ok');
  assert.equal(health.time, '2026-07-05T00:00:00.000Z');
  assert.equal(health.outputDir, undefined);
  assert.equal(health.dbPath, undefined);
  assert.equal(health.defaultUserId, undefined);
});

test('admin health includes detailed server state behind admin authorization', () => {
  const health = buildAdminHealth(createHealthContext());

  assert.equal(health.status, 'ok');
  assert.equal(health.host, '0.0.0.0');
  assert.equal(health.outputDir, '/srv/private/outputs');
  assert.equal(health.dbPath, '/srv/private/data.sqlite');
  assert.equal(health.defaultUserId, 'local-user');
  assert.equal(health.assets, 7);
  assert.equal(health.tasks, 11);
  assert.equal(health.users, 3);
  assert.equal(health.enabledUsers, 2);
  assert.equal(health.localUserAssets, 2);
  assert.equal(health.localUserTasks, 5);
  assert.deepEqual(health.queues, [
    {
      name: 'text',
      nodeTypes: ['text'],
      concurrency: 2,
      activeCount: 1,
      queuedCount: 4,
      scheduled: false,
      stopped: false,
    },
  ]);
});

test('health routes expose minimal public status and protect admin details', () => {
  const app = createFakeApp();
  registerHealthRoutes(app, createHealthContext({
    requireAdmin: (_req, res) => {
      res.status(403).json({ error: 'Admin token is required.' });
      return false;
    },
  }));

  const publicRes = createMockRes();
  route(app, '/api/health').handler({}, publicRes);
  assert.equal(publicRes.statusCode, 200);
  assert.equal(publicRes.body.status, 'ok');
  assert.equal(publicRes.body.outputDir, undefined);
  assert.equal(publicRes.body.dbPath, undefined);
  assert.equal(publicRes.body.queues, undefined);

  const adminRes = createMockRes();
  route(app, '/api/admin/health').handler({}, adminRes);
  assert.equal(adminRes.statusCode, 403);
  assert.deepEqual(adminRes.body, { error: 'Admin token is required.' });
});
