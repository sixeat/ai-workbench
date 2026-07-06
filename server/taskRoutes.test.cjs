const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-task-routes-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const {
  addTaskLog,
  createTask,
  createUser,
  db,
  getTask,
} = require('./db.cjs');
const { registerTaskRoutes } = require('./routes/taskRoutes.cjs');
const { createTaskService } = require('./services/taskService.cjs');

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

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('retry route delegates failed generation tasks to the retry handler', async () => {
  const user = createUser({
    email: 'retry-route@example.com',
    username: 'retry-route@example.com',
    name: 'Retry Route',
    passwordHash: 'test',
  });
  const failed = createTask({
    userId: user.id,
    nodeType: 'image',
    providerId: 'openai-compatible',
    model: 'gpt-image-test',
    status: 'failed',
    input: { prompt: 'retry me' },
  });
  const taskService = createTaskService({
    publicAsset: (asset) => asset,
  });
  const calls = [];
  const app = createFakeApp();
  registerTaskRoutes(app, {
    getRequestUserId: () => user.id,
    taskService,
    retryGenerationTask: async ({ task }) => {
      calls.push(task.id);
      return {
        status: 202,
        data: { task: { id: 'new-task', retryOf: task.id } },
      };
    },
  });

  const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/tasks/:taskId/retry');
  const res = createMockRes();
  await route.handler({ params: { taskId: failed.id } }, res);

  assert.equal(res.statusCode, 202);
  assert.deepEqual(calls, [failed.id]);
  assert.equal(res.body.task.retryOf, failed.id);
});

test('task list route returns paginated task history for the current user', () => {
  const user = createUser({
    email: 'task-list-page@example.com',
    username: 'task-list-page@example.com',
    name: 'Task List Page',
    passwordHash: 'test',
  });
  createTask({
    id: 'task-list-page-old',
    userId: user.id,
    nodeType: 'text',
    status: 'succeeded',
    input: { prompt: 'old' },
    createdAt: '2026-01-01T00:00:01.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
  });
  const newTask = createTask({
    id: 'task-list-page-new',
    userId: user.id,
    nodeType: 'image',
    status: 'failed',
    input: { prompt: 'new' },
    createdAt: '2026-01-01T00:00:02.000Z',
    updatedAt: '2026-01-01T00:00:02.000Z',
  });
  addTaskLog(newTask.id, {
    level: 'error',
    event: 'failed',
    message: 'route test failure log',
  });
  const taskService = createTaskService({
    publicAsset: (asset) => asset,
  });
  const app = createFakeApp();
  registerTaskRoutes(app, {
    getRequestUserId: () => user.id,
    taskService,
    retryGenerationTask: async () => {
      throw new Error('should not be called');
    },
  });

  const route = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/tasks');
  const res = createMockRes();
  route.handler({ query: { limit: 1, offset: 1 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 2);
  assert.equal(res.body.total, 2);
  assert.equal(res.body.limit, 1);
  assert.equal(res.body.offset, 1);
  assert.deepEqual(res.body.tasks.map((task) => task.id), ['task-list-page-old']);
  assert.equal(res.body.tasks[0].logs, undefined);

  const detailedListRes = createMockRes();
  route.handler({ query: { includeLogs: 'true' } }, detailedListRes);
  assert.equal(detailedListRes.statusCode, 200);
  assert.equal(detailedListRes.body.tasks[0].id, 'task-list-page-new');
  assert.equal(detailedListRes.body.tasks[0].logs.length, 1);

  const detailRoute = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/tasks/:taskId');
  const detailRes = createMockRes();
  detailRoute.handler({ params: { taskId: newTask.id } }, detailRes);
  assert.equal(detailRes.statusCode, 200);
  assert.equal(detailRes.body.task.logs.length, 1);
});

test('retry route rejects non-failed tasks instead of creating queued placeholders', async () => {
  const user = createUser({
    email: 'retry-running@example.com',
    username: 'retry-running@example.com',
    name: 'Retry Running',
    passwordHash: 'test',
  });
  const running = createTask({
    userId: user.id,
    nodeType: 'image',
    status: 'running',
    input: { prompt: 'still running' },
  });
  const taskService = createTaskService({
    publicAsset: (asset) => asset,
  });
  const app = createFakeApp();
  registerTaskRoutes(app, {
    getRequestUserId: () => user.id,
    taskService,
    retryGenerationTask: async () => {
      throw new Error('should not be called');
    },
  });

  const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/tasks/:taskId/retry');
  const res = createMockRes();
  await route.handler({ params: { taskId: running.id } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Only failed tasks can be retried.');
});

test('task routes reject cancel and retry for tasks owned by another user', async () => {
  const owner = createUser({
    email: 'task-route-owner@example.com',
    username: 'task-route-owner@example.com',
    name: 'Task Route Owner',
    passwordHash: 'test',
  });
  const other = createUser({
    email: 'task-route-other@example.com',
    username: 'task-route-other@example.com',
    name: 'Task Route Other',
    passwordHash: 'test',
  });
  const queued = createTask({
    userId: owner.id,
    nodeType: 'image',
    status: 'queued',
    input: { prompt: 'private queued task' },
  });
  const failed = createTask({
    userId: owner.id,
    nodeType: 'video',
    status: 'failed',
    input: { prompt: 'private failed task' },
  });
  const taskService = createTaskService({
    publicAsset: (asset) => asset,
  });
  const retryCalls = [];
  const app = createFakeApp();
  registerTaskRoutes(app, {
    getRequestUserId: () => other.id,
    taskService,
    retryGenerationTask: async ({ task }) => {
      retryCalls.push(task.id);
      return {
        status: 202,
        data: { task: { id: 'should-not-exist' } },
      };
    },
  });

  const cancelRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/tasks/:taskId/cancel');
  const retryRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/tasks/:taskId/retry');

  const cancelRes = createMockRes();
  cancelRoute.handler({ params: { taskId: queued.id } }, cancelRes);

  assert.equal(cancelRes.statusCode, 404);
  assert.equal(cancelRes.body.error, 'Task not found');
  assert.equal(getTask(queued.id).status, 'queued');

  const retryRes = createMockRes();
  await retryRoute.handler({ params: { taskId: failed.id } }, retryRes);

  assert.equal(retryRes.statusCode, 404);
  assert.equal(retryRes.body.error, 'Task not found');
  assert.deepEqual(retryCalls, []);
});
