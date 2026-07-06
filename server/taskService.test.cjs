const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-task-service-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const {
  addTaskLog,
  createTask,
  createUser,
  db,
  insertAsset,
  linkTaskAsset,
} = require('./db.cjs');
const { createTaskService } = require('./services/taskService.cjs');

const taskService = createTaskService({
  publicAsset: (asset) => ({
    id: asset.id,
    type: asset.type,
    url: asset.url,
  }),
});

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('task service lists public tasks with linked assets', () => {
  const user = createUser({
    email: 'task-owner@example.com',
    username: 'task-owner@example.com',
    name: 'Task Owner',
    passwordHash: 'test',
  });
  const other = createUser({
    email: 'task-other@example.com',
    username: 'task-other@example.com',
    name: 'Task Other',
    passwordHash: 'test',
  });

  const task = createTask({
    userId: user.id,
    nodeType: 'image',
    providerId: 'openai-compatible',
    model: 'gpt-image-test',
    status: 'succeeded',
    input: { prompt: 'visible' },
  });
  addTaskLog(task.id, {
    level: 'info',
    event: 'succeeded',
    message: 'visible task completed',
  });
  const asset = insertAsset({
    id: 'task-service-asset',
    userId: user.id,
    type: 'image',
    url: '/api/assets/task-service-asset',
    fileName: 'asset.png',
  });
  linkTaskAsset(task.id, asset.id);

  const result = taskService.listUserTasks(user.id);
  assert.equal(result.count, 1);
  assert.equal(result.tasks[0].id, task.id);
  assert.deepEqual(result.tasks[0].assets, [{
    id: asset.id,
    type: 'image',
    url: asset.url,
  }]);
  assert.equal(result.tasks[0].logs, undefined);

  const detailedList = taskService.listUserTasks(user.id, { includeLogs: true });
  assert.equal(detailedList.tasks[0].logs.length, 1);

  const detail = taskService.getUserTask(task.id, user.id);
  assert.equal(detail.logs.length, 1);

  const otherTasks = taskService.listUserTasks(other.id);
  assert.equal(otherTasks.count, 0);
  assert.equal(otherTasks.total, 0);
  assert.deepEqual(otherTasks.tasks, []);
});

test('task service hides assets that do not belong to the task owner', () => {
  const owner = createUser({
    email: 'task-asset-owner@example.com',
    username: 'task-asset-owner@example.com',
    name: 'Task Asset Owner',
    passwordHash: 'test',
  });
  const other = createUser({
    email: 'task-asset-other@example.com',
    username: 'task-asset-other@example.com',
    name: 'Task Asset Other',
    passwordHash: 'test',
  });
  const task = createTask({
    userId: owner.id,
    nodeType: 'image',
    providerId: 'openai-compatible',
    model: 'gpt-image-test',
    status: 'succeeded',
    input: { prompt: 'owner task' },
  });
  const ownerAsset = insertAsset({
    id: 'task-owner-visible-asset',
    userId: owner.id,
    type: 'image',
    url: '/api/assets/task-owner-visible-asset',
    fileName: 'owner.png',
  });
  const otherAsset = insertAsset({
    id: 'task-other-hidden-asset',
    userId: other.id,
    type: 'image',
    url: '/api/assets/task-other-hidden-asset',
    fileName: 'other.png',
  });

  linkTaskAsset(task.id, ownerAsset.id);
  linkTaskAsset(task.id, otherAsset.id);

  const detail = taskService.getUserTask(task.id, owner.id);
  assert.deepEqual(detail.assets, [{
    id: ownerAsset.id,
    type: 'image',
    url: ownerAsset.url,
  }]);

  const list = taskService.listUserTasks(owner.id);
  assert.deepEqual(list.tasks[0].assets.map((asset) => asset.id), [ownerAsset.id]);
});

test('task service paginates user task history', () => {
  const user = createUser({
    email: 'task-page-owner@example.com',
    username: 'task-page-owner@example.com',
    name: 'Task Page Owner',
    passwordHash: 'test',
  });
  createTask({
    id: 'task-page-old',
    userId: user.id,
    nodeType: 'text',
    status: 'succeeded',
    input: { prompt: 'old' },
    createdAt: '2026-01-01T00:00:01.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
  });
  createTask({
    id: 'task-page-middle',
    userId: user.id,
    nodeType: 'image',
    status: 'succeeded',
    input: { prompt: 'middle' },
    createdAt: '2026-01-01T00:00:02.000Z',
    updatedAt: '2026-01-01T00:00:02.000Z',
  });
  createTask({
    id: 'task-page-new',
    userId: user.id,
    nodeType: 'video',
    status: 'failed',
    input: { prompt: 'new' },
    createdAt: '2026-01-01T00:00:03.000Z',
    updatedAt: '2026-01-01T00:00:03.000Z',
  });

  const firstPage = taskService.listUserTasks(user.id, { limit: 2, offset: 0 });
  const secondPage = taskService.listUserTasks(user.id, { limit: 2, offset: 2 });

  assert.equal(firstPage.count, 3);
  assert.equal(firstPage.total, 3);
  assert.equal(firstPage.limit, 2);
  assert.equal(firstPage.offset, 0);
  assert.deepEqual(firstPage.tasks.map((task) => task.id), ['task-page-new', 'task-page-middle']);
  assert.deepEqual(secondPage.tasks.map((task) => task.id), ['task-page-old']);
});

test('task service cancels queued tasks and soft-cancels running tasks', () => {
  const user = createUser({
    email: 'cancel-owner@example.com',
    username: 'cancel-owner@example.com',
    name: 'Cancel Owner',
    passwordHash: 'test',
  });

  const queued = createTask({
    userId: user.id,
    nodeType: 'image',
    status: 'queued',
    input: { prompt: 'queued' },
  });
  const running = createTask({
    userId: user.id,
    nodeType: 'image',
    status: 'running',
    input: { prompt: 'running' },
  });

  assert.equal(taskService.cancelTask(queued.id, user.id).status, 'cancelled');
  const cancelledRunning = taskService.cancelTask(running.id, user.id);
  assert.equal(cancelledRunning.status, 'cancelled');
  assert.equal(cancelledRunning.error.message, 'Cancellation requested while task was running.');
  assert.equal(cancelledRunning.logs.some((log) => log.event === 'cancel_requested'), true);
  assert.equal(taskService.cancelTask(queued.id, 'missing-user'), null);
});

test('task service does not create fake queued retry tasks', () => {
  assert.equal(typeof taskService.retryTask, 'undefined');
});
