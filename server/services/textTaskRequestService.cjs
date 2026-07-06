const { taskRepository: defaultTaskRepository } = require('../repositories/taskRepository.cjs');
const { taskRetryLogData } = require('./taskRelationshipService.cjs');

function pick(input, keys) {
  const result = {};
  for (const key of keys) {
    if (input?.[key] !== undefined && input[key] !== null && input[key] !== '') {
      result[key] = input[key];
    }
  }
  return result;
}

function textRequestBody(input = {}, requestKind = 'chat') {
  return {
    ...input,
    requestKind,
    ...(requestKind === 'claude' ? { providerId: input.providerId || 'anthropic' } : {}),
  };
}

function textRetryBody(task) {
  return {
    ...pick(task.input || {}, [
      'apiKeyId',
      'baseUrl',
      'requestKind',
      'model',
      'messages',
      'system',
      'temperature',
      'max_tokens',
      'maxTokens',
      'stream',
      'upstreamTaskIds',
    ]),
    providerId: task.providerId || task.input?.providerId || 'openai-compatible',
    retryOf: task.id,
  };
}

function createTextTaskRequestService({
  getRequestUserId = (req) => req.authUser?.id || 'local-user',
  readSecrets,
  taskRepository = defaultTaskRepository,
  textGenerationService,
  textWorker,
}) {
  function enqueueTextTask(req, requestKind) {
    const userId = getRequestUserId(req);
    const body = textRequestBody(req.body || {}, requestKind);
    const task = textGenerationService.createTextTask(userId, body, 'queued');
    textWorker.queueTextTask(task, { body });
    return {
      data: {
        status: task.status,
        task,
        taskId: task.id,
      },
      status: 202,
    };
  }

  async function runSyncTextTask(req, requestKind) {
    const secrets = await readSecrets();
    return textGenerationService.runTextTask({
      body: textRequestBody(req.body || {}, requestKind),
      secrets,
      userId: getRequestUserId(req),
    });
  }

  async function retryTextTask({ userId, task }) {
    const body = textRetryBody(task);
    const nextTask = textGenerationService.createTextTask(userId, body, 'queued');
    const logData = taskRetryLogData(task, nextTask, 'text');

    taskRepository.addTaskLog(task.id, {
      data: logData,
      event: 'retry_created',
      message: 'A retry task was created from this failed text task.',
    });
    taskRepository.addTaskLog(nextTask.id, {
      data: {
        ...logData,
        sourceTaskId: task.id,
      },
      event: 'created_from_retry',
      message: 'This text task was created by retrying a failed task.',
    });
    textWorker.queueTextTask(nextTask, { body });

    return {
      data: {
        status: nextTask.status,
        task: nextTask,
        taskId: nextTask.id,
      },
      status: 202,
    };
  }

  return {
    enqueueTextTask,
    retryTextTask,
    runSyncTextTask,
  };
}

module.exports = {
  createTextTaskRequestService,
  textRequestBody,
  textRetryBody,
};
