const { taskRepository: defaultTaskRepository } = require('../repositories/taskRepository.cjs');
const { getPublicBaseUrl } = require('./mediaUrlService.cjs');
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

function addRetryLogs(taskRepository, sourceTask, nextTask) {
  const logData = taskRetryLogData(sourceTask, nextTask, 'generation');
  taskRepository.addTaskLog(sourceTask.id, {
    data: logData,
    event: 'retry_created',
    message: 'A retry task was created from this failed generation task.',
  });
  taskRepository.addTaskLog(nextTask.id, {
    data: {
      ...logData,
      sourceTaskId: sourceTask.id,
    },
    event: 'created_from_retry',
    message: 'This generation task was created by retrying a failed task.',
  });
}

function queuedTaskResponse(task) {
  return {
    data: {
      status: task.status,
      task,
      taskId: task.id,
    },
    status: 202,
  };
}

function createGenerationTaskRequestService({
  generationWorker,
  getRequestUserId = (req) => req.authUser?.id || 'local-user',
  imageGenerationService,
  readSecrets,
  taskRepository = defaultTaskRepository,
  videoGenerationService,
}) {
  function enqueueImageTask(req) {
    const userId = getRequestUserId(req);
    const body = req.body || {};
    const task = imageGenerationService.createImageTask(userId, {
      ...body,
      publicBaseUrl: getPublicBaseUrl(req),
    }, 'queued');
    generationWorker.queueGenerationTask(task, {
      body,
      req: requestSnapshot(req),
    });
    return queuedTaskResponse(task);
  }

  async function runSyncImageTask(req) {
    return imageGenerationService.generateImage({
      body: req.body || {},
      req,
      secrets: await readSecrets(),
      userId: getRequestUserId(req),
    });
  }

  function enqueueVideoTask(req) {
    const userId = getRequestUserId(req);
    const body = req.body || {};
    const task = videoGenerationService.createVideoTask(userId, {
      ...body,
      publicBaseUrl: getPublicBaseUrl(req),
    }, 'queued');
    generationWorker.queueGenerationTask(task, {
      body,
      req: requestSnapshot(req),
    });
    return queuedTaskResponse(task);
  }

  async function runSyncVideoTask(req) {
    return videoGenerationService.generateVideo({
      body: req.body || {},
      req,
      secrets: await readSecrets(),
      userId: getRequestUserId(req),
    });
  }

  async function getVideoTask(req) {
    return videoGenerationService.getVideoTask({
      query: req.query,
      secrets: await readSecrets(),
      taskId: req.params.taskId,
      userId: getRequestUserId(req),
    });
  }

  async function enqueueImageRetry({ req, userId, task }) {
    const body = imageRetryBody(task);
    const nextTask = imageGenerationService.createImageTask(userId, {
      ...body,
      publicBaseUrl: getPublicBaseUrl(req),
    }, 'queued');
    addRetryLogs(taskRepository, task, nextTask);
    generationWorker.queueGenerationTask(nextTask, {
      body,
      req: requestSnapshot(req),
    });
    return queuedTaskResponse(nextTask);
  }

  async function enqueueVideoRetry({ req, userId, task }) {
    const body = videoRetryBody(task);
    const nextTask = videoGenerationService.createVideoTask(userId, {
      ...body,
      publicBaseUrl: getPublicBaseUrl(req),
    }, 'queued');
    addRetryLogs(taskRepository, task, nextTask);
    generationWorker.queueGenerationTask(nextTask, {
      body,
      req: requestSnapshot(req),
    });
    return queuedTaskResponse(nextTask);
  }

  async function retryGenerationTask({ req, userId, task }) {
    if (task.nodeType === 'image' || task.kind === 'image') {
      return enqueueImageRetry({ req, task, userId });
    }
    if (task.nodeType === 'video' || task.kind === 'video') {
      return enqueueVideoRetry({ req, task, userId });
    }
    return {
      data: { error: `Retry is not supported for ${task.nodeType || task.kind || 'this task'} tasks.` },
      status: 400,
    };
  }

  return {
    enqueueImageTask,
    enqueueVideoTask,
    getVideoTask,
    retryGenerationTask,
    runSyncImageTask,
    runSyncVideoTask,
  };
}

module.exports = {
  createGenerationTaskRequestService,
  imageRetryBody,
  requestSnapshot,
  videoRetryBody,
};
