const { addTaskLog } = require('../db.cjs');
const { createImageGenerationService } = require('../services/imageGenerationService.cjs');
const { createVideoGenerationService } = require('../services/videoGenerationService.cjs');
const { createTaskQueueService } = require('../services/taskQueueService.cjs');
const { sendSafeError } = require('../httpErrors.cjs');
const { getPublicBaseUrl } = require('../services/mediaUrlService.cjs');
const { taskRetryLogData } = require('../services/taskRelationshipService.cjs');

function pick(input, keys) {
  const result = {};
  for (const key of keys) {
    if (input?.[key] !== undefined && input[key] !== null && input[key] !== '') {
      result[key] = input[key];
    }
  }
  return result;
}

function imageRetryBody(task) {
  return {
    ...pick(task.input || {}, [
      'apiKeyId',
      'model',
      'mode',
      'prompt',
      'size',
      'quality',
      'n',
      'response_format',
      'negative_prompt',
      'reference_image',
      'reference_images',
      'reference_strength',
      'seed',
      'watermark',
      'promptExtend',
      'prompt_extend',
      'enableSequential',
      'enable_sequential',
      'thinkingMode',
      'thinking_mode',
      'upstreamTaskIds',
    ]),
    providerId: task.providerId || task.input?.providerId || 'openai-compatible',
    retryOf: task.id,
  };
}

function videoRetryBody(task) {
  return {
    ...pick(task.input || {}, [
      'apiKeyId',
      'model',
      'mode',
      'text',
      'content',
      'prompt',
      'ratio',
      'aspectRatio',
      'resolution',
      'duration',
      'images',
      'referenceImages',
      'reference_images',
      'referenceVideos',
      'reference_videos',
      'referenceAudios',
      'reference_audios',
      'referenceVideoUrl',
      'referenceAudioUrl',
      'generateAudio',
      'generate_audio',
      'watermark',
      'promptExtend',
      'prompt_extend',
      'seed',
      'negativePrompt',
      'negative_prompt',
      'upstreamTaskIds',
    ]),
    providerId: task.providerId || task.input?.providerId || 'seedance',
    retryOf: task.id,
  };
}

function retryLogData(sourceTask, nextTask) {
  return taskRetryLogData(sourceTask, nextTask, 'generation');
}

function addRetryLogs(sourceTask, nextTask) {
  const logData = retryLogData(sourceTask, nextTask);
  addTaskLog(sourceTask.id, {
    event: 'retry_created',
    message: 'A retry task was created from this failed generation task.',
    data: logData,
  });
  addTaskLog(nextTask.id, {
    event: 'created_from_retry',
    message: 'This generation task was created by retrying a failed task.',
    data: {
      ...logData,
      sourceTaskId: sourceTask.id,
    },
  });
}

