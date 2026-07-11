const assert = require('node:assert/strict');
const test = require('node:test');

const {
  adapterSupportsCapabilities,
  capabilityContractIssues,
  classifyApiKeyModel,
} = require('./modelCatalog.cjs');
const { createModelCatalogService } = require('./services/modelCatalogService.cjs');

function createMemoryModelRepository() {
  const keys = new Map([
    ['key-a', {
      id: 'key-a',
      name: 'My OpenAI',
      ownerUserId: 'user-a',
      keyScope: 'user',
      providerId: 'openai-compatible',
      isEnabled: true,
    }],
    ['key-b', {
      id: 'key-b',
      name: 'Relay',
      ownerUserId: 'user-a',
      keyScope: 'user',
      providerId: 'openai-compatible',
      isEnabled: true,
    }],
    ['other-key', {
      id: 'other-key',
      name: 'Other user',
      ownerUserId: 'user-b',
      keyScope: 'user',
      providerId: 'openai-compatible',
      isEnabled: true,
    }],
    ['server-key', {
      id: 'server-key',
      name: 'Server key',
      ownerUserId: 'server-owner',
      keyScope: 'server',
      providerId: 'openai-compatible',
      isEnabled: true,
    }],
  ]);
  const models = new Map();
  const audits = [];

  function decorate(model) {
    return model ? { ...model, apiKey: keys.get(model.apiKeyId) } : null;
  }

  return {
    audits,
    keys,
    models,
    createAuditLog(entry) {
      audits.push(entry);
    },
    getApiKeyForUser(id, userId) {
      const key = keys.get(id);
      return key && (key.ownerUserId === userId || key.keyScope === 'server') ? key : null;
    },
    getApiKeyModel(id) {
      return decorate(models.get(id));
    },
    listApiKeyModels(apiKeyId, options = {}) {
      return Array.from(models.values())
        .filter((model) => model.apiKeyId === apiKeyId)
        .filter((model) => options.includeDisabled || model.isEnabled)
        .filter((model) => options.includeMissing || model.discoveryStatus !== 'missing')
        .map(decorate);
    },
    listUserApiKeyModels(userId, options = {}) {
      return Array.from(models.values())
        .filter((model) => keys.get(model.apiKeyId)?.ownerUserId === userId)
        .filter((model) => keys.get(model.apiKeyId)?.keyScope === 'user')
        .filter((model) => options.includeDisabled || model.isEnabled)
        .filter((model) => options.includeMissing || model.discoveryStatus === 'active')
        .map(decorate);
    },
    markApiKeyModelsMissing(apiKeyId, seenModels) {
      const seen = new Set(seenModels);
      for (const [id, model] of models) {
        if (model.apiKeyId === apiKeyId && !seen.has(model.upstreamModel)) {
          models.set(id, { ...model, discoveryStatus: 'missing' });
        }
      }
    },
    upsertApiKeyModel(input) {
      const existing = Array.from(models.values()).find((model) => (
        model.apiKeyId === input.apiKeyId && model.upstreamModel === input.upstreamModel
      ));
      const id = input.id || existing?.id || `${input.apiKeyId}:${input.upstreamModel}`;
      const model = {
        createdAt: existing?.createdAt || '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        ...existing,
        ...input,
        id,
      };
      models.set(id, model);
      return decorate(model);
    },
  };
}

function emptyPlatformRepository() {
  return {
    countPlatformModels: () => 0,
    getPlatformModel: () => null,
    listPlatformModels: () => [],
    listPlatformModelRoutes: () => [],
  };
}

function request(userId, apiKeyId = 'key-a', role = 'user') {
  return {
    authUser: { id: userId, role },
    headers: {},
    params: { apiKeyId },
    query: {},
  };
}

test('discovery stores every model but leaves new models disabled', async () => {
  const repository = createMemoryModelRepository();
  const service = createModelCatalogService({
    discoverModels: async () => ({
      models: [
        { id: 'gpt-4.1', ownedBy: 'upstream-owner' },
        { id: 'future-video-model', ownedBy: 'vendor-name' },
      ],
      source: 'upstream',
    }),
    getRequestUserId: (req) => req.authUser.id,
    modelRepository: repository,
    platformModelRepository: emptyPlatformRepository(),
  });

  const result = await service.discoverKeyModels(request('user-a'));

  assert.equal(result.status, 200);
  assert.equal(result.data.count, 2);
  const text = result.data.models.find((model) => model.upstreamModel === 'gpt-4.1');
  const unknownVideo = result.data.models.find((model) => model.upstreamModel === 'future-video-model');
  assert.equal(text.isEnabled, false);
  assert.equal(text.discoveryStatus, 'active');
  assert.equal(text.modelProviderId, 'openai-compatible');
  assert.equal(text.adapterId, 'openai-chat');
  assert.equal(unknownVideo.isEnabled, false);
  assert.equal(unknownVideo.discoveryStatus, 'unknown');
  assert.equal(unknownVideo.adapterId, '');
  assert.equal(repository.audits.at(-1).action, 'api_key_models.discover');
});

