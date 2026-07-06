const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-model-capabilities-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const { createUser, db, listAuditLogs, listModelCapabilities, upsertModelCapability } = require('./db.cjs');
const {
  filterImageBodyByCapabilities,
  filterVideoBodyByCapabilities,
  listModelCapabilityPresets,
} = require('./modelCapabilities.cjs');
const {
  MODEL_CAPABILITY_LIMITS: MODEL_CAPABILITY_ROUTE_LIMITS,
  registerModelProxyRoutes,
} = require('./routes/modelProxyRoutes.cjs');

function createFakeApp() {
  const routes = [];
  return {
    routes,
    get(pathname, handler) {
      routes.push({ method: 'GET', pathname, handler });
    },
    post(pathname, handler) {
      routes.push({ method: 'POST', pathname, handler });
    },
  };
}

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('model capability presets expose complete manually maintained templates', () => {
  const presets = listModelCapabilityPresets();
  const seedance = presets.find((preset) => preset.providerId === 'seedance' && preset.modelPattern === 'doubao-seedance-2-0-mini-*');
  const bailianImage = presets.find((preset) => preset.providerId === 'aliyun-bailian' && preset.modelPattern === 'wan2.7-image*');

  assert.ok(seedance);
  assert.equal(seedance.capabilities.videoGeneration, true);
  assert.equal(seedance.capabilities.video.durationMax, 15);
  assert.ok(seedance.description.includes('视频'));

  assert.ok(bailianImage);
  assert.equal(bailianImage.capabilities.imageGeneration, true);
  assert.equal(bailianImage.capabilities.image.maxImages, 12);
});

