const { createImageGenerationService } = require('../services/imageGenerationService.cjs');
const { createTaskQueueService } = require('../services/taskQueueService.cjs');
const { createVideoGenerationService } = require('../services/videoGenerationService.cjs');

function createGenerationWorker({
  assetStorage,
  autoStart = true,
  creditService = null,
  generationQueueConcurrency = 2,
  joinUrl,
  proxyRequest,
  publicAsset,
  readSecrets,
  resolveApiCredentials,
  taskQueuePollIntervalMs = 1000,
  uploadLimits = {},
}) {
  const imageGenerationService = createImageGenerationService({
    assetStorage,
    joinUrl,
    proxyRequest,
    publicAsset,
    resolveApiCredentials,
    uploadLimits,
  });
  const videoGenerationService = createVideoGenerationService({
    assetStorage,
    joinUrl,
    publicAsset,
    proxyRequest,
    resolveApiCredentials,
    uploadLimits,
  });
  const generationQueue = createTaskQueueService({
    name: 'generation',
    concurrency: generationQueueConcurrency,
    creditService,
    pollIntervalMs: taskQueuePollIntervalMs,
    handlers: {
      image: async (task, payload = {}) => {
        const secrets = await readSecrets();
        await imageGenerationService.runImageTask({
          req: payload.req || { headers: {}, publicBaseUrl: task.input?.publicBaseUrl },
          userId: task.userId,
          body: payload.body || task.input || {},
          secrets,
          task,
        });
      },
      video: async (task, payload = {}) => {
        const secrets = await readSecrets();
        await videoGenerationService.runVideoTask({
          req: payload.req || { headers: {}, publicBaseUrl: task.input?.publicBaseUrl },
          userId: task.userId,
          body: payload.body || task.input || {},
          secrets,
          task,
        });
      },
    },
  });

  if (autoStart) generationQueue.start();

  function queueGenerationTask(task, payload = {}) {
    if (autoStart) return generationQueue.enqueue(task, payload);
    return generationQueue.recordQueued(task, 'Task queued for external generation worker.');
  }

  return {
    getGenerationQueueStats: () => generationQueue.getStats(),
    imageGenerationService,
    queueGenerationTask,
    startGenerationQueue: () => generationQueue.start(),
    stopGenerationQueue: () => generationQueue.stop(),
    videoGenerationService,
  };
}

module.exports = {
  createGenerationWorker,
};
