const assert = require('node:assert/strict');
const test = require('node:test');

const { classifyApiKeyModel } = require('./modelCatalog.cjs');
const { createPlatformModelService } = require('./services/platformModelService.cjs');

function createMemoryRepository() {
  const models = new Map([
    ['platform-image', {
      id: 'platform-image',
      displayName: '平台图片 2.0',
      description: '统一图片模型',
      capability: 'imageGeneration',
      model: 'image2.0',
      capabilities: { imageGeneration: true, maxReferenceImages: 4 },
      isEnabled: true,
      sortOrder: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    ['disabled-video', {
      id: 'disabled-video',
      displayName: '禁用视频',
      description: '',
      capability: 'videoGeneration',
      model: 'video1.0',
      capabilities: {},
      isEnabled: false,
      sortOrder: 20,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    ['unrouted-video', {
      id: 'unrouted-video',
      displayName: '未配置路由的视频',
      description: '',
      capability: 'videoGeneration',
      model: 'video-without-route',
      capabilities: {},
      isEnabled: true,
      sortOrder: 30,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    ['platform-chat', {
      id: 'platform-chat',
      displayName: '平台文本',
      description: '统一文本模型',
      capability: 'chat',
      model: 'gpt-5.6-sol',
      capabilities: {},
      isEnabled: true,
      sortOrder: 40,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
  ]);
  const routes = new Map([
    ['route-1', {
      id: 'route-1',
      platformModelId: 'platform-image',
      apiKeyId: 'server-key',
      apiKeyModelId: 'server-key:wanx2.1-t2i-turbo',
      providerId: 'aliyun-bailian',
      upstreamModel: 'wanx2.1-t2i-turbo',
      priority: 1,
      isEnabled: true,
      apiKey: {
        id: 'server-key',
        name: '阿里云服务器 Key',
        providerId: 'aliyun-bailian',
        keyScope: 'server',
        baseUrl: 'https://dashscope.aliyuncs.com',
        encryptedKey: 'encrypted:secret',
        isEnabled: true,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    ['route-chat', {
      id: 'route-chat',
      platformModelId: 'platform-chat',
      apiKeyId: 'openai-chat-key',
      apiKeyModelId: 'openai-chat-key:gpt-4.1',
      providerId: 'openai-compatible',
      upstreamModel: 'gpt-4.1',
      priority: 1,
      isEnabled: true,
      apiKey: {
        id: 'openai-chat-key',
        name: 'OpenAI 文本测试 Key',
        providerId: 'openai-compatible',
        keyScope: 'server',
        baseUrl: 'https://api.example.com',
        encryptedKey: 'encrypted:secret',
        isEnabled: true,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
  ]);
  const apiKeys = new Map([
    ['server-key', {
      id: 'server-key',
      name: '阿里云服务器 Key',
      providerId: 'aliyun-bailian',
      keyScope: 'server',
      models: ['wanx2.1-t2i-turbo', 'wanx2.1-t2i-plus', 'wanx2.1-i2v-turbo'],
      isEnabled: true,
    }],
    ['disabled-server-key', {
      id: 'disabled-server-key',
      name: '禁用服务器 Key',
      providerId: 'aliyun-bailian',
      keyScope: 'server',
      models: ['wanx2.1-t2i-plus'],
      isEnabled: false,
    }],
    ['user-key', {
      id: 'user-key',
      name: '个人 Key',
      providerId: 'openai-compatible',
      keyScope: 'user',
      models: ['gpt-image-2'],
      isEnabled: true,
    }],
    ['openai-server-key', {
      id: 'openai-server-key',
      name: 'OpenAI 服务器 Key',
      providerId: 'openai-compatible',
      keyScope: 'server',
      models: ['gpt-image-2', 'dall-e-3', 'gpt-4.1'],
      isEnabled: true,
    }],
    ['openai-chat-key', {
      id: 'openai-chat-key',
      name: 'OpenAI 文本测试 Key',
      providerId: 'openai-compatible',
      keyScope: 'server',
      models: ['gpt-image-2', 'gpt-4.1'],
      isEnabled: true,
    }],
  ]);
  const apiKeyModels = new Map();
  for (const apiKey of apiKeys.values()) {
    for (const upstreamModel of apiKey.models) {
      const classification = classifyApiKeyModel(apiKey.providerId, upstreamModel);
      const id = `${apiKey.id}:${upstreamModel}`;
      apiKeyModels.set(id, {
        id,
        apiKeyId: apiKey.id,
        upstreamModel,
        modelProviderId: classification.modelProviderId,
        adapterId: classification.adapterId,
        displayName: upstreamModel,
        capabilities: classification.capabilities,
        capabilitySource: classification.capabilitySource,
        isEnabled: true,
        discoveryStatus: classification.discoveryStatus,
        apiKey,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    }
  }
  const audits = [];

  return {
    audits,
    countPlatformModels(options = {}) {
      return this.listPlatformModels(options).length;
    },
    createAuditLog(entry) {
      audits.push(entry);
    },
    deletePlatformModel(id) {
      return models.delete(id);
    },
    deletePlatformModelRoute(id) {
      return routes.delete(id);
    },
    getApiKey(id) {
      return apiKeys.get(id) || null;
    },
    getApiKeyModel(id) {
      return apiKeyModels.get(id) || null;
    },
    getApiKeyModelByKeyAndName(apiKeyId, upstreamModel) {
      return Array.from(apiKeyModels.values()).find((model) => (
        model.apiKeyId === apiKeyId && model.upstreamModel === upstreamModel
      )) || null;
    },
    getPlatformModel(id) {
      return models.get(id) || null;
    },
    getPlatformModelRoute(id) {
      return routes.get(id) || null;
    },
    listPlatformModelRoutes(platformModelId, options = {}) {
      return Array.from(routes.values())
        .filter((route) => route.platformModelId === platformModelId)
        .filter((route) => options.includeDisabled || route.isEnabled)
        .map((route) => ({
          ...route,
          apiKeyModel: route.apiKeyModelId
            ? apiKeyModels.get(route.apiKeyModelId)
            : this.getApiKeyModelByKeyAndName(route.apiKeyId, route.upstreamModel),
        }))
        .sort((left, right) => left.priority - right.priority);
    },
    listPlatformModels(options = {}) {
      return Array.from(models.values())
        .filter((model) => options.includeDisabled || model.isEnabled)
        .filter((model) => !options.capability || model.capability === options.capability)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .slice(options.offset || 0, (options.offset || 0) + (options.limit || 100));
    },
    upsertPlatformModel(body) {
      const now = '2026-01-02T00:00:00.000Z';
      const existing = body.id ? models.get(body.id) : null;
      const id = body.id || `model-${models.size + 1}`;
      const model = {
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        ...existing,
        ...body,
        id,
      };
      models.set(id, model);
      return model;
    },
    upsertPlatformModelRoute(body) {
      const now = '2026-01-02T00:00:00.000Z';
      const existing = body.id ? routes.get(body.id) : null;
      const id = body.id || `route-${routes.size + 1}`;
      const route = {
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        ...existing,
        ...body,
        id,
        apiKey: apiKeys.get(body.apiKeyId),
        apiKeyModel: body.apiKeyModelId ? apiKeyModels.get(body.apiKeyModelId) : undefined,
      };
      routes.set(id, route);
      return route;
    },
  };
}

test('public platform models hide disabled and unrouted models and route details', () => {
  const repository = createMemoryRepository();
  const service = createPlatformModelService({ repository });

  const result = service.listPublicPlatformModels({ query: {} });

  assert.equal(result.status, 200);
  assert.equal(result.data.total, 2);
  assert.deepEqual(result.data.models.map((model) => model.id), ['platform-image', 'platform-chat']);
  assert.equal(Object.hasOwn(result.data.models[0], 'routes'), false);
  assert.equal(Object.hasOwn(result.data.models[0], 'baseUrl'), false);
  assert.equal(Object.hasOwn(result.data.models[0], 'capabilityOverrides'), false);
  assert.equal(result.data.models[0].capabilitySource, 'platform-override');
});

test('admin platform models include safe route summaries only', () => {
  const repository = createMemoryRepository();
  const service = createPlatformModelService({ repository });

  const result = service.listAdminPlatformModels({ query: {} });
  const route = result.data.models.find((model) => model.id === 'platform-image').routes[0];

  assert.equal(result.status, 200);
  assert.equal(result.data.total, 4);
  assert.equal(route.apiKey.id, 'server-key');
  assert.equal(route.apiKey.name, '阿里云服务器 Key');
  assert.equal(route.apiKey.baseUrl, undefined);
  assert.equal(route.apiKey.encryptedKey, undefined);
  assert.deepEqual(result.data.models.find((model) => model.id === 'platform-image').capabilityOverrides, { imageGeneration: true, maxReferenceImages: 4 });
});

test('platform models infer public capabilities from enabled routes when capability JSON is empty', () => {
  const repository = createMemoryRepository();
  repository.upsertPlatformModel({
    id: 'gpt-image-2-platform',
    displayName: 'GPT Image 2',
    description: '',
    capability: 'imageGeneration',
    model: 'gpt-image-2',
    capabilities: {},
    isEnabled: true,
    sortOrder: 1,
  });
  repository.upsertPlatformModelRoute({
    id: 'gpt-image-2-route',
    platformModelId: 'gpt-image-2-platform',
    apiKeyId: 'openai-server-key',
    providerId: 'openai-compatible',
    upstreamModel: 'gpt-image-2',
    priority: 1,
    isEnabled: true,
  });
  const service = createPlatformModelService({ repository });

  const result = service.listPublicPlatformModels({ query: { search: 'GPT Image 2' } });
  const model = result.data.models.find((item) => item.id === 'gpt-image-2-platform');

  assert.equal(result.status, 200);
  assert.ok(model);
  assert.equal(model.capabilities.imageGeneration, true);
  assert.equal(model.capabilities.imageReference, true);
  assert.equal(model.capabilities.multiImageReference, true);
  assert.equal(model.capabilities.image.maxReferenceImages, 16);
  assert.equal(model.capabilitySource, 'route-inferred');
  assert.deepEqual(model.capabilityWarnings, []);
  assert.equal(Object.hasOwn(model, 'routes'), false);
});

test('platform model capability type narrows overly broad route inference', () => {
  const repository = createMemoryRepository();
  const service = createPlatformModelService({ repository });

  const result = service.listPublicPlatformModels({ query: { search: '平台文本' } });
  const model = result.data.models.find((item) => item.id === 'platform-chat');

  assert.equal(result.status, 200);
  assert.ok(model);
  assert.equal(model.capability, 'chat');
  assert.equal(model.capabilities.chat, true);
  assert.equal(model.capabilities.imageGeneration, false);
  assert.equal(model.capabilities.videoGeneration, false);
  assert.equal(model.capabilitySource, 'route-inferred');
});

test('platform model routes can only bind enabled server keys', () => {
  const repository = createMemoryRepository();
  const service = createPlatformModelService({ repository });
  const req = {
    authUser: { id: 'admin-user' },
    params: { platformModelId: 'platform-image' },
    body: {
      apiKeyId: 'user-key',
      upstreamModel: 'not-allowed',
    },
  };

  const userKeyResult = service.savePlatformModelRoute(req);
  assert.equal(userKeyResult.status, 400);

  const disabledResult = service.savePlatformModelRoute({
    ...req,
    body: { ...req.body, apiKeyId: 'disabled-server-key' },
  });
  assert.equal(disabledResult.status, 400);

  const serverKeyResult = service.savePlatformModelRoute({
    ...req,
    body: {
      apiKeyId: 'server-key',
      providerId: 'aliyun-bailian',
      upstreamModel: 'wanx2.1-t2i-plus',
      priority: 2,
    },
  });
  assert.equal(serverKeyResult.status, 201);
  assert.equal(serverKeyResult.data.route.apiKeyId, 'server-key');
  assert.equal(serverKeyResult.data.route.apiKeyModelId, 'server-key:wanx2.1-t2i-plus');
  assert.equal(serverKeyResult.data.route.upstreamModel, 'wanx2.1-t2i-plus');
  assert.equal(repository.audits.at(-1).action, 'platform_model_route.create');
});

test('bulk creates platform models from saved server key models', () => {
  const repository = createMemoryRepository();
  const service = createPlatformModelService({ repository });

  const result = service.createPlatformModelsFromKey({
    authUser: { id: 'admin-user' },
    body: {
      apiKeyId: 'openai-server-key',
      capability: 'imageGeneration',
      apiKeyModelIds: [
        'openai-server-key:gpt-image-2',
        'openai-server-key:dall-e-3',
      ],
    },
  });

  assert.equal(result.status, 201);
  assert.equal(result.data.count.created, 2);
  assert.equal(result.data.count.skipped, 0);
  assert.deepEqual(result.data.created.map((item) => item.upstreamModel), ['gpt-image-2', 'dall-e-3']);
  for (const item of result.data.created) {
    assert.equal(item.model.displayName, item.upstreamModel);
    assert.equal(item.model.model, item.upstreamModel);
    assert.equal(item.route.apiKeyId, 'openai-server-key');
    assert.equal(item.route.providerId, 'openai-compatible');
    assert.equal(item.route.upstreamModel, item.upstreamModel);
  }
  assert.equal(repository.audits.at(-1).action, 'platform_model.bulk_create_from_key');
});

test('bulk create skips existing api key and upstream model bindings', () => {
  const repository = createMemoryRepository();
  const service = createPlatformModelService({ repository });

  const result = service.createPlatformModelsFromKey({
    authUser: { id: 'admin-user' },
    body: {
      apiKeyId: 'server-key',
      capability: 'imageGeneration',
      apiKeyModelIds: [
        'server-key:wanx2.1-t2i-turbo',
        'server-key:wanx2.1-t2i-plus',
      ],
    },
  });

  assert.equal(result.status, 201);
  assert.equal(result.data.count.created, 1);
  assert.equal(result.data.count.skipped, 1);
  assert.equal(result.data.skipped[0].upstreamModel, 'wanx2.1-t2i-turbo');
  assert.equal(result.data.skipped[0].reason, 'already_bound');
  assert.equal(result.data.created[0].route.upstreamModel, 'wanx2.1-t2i-plus');
});

test('incompatible platform routes cannot be enabled', () => {
  const repository = createMemoryRepository();
  repository.upsertPlatformModel({
    id: 'reference-image-platform',
    displayName: 'Reference image platform',
    description: '',
    capability: 'imageGeneration',
    model: 'reference-image',
    capabilities: {
      imageGeneration: true,
      imageReference: true,
      image: { maxReferenceImages: 16 },
    },
    isEnabled: true,
    sortOrder: 1,
  });
  const service = createPlatformModelService({ repository });

  const incompatible = service.savePlatformModelRoute({
    authUser: { id: 'admin-user' },
    params: { platformModelId: 'reference-image-platform' },
    body: {
      apiKeyModelId: 'server-key:wanx2.1-t2i-plus',
      isEnabled: true,
    },
  });

  assert.equal(incompatible.status, 409);
  assert.equal(incompatible.data.compatibility.compatible, false);
  assert.ok(incompatible.data.compatibility.issues.includes('imageReference is required'));
});

test('bulk create rejects user keys, disabled keys, and models outside saved list', () => {
  const repository = createMemoryRepository();
  const service = createPlatformModelService({ repository });

  const userKeyResult = service.createPlatformModelsFromKey({
    body: {
      apiKeyId: 'user-key',
      capability: 'imageGeneration',
      models: ['gpt-image-2'],
    },
  });
  assert.equal(userKeyResult.status, 400);

  const disabledKeyResult = service.createPlatformModelsFromKey({
    body: {
      apiKeyId: 'disabled-server-key',
      capability: 'imageGeneration',
      models: ['wanx2.1-t2i-plus'],
    },
  });
  assert.equal(disabledKeyResult.status, 400);

  const invalidModelResult = service.createPlatformModelsFromKey({
    body: {
      apiKeyId: 'openai-server-key',
      capability: 'imageGeneration',
      models: ['not-saved-model'],
    },
  });
  assert.equal(invalidModelResult.status, 400);
  assert.deepEqual(invalidModelResult.data.invalidModels, ['not-saved-model']);
});