test('model capability preset route can filter by provider', () => {
  const app = createFakeApp();
  const handlers = registerModelProxyRoutes(app, {
    enableGenericProxy: false,
    joinUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    proxyAllowlist: [],
    proxyRequest: async () => ({ status: 200, data: {} }),
    getRequestUserId: () => 'local-user',
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
    requireAdmin: () => true,
    resolveDirectCredentials: () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
  });

  const route = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/model-capability-presets');
  const res = createMockRes();
  route.handler({ query: { providerId: 'aliyun-bailian' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.presets.every((preset) => preset.providerId === 'aliyun-bailian'), true);
  assert.ok(res.body.count >= 1);
  handlers.stopTextQueue();
});

test('video capability filter catches direct media fields before provider requests', () => {
  const tooManyImages = filterVideoBodyByCapabilities({
    model: 'wan2.7-i2v',
    prompt: 'animate a product',
    images: [
      'https://cdn.example/first.png',
      'https://cdn.example/last.png',
      'https://cdn.example/extra.png',
    ],
    duration: 5,
  }, {
    videoGeneration: true,
    video: {
      supportsReferenceImage: true,
      maxReferenceImages: 2,
      durationMin: 2,
      durationMax: 15,
    },
  });

  assert.equal(tooManyImages.ok, false);
  assert.equal(tooManyImages.error, 'This model supports at most 2 reference images.');

  const unsupportedMedia = filterVideoBodyByCapabilities({
    model: 'wan-t2v',
    prompt: 'make a clip',
    referenceVideoUrl: 'https://cdn.example/ref.mp4',
    referenceAudioUrl: 'https://cdn.example/ref.mp3',
    duration: 5,
  }, {
    videoGeneration: true,
    video: {
      supportsReferenceImage: false,
      supportsReferenceVideo: false,
      supportsReferenceAudio: false,
      durationMin: 2,
      durationMax: 15,
    },
  });

  assert.equal(unsupportedMedia.ok, false);
  assert.equal(unsupportedMedia.error, 'The selected model does not support reference videos.');
});

test('video capability filter validates reference video and audio count limits', () => {
  const tooManyReferenceVideos = filterVideoBodyByCapabilities({
    model: 'seedance-video',
    prompt: 'edit this clip',
    content: [
      { type: 'text' },
      { type: 'video_url' },
      { type: 'video_url' },
    ],
    duration: 5,
  }, {
    videoGeneration: true,
    video: {
      supportsReferenceVideo: true,
      maxReferenceVideos: 1,
    },
  });

  assert.equal(tooManyReferenceVideos.ok, false);
  assert.equal(tooManyReferenceVideos.error, 'This model supports at most 1 reference videos.');

  const tooManyReferenceAudios = filterVideoBodyByCapabilities({
    model: 'seedance-video',
    prompt: 'sync with audio',
    referenceAudios: [
      'https://cdn.example/a.mp3',
      'https://cdn.example/b.mp3',
    ],
    duration: 5,
  }, {
    videoGeneration: true,
    video: {
      supportsReferenceAudio: true,
      maxReferenceAudios: 1,
    },
  });

  assert.equal(tooManyReferenceAudios.ok, false);
  assert.equal(tooManyReferenceAudios.error, 'This model supports at most 1 reference audio files.');
});

test('video capability filter validates supported modes without leaking workbench mode upstream', () => {
  const unsupportedMode = filterVideoBodyByCapabilities({
    model: 'wan-t2v',
    __workbenchMode: 'image-to-video',
    content: [
      { type: 'text' },
      { type: 'image_url' },
    ],
    duration: 5,
  }, {
    videoGeneration: true,
    video: {
      modes: ['text-to-video'],
      supportsReferenceImage: true,
    },
  });

  assert.equal(unsupportedMode.ok, false);
  assert.equal(unsupportedMode.error, 'This model only supports these video modes: text-to-video.');
  assert.equal(Object.hasOwn(unsupportedMode.body, '__workbenchMode'), false);
  assert.equal(Object.hasOwn(unsupportedMode.body, 'mode'), false);

  const supportedMode = filterVideoBodyByCapabilities({
    model: 'wan-i2v',
    mode: 'image-to-video',
    content: [
      { type: 'text' },
      { type: 'image_url' },
    ],
    duration: 5,
  }, {
    videoGeneration: true,
    video: {
      modes: ['image-to-video', 'images-to-video'],
      supportsReferenceImage: true,
    },
  });

  assert.equal(supportedMode.ok, true);
  assert.equal(Object.hasOwn(supportedMode.body, '__workbenchMode'), false);
  assert.equal(Object.hasOwn(supportedMode.body, 'mode'), false);
});

test('video capability filter infers mode from validation content when no explicit mode is present', () => {
  const result = filterVideoBodyByCapabilities({
    model: 'wan-i2v',
    content: [
      { type: 'text' },
      { type: 'image_url' },
      { type: 'image_url' },
    ],
    duration: 5,
  }, {
    videoGeneration: true,
    video: {
      modes: ['text-to-video', 'image-to-video'],
      supportsReferenceImage: true,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'This model only supports these video modes: text-to-video, image-to-video.');
});

test('image capability filter omits unsupported provider-specific parameter fields', () => {
  const result = filterImageBodyByCapabilities({
    model: 'basic-image',
    prompt: 'a clean product photo',
    prompt_extend: true,
    enable_sequential: true,
    thinking_mode: true,
  }, {
    imageGeneration: true,
    imageReference: false,
    multiImageReference: false,
    negativePrompt: false,
    seed: false,
    quality: false,
    responseFormatB64: true,
    responseFormatUrl: true,
    image: {
      supportsPromptExtend: false,
      supportsSequential: false,
      supportsThinkingMode: false,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result.body, 'prompt_extend'), false);
  assert.equal(Object.hasOwn(result.body, 'enable_sequential'), false);
  assert.equal(Object.hasOwn(result.body, 'thinking_mode'), false);
  assert.deepEqual(result.warnings, [
    'prompt_extend is not supported by this model and was omitted.',
    'enable_sequential is not supported by this model and was omitted.',
    'thinking_mode is not supported by this model and was omitted.',
  ]);
});

test('model capability route supports pagination, provider filter, and search', () => {
  upsertModelCapability('pagination-provider', 'alpha-image-*', {
    imageGeneration: true,
    image: { maxImages: 1 },
  });
  upsertModelCapability('pagination-provider', 'beta-video-*', {
    videoGeneration: true,
    video: { durationMax: 8 },
  });
  upsertModelCapability('other-pagination-provider', 'alpha-hidden-*', {
    imageGeneration: true,
  });

  const app = createFakeApp();
  const handlers = registerModelProxyRoutes(app, {
    enableGenericProxy: false,
    joinUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    proxyAllowlist: [],
    proxyRequest: async () => ({ status: 200, data: {} }),
    getRequestUserId: () => 'local-user',
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
    requireAdmin: () => true,
    resolveDirectCredentials: () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
  });

  const route = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/model-capabilities');
  const firstPage = createMockRes();
  route.handler({
    query: {
      providerId: 'pagination-provider',
      limit: 1,
      offset: 0,
    },
  }, firstPage);

  assert.equal(firstPage.statusCode, 200);
  assert.equal(firstPage.body.count, 1);
  assert.equal(firstPage.body.total, 2);
  assert.equal(firstPage.body.limit, 1);
  assert.equal(firstPage.body.offset, 0);
  assert.deepEqual(firstPage.body.capabilities.map((item) => item.modelPattern), ['alpha-image-*']);

  const searchPage = createMockRes();
  route.handler({
    query: {
      providerId: 'pagination-provider',
      search: 'video',
      limit: 10,
    },
  }, searchPage);

  assert.equal(searchPage.body.total, 1);
  assert.equal(searchPage.body.capabilities[0].modelPattern, 'beta-video-*');
  assert.equal(searchPage.body.capabilities.some((item) => item.providerId === 'other-pagination-provider'), false);
  handlers.stopTextQueue();
});

test('model capability save writes an audit log', () => {
  const admin = createUser({
    email: 'model-capability-admin@example.com',
    username: 'model-capability-admin@example.com',
    name: 'Model Capability Admin',
    role: 'admin',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const handlers = registerModelProxyRoutes(app, {
    enableGenericProxy: false,
    joinUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    proxyAllowlist: [],
    proxyRequest: async () => ({ status: 200, data: {} }),
    getRequestUserId: () => admin.id,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
    requireAdmin: () => true,
    resolveDirectCredentials: () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
  });

  const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/model-capabilities');
  const res = createMockRes();
  route.handler({
    authUser: admin,
    body: {
      providerId: 'openai-compatible',
      modelPattern: 'audit-image-*',
      capabilities: {
        imageGeneration: true,
        image: { maxImages: 2 },
        video: { durationMax: 8, internalNote: 'do-not-store-in-audit' },
      },
    },
    headers: { 'user-agent': 'Audit Browser' },
    socket: { remoteAddress: '203.0.113.10' },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.capability.providerId, 'openai-compatible');
  const auditLog = listAuditLogs().find((log) =>
    log.action === 'model_capability.upsert' &&
    log.targetId === 'openai-compatible:audit-image-*' &&
    log.actorUserId === admin.id
  );
  assert.ok(auditLog);
  assert.deepEqual(auditLog.metadata, {
    providerId: 'openai-compatible',
    modelPattern: 'audit-image-*',
    capabilityKeys: ['image', 'imageGeneration', 'video'],
  });
  assert.equal(JSON.stringify(auditLog.metadata).includes('do-not-store-in-audit'), false);
  assert.equal(Object.hasOwn(auditLog.metadata, 'capabilities'), false);
  handlers.stopTextQueue();
});

test('model capability save rejects malformed capability payloads before audit', () => {
  const admin = createUser({
    email: 'model-capability-shape-admin@example.com',
    username: 'model-capability-shape-admin@example.com',
    name: 'Model Capability Shape Admin',
    role: 'admin',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const handlers = registerModelProxyRoutes(app, {
    enableGenericProxy: false,
    joinUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    proxyAllowlist: [],
    proxyRequest: async () => ({ status: 200, data: {} }),
    getRequestUserId: () => admin.id,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
    requireAdmin: () => true,
    resolveDirectCredentials: () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
  });

  const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/model-capabilities');
  const res = createMockRes();
  route.handler({
    authUser: admin,
    body: {
      providerId: 'openai-compatible',
      modelPattern: 'malformed-capability-*',
      capabilities: ['imageGeneration'],
    },
    headers: { 'user-agent': 'Audit Browser' },
    socket: { remoteAddress: '203.0.113.10' },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /capabilities must be an object/i);
  assert.equal(
    listModelCapabilities().some((capability) =>
      capability.providerId === 'openai-compatible' &&
      capability.modelPattern === 'malformed-capability-*'
    ),
    false
  );
  assert.equal(
    listAuditLogs().some((log) =>
      log.action === 'model_capability.upsert' &&
      log.targetId === 'openai-compatible:malformed-capability-*'
    ),
    false
  );
  handlers.stopTextQueue();
});

test('model capability save rejects oversized or unsafe identifiers before audit', () => {
  const admin = createUser({
    email: 'model-capability-boundary-admin@example.com',
    username: 'model-capability-boundary-admin@example.com',
    name: 'Model Capability Boundary Admin',
    role: 'admin',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const handlers = registerModelProxyRoutes(app, {
    enableGenericProxy: false,
    joinUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    proxyAllowlist: [],
    proxyRequest: async () => ({ status: 200, data: {} }),
    getRequestUserId: () => admin.id,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
    requireAdmin: () => true,
    resolveDirectCredentials: () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
  });

  const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/model-capabilities');

  const unsafeProviderRes = createMockRes();
  route.handler({
    authUser: admin,
    body: {
      providerId: 'bad/provider',
      modelPattern: 'safe-model-*',
      capabilities: { imageGeneration: true },
    },
    headers: { 'user-agent': 'Audit Browser' },
    socket: { remoteAddress: '203.0.113.11' },
  }, unsafeProviderRes);

  assert.equal(unsafeProviderRes.statusCode, 400);
  assert.match(unsafeProviderRes.body.error, /providerId can only include/i);

  const oversizedPattern = 'm'.repeat(MODEL_CAPABILITY_ROUTE_LIMITS.maxModelPatternLength + 1);
  const oversizedPatternRes = createMockRes();
  route.handler({
    authUser: admin,
    body: {
      providerId: 'openai-compatible',
      modelPattern: oversizedPattern,
      capabilities: { imageGeneration: true },
    },
    headers: { 'user-agent': 'Audit Browser' },
    socket: { remoteAddress: '203.0.113.11' },
  }, oversizedPatternRes);

  assert.equal(oversizedPatternRes.statusCode, 400);
  assert.match(oversizedPatternRes.body.error, /modelPattern can include at most/i);

  assert.equal(
    listModelCapabilities().some((capability) =>
      capability.providerId === 'bad/provider' ||
      capability.modelPattern === oversizedPattern
    ),
    false
  );
  assert.equal(
    listAuditLogs().some((log) =>
      log.action === 'model_capability.upsert' &&
      (
        log.metadata?.providerId === 'bad/provider' ||
        log.metadata?.modelPattern === oversizedPattern
      )
    ),
    false
  );
  handlers.stopTextQueue();
});

test('model capability save rejects oversized capability JSON before writing', () => {
  const admin = createUser({
    email: 'model-capability-size-admin@example.com',
    username: 'model-capability-size-admin@example.com',
    name: 'Model Capability Size Admin',
    role: 'admin',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const handlers = registerModelProxyRoutes(app, {
    enableGenericProxy: false,
    joinUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    proxyAllowlist: [],
    proxyRequest: async () => ({ status: 200, data: {} }),
    getRequestUserId: () => admin.id,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
    requireAdmin: () => true,
    resolveDirectCredentials: () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
  });

  const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/model-capabilities');
  const res = createMockRes();
  route.handler({
    authUser: admin,
    body: {
      providerId: 'openai-compatible',
      modelPattern: 'oversized-capability-*',
      capabilities: {
        notes: 'x'.repeat(MODEL_CAPABILITY_ROUTE_LIMITS.maxCapabilitiesBytes + 1),
      },
    },
    headers: { 'user-agent': 'Audit Browser' },
    socket: { remoteAddress: '203.0.113.12' },
  }, res);

  assert.equal(res.statusCode, 413);
  assert.match(res.body.error, /capabilities can include at most/i);
  assert.equal(
    listModelCapabilities().some((capability) =>
      capability.providerId === 'openai-compatible' &&
      capability.modelPattern === 'oversized-capability-*'
    ),
    false
  );
  assert.equal(
    listAuditLogs().some((log) =>
      log.action === 'model_capability.upsert' &&
      log.targetId === 'openai-compatible:oversized-capability-*'
    ),
    false
  );
  handlers.stopTextQueue();
});

test('model capability save rejects non-admin users without writing capabilities or audit logs', () => {
  const user = createUser({
    email: 'model-capability-user@example.com',
    username: 'model-capability-user@example.com',
    name: 'Model Capability User',
    role: 'user',
    passwordHash: 'test',
  });
  const app = createFakeApp();
  const handlers = registerModelProxyRoutes(app, {
    enableGenericProxy: false,
    joinUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    proxyAllowlist: [],
    proxyRequest: async () => ({ status: 200, data: {} }),
    getRequestUserId: () => user.id,
    readSecrets: async () => ({}),
    resolveApiCredentials: async () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
    requireAdmin: (_req, res) => {
      res.status(403).json({ error: 'Admin token is required.' });
      return false;
    },
    resolveDirectCredentials: () => ({ baseUrl: 'https://api.example.com', apiKey: 'key', providerId: 'openai-compatible' }),
  });

  const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/model-capabilities');
  const res = createMockRes();
  route.handler({
    authUser: user,
    body: {
      providerId: 'openai-compatible',
      modelPattern: 'blocked-non-admin-*',
      capabilities: {
        imageGeneration: true,
      },
    },
    headers: { 'user-agent': 'User Browser' },
    socket: { remoteAddress: '203.0.113.20' },
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(
    listModelCapabilities().some((capability) =>
      capability.providerId === 'openai-compatible' &&
      capability.modelPattern === 'blocked-non-admin-*'
    ),
    false
  );
  assert.equal(
    listAuditLogs().some((log) =>
      log.action === 'model_capability.upsert' &&
      log.targetId === 'openai-compatible:blocked-non-admin-*'
    ),
    false
  );
  handlers.stopTextQueue();
});