function requestSnapshot(req) {
  return {
    headers: {
      host: req.headers.host,
      'x-forwarded-host': req.headers['x-forwarded-host'],
      'x-forwarded-proto': req.headers['x-forwarded-proto'],
    },
    protocol: req.protocol,
    publicBaseUrl: getPublicBaseUrl(req),
  };
}

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
    generationQueueConcurrency = 2,
    uploadLimits = {},
  } = context;
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
  const taskQueue = createTaskQueueService({
    name: 'generation',
    concurrency: generationQueueConcurrency,
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
  taskQueue.start();

  app.post('/api/images', async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const body = req.body || {};
      const task = imageGenerationService.createImageTask(userId, {
        ...body,
        publicBaseUrl: getPublicBaseUrl(req),
      }, 'queued');
      taskQueue.enqueue(task, {
        req: requestSnapshot(req),
        body,
      });
      res.status(202).json({
        task,
        taskId: task.id,
        status: task.status,
      });
    } catch (error) {
      console.error('/api/images error:', error.message);
      sendSafeError(res, error, { message: 'Image generation failed.' });
    }
  });

  async function enqueueImageRetry({ req, userId, task }) {
    const body = imageRetryBody(task);
    const nextTask = imageGenerationService.createImageTask(userId, {
      ...body,
      publicBaseUrl: getPublicBaseUrl(req),
    }, 'queued');
    addRetryLogs(task, nextTask);
    taskQueue.enqueue(nextTask, {
      req: requestSnapshot(req),
      body,
    });
    return {
      status: 202,
      data: {
        task: nextTask,
        taskId: nextTask.id,
        status: nextTask.status,
      },
    };
  }

  if (allowSyncGeneration) {
    app.post('/api/images/sync', async (req, res) => {
      try {
        const secrets = await readSecrets();
        const userId = getRequestUserId(req);
        const body = req.body || {};
        const result = await imageGenerationService.generateImage({
          req,
          userId,
          body,
          secrets,
        });
        res.status(result.status).json(result.data);
      } catch (error) {
        console.error('/api/images/sync error:', error.message);
        sendSafeError(res, error, { message: 'Image generation failed.' });
      }
    });
  }

  app.post('/api/videos', async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const body = req.body || {};
      const task = videoGenerationService.createVideoTask(userId, {
        ...body,
        publicBaseUrl: getPublicBaseUrl(req),
      }, 'queued');
      taskQueue.enqueue(task, {
        req: requestSnapshot(req),
        body,
      });
      res.status(202).json({
        task,
        taskId: task.id,
        status: task.status,
      });
    } catch (error) {
      console.error('/api/videos error:', error.message);
      sendSafeError(res, error, { message: 'Video generation failed.' });
    }
  });

  if (allowSyncGeneration) {
    app.post('/api/videos/sync', async (req, res) => {
      try {
        const secrets = await readSecrets();
        const userId = getRequestUserId(req);
        const body = req.body || {};
        const result = await videoGenerationService.generateVideo({
          req,
          userId,
          body,
          secrets,
        });
        res.status(result.status).json(result.data);
      } catch (error) {
        console.error('/api/videos/sync error:', error.message);
        sendSafeError(res, error, { message: 'Video generation failed.' });
      }
    });
  }

  async function enqueueVideoRetry({ req, userId, task }) {
    const body = videoRetryBody(task);
    const nextTask = videoGenerationService.createVideoTask(userId, {
      ...body,
      publicBaseUrl: getPublicBaseUrl(req),
    }, 'queued');
    addRetryLogs(task, nextTask);
    taskQueue.enqueue(nextTask, {
      req: requestSnapshot(req),
      body,
    });
    return {
      status: 202,
      data: {
        task: nextTask,
        taskId: nextTask.id,
        status: nextTask.status,
      },
    };
  }

  app.get('/api/videos/:taskId', async (req, res) => {
    try {
      const secrets = await readSecrets();
      const userId = getRequestUserId(req);
      const result = await videoGenerationService.getVideoTask({
        taskId: req.params.taskId,
        userId,
        query: req.query,
        secrets,
      });
      res.status(result.status).json(result.data);
    } catch (error) {
      console.error('/api/videos/:taskId error:', error.message);
      sendSafeError(res, error, { message: 'Video task lookup failed.' });
    }
  });

  async function retryGenerationTask({ req, userId, task }) {
    if (task.nodeType === 'image' || task.kind === 'image') {
      return enqueueImageRetry({ req, userId, task });
    }
    if (task.nodeType === 'video' || task.kind === 'video') {
      return enqueueVideoRetry({ req, userId, task });
    }
    return {
      status: 400,
      data: { error: `Retry is not supported for ${task.nodeType || task.kind || 'this task'} tasks.` },
    };
  }

  return {
    getGenerationQueueStats: () => taskQueue.getStats(),
    retryGenerationTask,
    stopGenerationQueue: () => taskQueue.stop(),
  };
}

module.exports = {
  registerGenerationRoutes,
};
