const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createGenerationTaskRequestService,
  imageRetryBody,
  requestSnapshot,
  videoRetryBody,
} = require('./services/generationTaskRequestService.cjs');

function createRequest(overrides = {}) {
  return {
    authUser: { id: 'user-1' },
    body: {},
    headers: {
      host: 'api.example.com',
      'x-forwarded-host': 'public.example.com',
      'x-forwarded-proto': 'https',
    },
    params: {},
    protocol: 'http',
    query: {},
    ...overrides,
  };
}

function createService() {
  const calls = {
    createdImages: [],
    createdVideos: [],
    generatedImages: [],
    generatedVideos: [],
    queuedTasks: [],
    taskLogs: [],
    videoLookups: [],
  };

  const generationWorker = {
    queueGenerationTask(task, payload) {
      calls.queuedTasks.push({ payload, task });
    },
  };

  const imageGenerationService = {
    createImageTask(userId, body, status) {
      calls.createdImages.push({ body, status, userId });
      return {
        id: `image-${calls.createdImages.length}`,
        input: body,
        nodeType: 'image',
        providerId: body.providerId || 'openai-compatible',
        status,
        userId,
      };
    },
    async generateImage(input) {
      calls.generatedImages.push(input);
      return {
        data: { ok: true, type: 'image' },
        status: 208,
      };
    },
  };

  const videoGenerationService = {
    createVideoTask(userId, body, status) {
      calls.createdVideos.push({ body, status, userId });
      return {
        id: `video-${calls.createdVideos.length}`,
        input: body,
        nodeType: 'video',
        providerId: body.providerId || 'seedance',
        status,
        userId,
      };
    },
    async generateVideo(input) {
      calls.generatedVideos.push(input);
      return {
        data: { ok: true, type: 'video' },
        status: 209,
      };
    },
    async getVideoTask(input) {
      calls.videoLookups.push(input);
      return {
        data: { id: input.taskId },
        status: 210,
      };
    },
  };

  const taskRepository = {
    addTaskLog(taskId, log) {
      calls.taskLogs.push({ log, taskId });
    },
  };

  const service = createGenerationTaskRequestService({
    generationWorker,
    getRequestUserId: (req) => req.authUser?.id || 'local-user',
    imageGenerationService,
    readSecrets: async () => ({ apiKey: 'secret-key' }),
    taskRepository,
    videoGenerationService,
  });

  return { calls, service };
}

test('generation request snapshot keeps only request routing metadata', () => {
  const snapshot = requestSnapshot(createRequest());

  assert.deepEqual(snapshot, {
    headers: {
      host: 'api.example.com',
      'x-forwarded-host': 'public.example.com',
      'x-forwarded-proto': 'https',
    },
    protocol: 'http',
    publicBaseUrl: 'https://public.example.com',
  });
});

test('generation task service enqueues image tasks with public base URL', () => {
  const { calls, service } = createService();

  const response = service.enqueueImageTask(createRequest({
    body: { model: 'image-model', prompt: 'hello' },
  }));

  assert.equal(response.status, 202);
  assert.equal(response.data.taskId, 'image-1');
  assert.equal(calls.createdImages[0].userId, 'user-1');
  assert.equal(calls.createdImages[0].status, 'queued');
  assert.equal(calls.createdImages[0].body.publicBaseUrl, 'https://public.example.com');
  assert.deepEqual(calls.queuedTasks[0].payload.body, {
    model: 'image-model',
    prompt: 'hello',
  });
  assert.equal(calls.queuedTasks[0].payload.req.publicBaseUrl, 'https://public.example.com');
});

test('generation task service enqueues video tasks with public base URL', () => {
  const { calls, service } = createService();

  const response = service.enqueueVideoTask(createRequest({
    body: { model: 'video-model', prompt: 'hello' },
  }));

  assert.equal(response.status, 202);
  assert.equal(response.data.taskId, 'video-1');
  assert.equal(calls.createdVideos[0].body.publicBaseUrl, 'https://public.example.com');
  assert.equal(calls.queuedTasks[0].payload.req.publicBaseUrl, 'https://public.example.com');
});

