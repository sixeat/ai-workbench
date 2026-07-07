const { sendSafeError } = require('../httpErrors.cjs');
const { createGenerationTaskRequestService } = require('../services/generationTaskRequestService.cjs');
const { createGenerationWorker } = require('../workers/generationWorker.cjs');

function registerGenerationRoutes(app, context) {
  const {
    assetStorage,
    getRequestUserId,
    joinUrl,
    proxyRequest,
    publicAsset,
    readSecrets,
    resolveApiCredentials,
    allowSyncGeneration = false,
    autoStartQueue = true,
    creditService,
    generationQueueConcurrency = 2,
    taskQueuePollIntervalMs = 1000,
    uploadLimits = {},
  } = context;
  const generationWorker = createGenerationWorker({
    assetStorage,
    autoStart: autoStartQueue,
    creditService,
    generationQueueConcurrency,
    joinUrl,
    proxyRequest,
    publicAsset,
    readSecrets,
    resolveApiCredentials,
    taskQueuePollIntervalMs,
    uploadLimits,
  });
  const { imageGenerationService, videoGenerationService } = generationWorker;
  const generationTaskRequestService = createGenerationTaskRequestService({
    creditService,
    generationWorker,
    getRequestUserId,
    imageGenerationService,
    readSecrets,
    videoGenerationService,
  });

  app.post('/api/images', async (req, res) => {
    try {
      const response = generationTaskRequestService.enqueueImageTask(req);
      res.status(response.status).json(response.data);
    } catch (error) {
      console.error('/api/images error:', error.message);
      sendSafeError(res, error, { message: 'Image generation failed.' });
    }
  });

  if (allowSyncGeneration) {
    app.post('/api/images/sync', async (req, res) => {
      try {
        const result = await generationTaskRequestService.runSyncImageTask(req);
        res.status(result.status).json(result.data);
      } catch (error) {
        console.error('/api/images/sync error:', error.message);
        sendSafeError(res, error, { message: 'Image generation failed.' });
      }
    });
  }

  app.post('/api/videos', async (req, res) => {
    try {
      const response = generationTaskRequestService.enqueueVideoTask(req);
      res.status(response.status).json(response.data);
    } catch (error) {
      console.error('/api/videos error:', error.message);
      sendSafeError(res, error, { message: 'Video generation failed.' });
    }
  });

  if (allowSyncGeneration) {
    app.post('/api/videos/sync', async (req, res) => {
      try {
        const result = await generationTaskRequestService.runSyncVideoTask(req);
        res.status(result.status).json(result.data);
      } catch (error) {
        console.error('/api/videos/sync error:', error.message);
        sendSafeError(res, error, { message: 'Video generation failed.' });
      }
    });
  }

  app.get('/api/videos/:taskId', async (req, res) => {
    try {
      const result = await generationTaskRequestService.getVideoTask(req);
      res.status(result.status).json(result.data);
    } catch (error) {
      console.error('/api/videos/:taskId error:', error.message);
      sendSafeError(res, error, { message: 'Video task lookup failed.' });
    }
  });

  return {
    getGenerationQueueStats: generationWorker.getGenerationQueueStats,
    retryGenerationTask: generationTaskRequestService.retryGenerationTask,
    stopGenerationQueue: generationWorker.stopGenerationQueue,
  };
}

module.exports = {
  registerGenerationRoutes,
};
