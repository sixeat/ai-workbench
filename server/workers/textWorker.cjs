const { createTaskQueueService } = require('../services/taskQueueService.cjs');
const { createTextGenerationService } = require('../services/textGenerationService.cjs');

function createTextWorker({
  autoStart = true,
  creditService = null,
  joinUrl,
  proxyRequest,
  readSecrets,
  resolveApiCredentials,
  resolveDirectCredentials,
  taskQueuePollIntervalMs = 1000,
  textQueueConcurrency = 2,
}) {
  const textGenerationService = createTextGenerationService({
    joinUrl,
    proxyRequest,
    resolveApiCredentials,
    resolveDirectCredentials,
  });
  const textQueue = createTaskQueueService({
    name: 'text',
    concurrency: textQueueConcurrency,
    creditService,
    pollIntervalMs: taskQueuePollIntervalMs,
    handlers: {
      text: async (task, payload = {}) => {
        const secrets = await readSecrets();
        await textGenerationService.runTextTask({
          userId: task.userId,
          body: payload.body || task.input || {},
          secrets,
          task,
        });
      },
    },
  });

  if (autoStart) textQueue.start();

  function queueTextTask(task, payload = {}) {
    if (autoStart) return textQueue.enqueue(task, payload);
    return textQueue.recordQueued(task, 'Task queued for external text worker.');
  }

  return {
    getTextQueueStats: () => textQueue.getStats(),
    queueTextTask,
    startTextQueue: () => textQueue.start(),
    stopTextQueue: () => textQueue.stop(),
    textGenerationService,
  };
}

module.exports = {
  createTextWorker,
};