test('generation task service runs sync image and video tasks with secrets', async () => {
  const { calls, service } = createService();

  const image = await service.runSyncImageTask(createRequest({
    body: { prompt: 'image' },
  }));
  const video = await service.runSyncVideoTask(createRequest({
    body: { prompt: 'video' },
  }));

  assert.equal(image.status, 208);
  assert.equal(video.status, 209);
  assert.deepEqual(calls.generatedImages[0].secrets, { apiKey: 'secret-key' });
  assert.deepEqual(calls.generatedVideos[0].secrets, { apiKey: 'secret-key' });
  assert.equal(calls.generatedImages[0].userId, 'user-1');
  assert.equal(calls.generatedVideos[0].userId, 'user-1');
});

test('generation task service looks up video tasks with request user and query', async () => {
  const { calls, service } = createService();

  const response = await service.getVideoTask(createRequest({
    params: { taskId: 'upstream-1' },
    query: { providerId: 'seedance' },
  }));

  assert.equal(response.status, 210);
  assert.deepEqual(calls.videoLookups[0], {
    query: { providerId: 'seedance' },
    secrets: { apiKey: 'secret-key' },
    taskId: 'upstream-1',
    userId: 'user-1',
  });
});

test('image retry body preserves generation fields without raw keys', () => {
  const body = imageRetryBody({
    id: 'failed-image',
    input: {
      apiKey: 'raw-key',
      apiKeyId: 'saved-key',
      model: 'image-model',
      prompt: 'hello',
      reference_images: ['asset-1'],
      seed: 123,
      upstreamTaskIds: ['upstream-1'],
    },
    providerId: 'image-provider',
  });

  assert.equal(body.apiKey, undefined);
  assert.equal(body.apiKeyId, 'saved-key');
  assert.equal(body.providerId, 'image-provider');
  assert.equal(body.retryOf, 'failed-image');
  assert.deepEqual(body.reference_images, ['asset-1']);
  assert.deepEqual(body.upstreamTaskIds, ['upstream-1']);
});

test('video retry body preserves multimodal fields without raw keys', () => {
  const body = videoRetryBody({
    id: 'failed-video',
    input: {
      apiKey: 'raw-key',
      content: [{ type: 'text', text: 'hello' }],
      generate_audio: true,
      referenceAudios: ['audio-1'],
      referenceVideos: ['video-1'],
    },
    providerId: 'video-provider',
  });

  assert.equal(body.apiKey, undefined);
  assert.equal(body.providerId, 'video-provider');
  assert.equal(body.retryOf, 'failed-video');
  assert.deepEqual(body.content, [{ type: 'text', text: 'hello' }]);
  assert.deepEqual(body.referenceAudios, ['audio-1']);
  assert.deepEqual(body.referenceVideos, ['video-1']);
  assert.equal(body.generate_audio, true);
});

test('generation task service retries image tasks and writes relationship logs', async () => {
  const { calls, service } = createService();

  const response = await service.retryGenerationTask({
    req: createRequest(),
    task: {
      id: 'failed-image',
      input: { model: 'image-model', prompt: 'hello' },
      nodeType: 'image',
      providerId: 'image-provider',
    },
    userId: 'user-1',
  });

  assert.equal(response.status, 202);
  assert.equal(response.data.taskId, 'image-1');
  assert.equal(calls.createdImages[0].body.retryOf, 'failed-image');
  assert.equal(calls.createdImages[0].body.providerId, 'image-provider');
  assert.deepEqual(calls.taskLogs.map((item) => item.log.event), [
    'retry_created',
    'created_from_retry',
  ]);
  assert.equal(calls.taskLogs[1].log.data.sourceTaskId, 'failed-image');
});

test('generation task service retries video tasks and rejects unsupported task kinds', async () => {
  const { calls, service } = createService();

  const videoResponse = await service.retryGenerationTask({
    req: createRequest(),
    task: {
      id: 'failed-video',
      input: { model: 'video-model', prompt: 'hello' },
      nodeType: 'video',
      providerId: 'video-provider',
    },
    userId: 'user-1',
  });
  const unsupportedResponse = await service.retryGenerationTask({
    req: createRequest(),
    task: {
      id: 'failed-text',
      nodeType: 'text',
    },
    userId: 'user-1',
  });

  assert.equal(videoResponse.status, 202);
  assert.equal(videoResponse.data.taskId, 'video-1');
  assert.equal(calls.createdVideos[0].body.retryOf, 'failed-video');
  assert.equal(unsupportedResponse.status, 400);
  assert.deepEqual(unsupportedResponse.data, {
    error: 'Retry is not supported for text tasks.',
  });
});