test('same upstream model on two keys remains two catalog entries', () => {
  const repository = createMemoryModelRepository();
  for (const apiKeyId of ['key-a', 'key-b']) {
    repository.upsertApiKeyModel({
      apiKeyId,
      upstreamModel: 'gpt-4.1',
      modelProviderId: 'openai-compatible',
      adapterId: 'openai-chat',
      displayName: 'GPT 4.1',
      capabilities: { chat: true },
      capabilitySource: 'matched-rules',
      discoveryStatus: 'active',
      isEnabled: true,
    });
  }
  const service = createModelCatalogService({
    getRequestUserId: (req) => req.authUser.id,
    modelRepository: repository,
    platformModelRepository: emptyPlatformRepository(),
  });

  const result = service.listCatalog({ ...request('user-a'), query: { nodeType: 'textModel' } });

  assert.equal(result.status, 200);
  assert.equal(result.data.personalModels.length, 2);
  assert.notEqual(result.data.personalModels[0].id, result.data.personalModels[1].id);
  assert.deepEqual(new Set(result.data.personalModels.map((model) => model.apiKey.name)), new Set(['My OpenAI', 'Relay']));
});

test('model catalog and key model routes enforce ownership and server admin access', () => {
  const repository = createMemoryModelRepository();
  const service = createModelCatalogService({
    getRequestUserId: (req) => req.authUser.id,
    modelRepository: repository,
    platformModelRepository: emptyPlatformRepository(),
  });

  assert.equal(service.listKeyModels(request('user-a', 'other-key')).status, 404);
  assert.equal(service.listKeyModels(request('user-a', 'server-key')).status, 403);
  assert.equal(service.listKeyModels(request('admin', 'server-key', 'admin')).status, 200);
});

test('unknown, missing, and adapter-incompatible models cannot be enabled', () => {
  const repository = createMemoryModelRepository();
  repository.upsertApiKeyModel({
    id: 'unknown-model',
    apiKeyId: 'key-a',
    upstreamModel: 'future-video-model',
    modelProviderId: 'openai-compatible',
    adapterId: '',
    displayName: 'Future video',
    capabilities: {},
    capabilitySource: 'fallback',
    discoveryStatus: 'unknown',
    isEnabled: false,
  });
  repository.upsertApiKeyModel({
    id: 'missing-model',
    apiKeyId: 'key-a',
    upstreamModel: 'removed-model',
    modelProviderId: 'openai-compatible',
    adapterId: 'openai-chat',
    displayName: 'Removed',
    capabilities: { chat: true },
    capabilitySource: 'matched-rules',
    discoveryStatus: 'missing',
    isEnabled: false,
  });
  const service = createModelCatalogService({
    getRequestUserId: (req) => req.authUser.id,
    modelRepository: repository,
    platformModelRepository: emptyPlatformRepository(),
  });

  const unknownRequest = {
    ...request('user-a'),
    params: { apiKeyId: 'key-a', apiKeyModelId: 'unknown-model' },
    body: { isEnabled: true },
  };
  assert.equal(service.updateKeyModel(unknownRequest).status, 409);
  assert.equal(service.updateKeyModel({
    ...unknownRequest,
    body: {
      adapterId: 'openai-chat',
      capabilities: { videoGeneration: true },
      isEnabled: true,
    },
  }).status, 409);
  const configured = service.updateKeyModel({
    ...unknownRequest,
    body: {
      adapterId: 'xai-video',
      capabilities: { videoGeneration: true },
      isEnabled: true,
      modelProviderId: 'xai',
    },
  });
  assert.equal(configured.status, 200);
  assert.equal(configured.data.model.discoveryStatus, 'active');

  const missingRequest = {
    ...request('user-a'),
    params: { apiKeyId: 'key-a', apiKeyModelId: 'missing-model' },
    body: { isEnabled: true },
  };
  assert.equal(service.updateKeyModel(missingRequest).status, 409);
});

