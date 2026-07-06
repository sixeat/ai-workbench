const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createTextTaskRequestService,
  textRequestBody,
  textRetryBody,
} = require('./services/textTaskRequestService.cjs');

function createService() {
  const calls = {
    createdTasks: [],
    queuedTasks: [],
    runTextTasks: [],
    taskLogs: [],
  };

  const textGenerationService = {
    createTextTask(userId, body, status) {
      calls.createdTasks.push({ body, status, userId });
      return {
        id: `task-${calls.createdTasks.length}`,
        input: body,
        providerId: body.providerId || 'openai-compatible',
        status,
        userId,
      };
    },
    async runTextTask(input) {
      calls.runTextTasks.push(input);
      return {
        data: { ok: true },
        status: 209,
      };
    },
  };

  const textWorker = {
    queueTextTask(task, payload) {
      calls.queuedTasks.push({ payload, task });
    },
  };

  const taskRepository = {
    addTaskLog(taskId, log) {
      calls.taskLogs.push({ log, taskId });
    },
  };

  const service = createTextTaskRequestService({
    getRequestUserId: (req) => req.authUser?.id || 'local-user',
    readSecrets: async () => ({ apiKey: 'secret-key' }),
    taskRepository,
    textGenerationService,
    textWorker,
  });

  return { calls, service };
}

test('text request body defaults Claude provider without changing chat provider', () => {
  assert.deepEqual(textRequestBody({ model: 'gpt-demo' }, 'chat'), {
    model: 'gpt-demo',
    requestKind: 'chat',
  });
  assert.deepEqual(textRequestBody({ model: 'claude-demo' }, 'claude'), {
    model: 'claude-demo',
    providerId: 'anthropic',
    requestKind: 'claude',
  });
});

test('text task request service enqueues chat tasks for the request user', () => {
  const { calls, service } = createService();

  const response = service.enqueueTextTask({
    authUser: { id: 'user-1' },
    body: { messages: [{ role: 'user', content: 'hello' }], model: 'demo' },
  }, 'chat');

  assert.equal(response.status, 202);
  assert.equal(response.data.taskId, 'task-1');
  assert.equal(calls.createdTasks[0].userId, 'user-1');
  assert.equal(calls.createdTasks[0].status, 'queued');
  assert.equal(calls.createdTasks[0].body.requestKind, 'chat');
  assert.deepEqual(calls.queuedTasks[0].payload, {
    body: calls.createdTasks[0].body,
  });
});

test('text task request service enqueues Claude tasks with the Anthropic provider default', () => {
  const { calls, service } = createService();

  service.enqueueTextTask({
    body: { messages: [{ role: 'user', content: 'hello' }], model: 'claude-demo' },
  }, 'claude');

  assert.equal(calls.createdTasks[0].body.requestKind, 'claude');
  assert.equal(calls.createdTasks[0].body.providerId, 'anthropic');
});

test('text task request service runs sync text tasks with secrets and normalized body', async () => {
  const { calls, service } = createService();

  const response = await service.runSyncTextTask({
    authUser: { id: 'user-sync' },
    body: { messages: [{ role: 'user', content: 'hello' }] },
  }, 'claude');

  assert.equal(response.status, 209);
  assert.equal(calls.runTextTasks[0].userId, 'user-sync');
  assert.deepEqual(calls.runTextTasks[0].secrets, { apiKey: 'secret-key' });
  assert.equal(calls.runTextTasks[0].body.requestKind, 'claude');
  assert.equal(calls.runTextTasks[0].body.providerId, 'anthropic');
});

test('text retry body preserves safe retry fields without raw keys', () => {
  const body = textRetryBody({
    id: 'failed-1',
    input: {
      apiKey: 'raw-key',
      apiKeyId: 'saved-key',
      baseUrl: 'https://api.example.com',
      messages: [{ role: 'user', content: 'hello' }],
      model: 'demo',
      requestKind: 'chat',
      upstreamTaskIds: ['upstream-1'],
    },
    providerId: 'demo-provider',
  });

  assert.equal(body.apiKey, undefined);
  assert.equal(body.apiKeyId, 'saved-key');
  assert.equal(body.providerId, 'demo-provider');
  assert.equal(body.retryOf, 'failed-1');
  assert.deepEqual(body.upstreamTaskIds, ['upstream-1']);
});

test('text task request service retries failed text tasks and writes relationship logs', async () => {
  const { calls, service } = createService();

  const response = await service.retryTextTask({
    task: {
      id: 'failed-1',
      input: {
        apiKeyId: 'saved-key',
        messages: [{ role: 'user', content: 'hello' }],
        model: 'demo',
        requestKind: 'chat',
      },
      nodeType: 'text',
      providerId: 'demo-provider',
    },
    userId: 'user-1',
  });

  assert.equal(response.status, 202);
  assert.equal(response.data.taskId, 'task-1');
  assert.equal(calls.createdTasks[0].body.retryOf, 'failed-1');
  assert.equal(calls.createdTasks[0].body.providerId, 'demo-provider');
  assert.equal(calls.queuedTasks.length, 1);
  assert.deepEqual(calls.taskLogs.map((item) => item.log.event), [
    'retry_created',
    'created_from_retry',
  ]);
  assert.equal(calls.taskLogs[1].log.data.sourceTaskId, 'failed-1');
});
