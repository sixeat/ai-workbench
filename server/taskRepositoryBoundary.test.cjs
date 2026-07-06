const assert = require('node:assert/strict');
const test = require('node:test');

const { createImageGenerationService } = require('./services/imageGenerationService.cjs');
const { createTaskQueueService } = require('./services/taskQueueService.cjs');
const { createTaskService } = require('./services/taskService.cjs');
const { createVideoGenerationService } = require('./services/videoGenerationService.cjs');

function createMemoryTaskRepository(initialTasks = []) {
  const tasks = new Map(initialTasks.map((task) => [task.id, { ...task }]));
  const logs = new Map(initialTasks.map((task) => [task.id, []]));

  return {
    addTaskLog(taskId, log) {
      logs.set(taskId, [...(logs.get(taskId) || []), { ...log, taskId }]);
    },
    claimQueuedTask(taskId) {
      const task = tasks.get(taskId);
      if (!task || task.status !== 'queued') return null;
      const claimed = { ...task, status: 'running' };
      tasks.set(taskId, claimed);
      return claimed;
    },
    countQueuedTasks(nodeTypes = []) {
      return [...tasks.values()].filter((task) =>
        task.status === 'queued' && (nodeTypes.length === 0 || nodeTypes.includes(task.nodeType))
      ).length;
    },
    countTasks(userId) {
      return [...tasks.values()].filter((task) => task.userId === userId).length;
    },
    createTask(task) {
      const stored = { ...task };
      tasks.set(stored.id, stored);
      logs.set(stored.id, []);
      return stored;
    },
    getTask(taskId) {
      return tasks.get(taskId) || null;
    },
    getTaskForUser(taskId, userId) {
      const task = tasks.get(taskId);
      return task?.userId === userId ? task : null;
    },
    listQueuedTasks(limit, nodeTypes = []) {
      return [...tasks.values()]
        .filter((task) => task.status === 'queued' && (nodeTypes.length === 0 || nodeTypes.includes(task.nodeType)))
        .slice(0, limit);
    },
    listTaskAssets() {
      return [];
    },
    listTaskLogs(taskId) {
      return logs.get(taskId) || [];
    },
    listTasks(userId, query = {}) {
      return [...tasks.values()]
        .filter((task) => task.userId === userId)
        .slice(query.offset || 0, (query.offset || 0) + (query.limit || 100));
    },
    markRunningTasksInterrupted() {
      return 0;
    },
    updateTask(taskId, patch) {
      const task = tasks.get(taskId);
      if (!task) return null;
      const updated = { ...task, ...patch };
      tasks.set(taskId, updated);
      return updated;
    },
  };
}

test('task service can use an injected task repository', () => {
  const taskRepository = createMemoryTaskRepository([{
    id: 'task-1',
    userId: 'user-1',
    nodeType: 'image',
    providerId: 'openai-compatible',
    model: 'gpt-image-test',
    status: 'queued',
    input: { prompt: 'cancel from memory repository' },
  }]);
  const service = createTaskService({
    publicAsset: (asset) => asset,
    taskRepository,
  });

  const cancelled = service.cancelTask('task-1', 'user-1');

  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.logs.some((log) => log.event === 'cancel_requested'), true);
  assert.equal(service.listUserTasks('user-1').total, 1);
});

test('task queue can use an injected task repository', async () => {
  const taskRepository = createMemoryTaskRepository([{
    id: 'task-2',
    userId: 'user-1',
    nodeType: 'text',
    providerId: 'openai-compatible',
    model: 'gpt-test',
    status: 'queued',
    input: { prompt: 'run from memory repository' },
  }]);
  const queue = createTaskQueueService({
    handlers: {
      text: async (task) => {
        taskRepository.updateTask(task.id, {
          status: 'succeeded',
          output: { text: 'ok' },
        });
      },
    },
    taskRepository,
  });

  queue.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await queue.stop();

  const task = taskRepository.getTask('task-2');
  const logs = taskRepository.listTaskLogs('task-2');
  assert.equal(task.status, 'succeeded');
  assert.equal(logs.some((log) => log.event === 'started'), true);
  assert.equal(logs.some((log) => log.event === 'succeeded'), true);
});

test('image generation service can create and fail tasks through an injected repository', async () => {
  const taskRepository = createMemoryTaskRepository();
  const service = createImageGenerationService({
    assetStorage: null,
    joinUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    proxyRequest: async () => {
      throw new Error('proxy should not be called without credentials');
    },
    publicAsset: (asset) => asset,
    resolveApiCredentials: async () => ({
      baseUrl: '',
      apiKey: '',
      providerId: 'openai-compatible',
    }),
    taskRepository,
  });

  const result = await service.generateImage({
    req: { headers: {}, publicBaseUrl: 'https://api.example.com' },
    userId: 'user-1',
    body: {
      model: 'gpt-image-test',
      prompt: 'image through injected repository',
    },
    secrets: {},
  });

  const task = taskRepository.listTasks('user-1')[0];
  assert.equal(result.status, 400);
  assert.equal(task.status, 'failed');
  assert.equal(task.error.message, 'Base URL is required');
});

test('video generation service can create and fail tasks through an injected repository', async () => {
  const taskRepository = createMemoryTaskRepository();
  const service = createVideoGenerationService({
    assetStorage: null,
    joinUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    publicAsset: (asset) => asset,
    proxyRequest: async () => {
      throw new Error('proxy should not be called without credentials');
    },
    resolveApiCredentials: async () => ({
      baseUrl: 'https://ark.cn-beijing.volces.com',
      apiKey: '',
      providerId: 'seedance',
    }),
    taskRepository,
  });

  const result = await service.generateVideo({
    req: { headers: {}, publicBaseUrl: 'https://api.example.com' },
    userId: 'user-1',
    body: {
      providerId: 'seedance',
      model: 'seedance-test',
      content: [{ type: 'text', text: 'video through injected repository' }],
    },
    secrets: {},
  });

  const task = taskRepository.listTasks('user-1')[0];
  assert.equal(result.status, 400);
  assert.equal(task.status, 'failed');
  assert.equal(task.error.message, 'API key is required');
});