test('rediscovery marks disappeared models missing without deleting their stable ID', async () => {
  const repository = createMemoryModelRepository();
  repository.upsertApiKeyModel({
    id: 'stable-model-id',
    apiKeyId: 'key-a',
    upstreamModel: 'gpt-4.1',
    modelProviderId: 'openai-compatible',
    adapterId: 'openai-chat',
    displayName: 'GPT 4.1',
    capabilities: { chat: true },
    capabilitySource: 'matched-rules',
    discoveryStatus: 'active',
    isEnabled: true,
  });
  const service = createModelCatalogService({
    discoverModels: async () => ({ models: [], source: 'upstream' }),
    getRequestUserId: (req) => req.authUser.id,
    modelRepository: repository,
    platformModelRepository: emptyPlatformRepository(),
  });

  const result = await service.discoverKeyModels(request('user-a'));
  const model = result.data.models.find((item) => item.id === 'stable-model-id');

  assert.ok(model);
  assert.equal(model.discoveryStatus, 'missing');
});

test('reading a legacy model instance enriches known capabilities without changing its ID', () => {
  const repository = createMemoryModelRepository();
  repository.upsertApiKeyModel({
    id: 'legacy-image-id',
    apiKeyId: 'key-a',
    upstreamModel: 'gpt-image-2',
    modelProviderId: 'openai-compatible',
    adapterId: '',
    displayName: 'GPT Image 2',
    capabilities: {},
    capabilitySource: 'legacy',
    discoveryStatus: 'active',
    isEnabled: true,
  });
  const service = createModelCatalogService({
    getRequestUserId: (req) => req.authUser.id,
    modelRepository: repository,
    platformModelRepository: emptyPlatformRepository(),
  });

  const result = service.listKeyModels(request('user-a'));
  const model = result.data.models[0];

  assert.equal(model.id, 'legacy-image-id');
  assert.equal(model.adapterId, 'openai-image');
  assert.equal(model.capabilities.imageGeneration, true);
  assert.equal(model.capabilitySource, 'matched-rules');
});

test('reading an unknown legacy media model disables it until an admin configures it', () => {
  const repository = createMemoryModelRepository();
  repository.upsertApiKeyModel({
    id: 'legacy-unknown-id',
    apiKeyId: 'key-a',
    upstreamModel: 'grok-imagine-image',
    modelProviderId: 'xai',
    adapterId: '',
    displayName: 'Grok Imagine Image',
    capabilities: {},
    capabilitySource: 'legacy',
    discoveryStatus: 'active',
    isEnabled: true,
  });
  const service = createModelCatalogService({
    getRequestUserId: (req) => req.authUser.id,
    modelRepository: repository,
    platformModelRepository: emptyPlatformRepository(),
  });

  const result = service.listKeyModels(request('user-a'));
  const model = result.data.models[0];

  assert.equal(model.id, 'legacy-unknown-id');
  assert.equal(model.isEnabled, false);
  assert.equal(model.discoveryStatus, 'unknown');
  assert.equal(model.adapterId, '');
});

test('adapter and platform capability contracts enforce operation and parameter coverage', () => {
  assert.equal(adapterSupportsCapabilities('openai-chat', { chat: true }), true);
  assert.equal(adapterSupportsCapabilities('openai-chat', { imageGeneration: true }), false);

  const issues = capabilityContractIssues({
    imageGeneration: true,
    responseFormatB64: false,
    image: {
      maxReferenceImages: 2,
      sizeAliases: ['1024x1024'],
      supportsWatermark: false,
    },
  }, {
    imageGeneration: true,
    responseFormatB64: true,
    image: {
      maxReferenceImages: 4,
      sizeAliases: ['1024x1024', '2048x2048'],
      supportsWatermark: true,
    },
  });

  assert.ok(issues.includes('responseFormatB64 is required'));
  assert.ok(issues.includes('image.maxReferenceImages must be at least 4'));
  assert.ok(issues.includes('image.sizeAliases does not support 2048x2048'));
  assert.ok(issues.includes('image.supportsWatermark is required'));

  const classified = classifyApiKeyModel('openai-compatible', 'future-video-model', { ownedBy: 'xai' });
  assert.equal(classified.modelProviderId, 'openai-compatible');
  assert.equal(classified.discoveryStatus, 'unknown');
});
