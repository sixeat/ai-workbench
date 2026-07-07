const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-credential-service-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const { db } = require('./db.cjs');
const { createCredentialService, credentialUsageError } = require('./services/credentialService.cjs');

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('direct credentials do not send server key to a user supplied baseUrl', () => {
  const service = createCredentialService({
    keyEncryptionSecret: '0123456789abcdef0123456789abcdef',
  });

  assert.deepEqual(
    service.resolveDirectCredentials(
      { baseUrl: 'https://attacker.example' },
      { baseUrl: 'https://trusted.example', apiKey: 'server-secret' }
    ),
    { baseUrl: 'https://attacker.example', apiKey: '' }
  );

  assert.deepEqual(
    service.resolveDirectCredentials(
      {},
      { baseUrl: 'https://trusted.example', apiKey: 'server-secret' }
    ),
    { baseUrl: 'https://trusted.example', apiKey: 'server-secret' }
  );
});

test('server mode rejects direct request credentials by default', async () => {
  const service = createCredentialService({
    keyEncryptionSecret: '0123456789abcdef0123456789abcdef',
    deploymentMode: 'server',
  });

  await assert.rejects(
    () => service.resolveApiCredentials({
      userId: 'local-user',
      body: { baseUrl: 'https://example.test', apiKey: 'direct-key' },
      secrets: {},
    }),
    /Direct API credentials are disabled/
  );

  assert.throws(
    () => service.resolveDirectCredentials(
      { baseUrl: 'https://example.test' },
      { baseUrl: 'https://trusted.example', apiKey: 'server-secret' }
    ),
    /Direct API credentials are disabled/
  );
});

test('server mode can explicitly allow direct request credentials for migration', async () => {
  const service = createCredentialService({
    keyEncryptionSecret: '0123456789abcdef0123456789abcdef',
    deploymentMode: 'server',
    allowDirectCredentials: true,
  });

  assert.deepEqual(
    await service.resolveApiCredentials({
      userId: 'local-user',
      body: { baseUrl: 'https://example.test', apiKey: 'direct-key' },
      secrets: {},
    }),
    {
      baseUrl: 'https://example.test',
      apiKey: 'direct-key',
      providerId: 'openai-compatible',
      keyScope: 'user',
    }
  );
});

test('saved server keys cannot be used directly without a platform model', async () => {
  const service = createCredentialService({
    apiKeyRepository: {
      getApiKeyForUser: () => ({
        id: 'server-key',
        keyScope: 'server',
        encryptedKey: '',
        isEnabled: true,
        ownerUserId: 'local-user',
      }),
    },
    keyEncryptionSecret: '0123456789abcdef0123456789abcdef',
  });

  await assert.rejects(
    () => service.resolveApiCredentials({
      userId: 'ordinary-user',
      body: { apiKeyId: 'server-key' },
      secrets: {},
    }),
    /Server API keys must be used through a platform model/
  );
});

test('saved server keys can be resolved only for internal admin test flows', async () => {
  let encryptedKey = '';
  const service = createCredentialService({
    apiKeyRepository: {
      getApiKeyForUser: () => ({
        id: 'server-key',
        keyScope: 'server',
        providerId: 'openai-compatible',
        baseUrl: 'https://api.example.com',
        encryptedKey,
        isEnabled: true,
        ownerUserId: 'local-user',
      }),
    },
    keyEncryptionSecret: '0123456789abcdef0123456789abcdef',
  });
  encryptedKey = service.encryptSecret('sk-server');

  const credentials = await service.resolveApiCredentials({
    userId: 'admin-user',
    body: {
      allowServerApiKeyDirect: true,
      apiKeyId: 'server-key',
      providerId: 'openai-compatible',
    },
    secrets: {},
  });

  assert.equal(credentials.apiKey, 'sk-server');
  assert.equal(credentials.keyScope, 'server');
  assert.equal(credentials.providerId, 'openai-compatible');
});

test('saved user keys can still be used directly by their owner', async () => {
  let encryptedKey = '';
  const service = createCredentialService({
    apiKeyRepository: {
      getApiKeyForUser: () => ({
        id: 'user-key',
        keyScope: 'user',
        providerId: 'openai-compatible',
        baseUrl: 'https://api.example.com',
        encryptedKey,
        isEnabled: true,
        ownerUserId: 'ordinary-user',
      }),
    },
    keyEncryptionSecret: '0123456789abcdef0123456789abcdef',
  });
  encryptedKey = service.encryptSecret('sk-user');

  const credentials = await service.resolveApiCredentials({
    userId: 'ordinary-user',
    body: { apiKeyId: 'user-key' },
    secrets: {},
  });

  assert.equal(credentials.apiKey, 'sk-user');
  assert.equal(credentials.keyScope, 'user');
  assert.equal(credentials.providerId, 'openai-compatible');
});

test('credential usage policy blocks disabled capabilities and unlisted models', () => {
  assert.equal(
    credentialUsageError({
      allowedCapabilities: { chat: true, imageGeneration: false },
      models: ['text-model'],
    }, 'imageGeneration', 'text-model'),
    'This API key is not enabled for this node capability.'
  );

  assert.equal(
    credentialUsageError({
      allowedCapabilities: { chat: true },
      models: ['text-model'],
    }, 'videoGeneration', 'text-model'),
    'This API key is not enabled for this node capability.'
  );

  assert.equal(
    credentialUsageError({
      allowedCapabilities: { chat: true },
      models: ['text-model'],
    }, 'chat', 'other-model'),
    'This API key is not enabled for the selected model.'
  );

  assert.equal(
    credentialUsageError({
      allowedCapabilities: { chat: true },
      models: ['text-model'],
    }, 'chat', 'text-model'),
    ''
  );

  assert.equal(
    credentialUsageError({}, 'imageGeneration', 'any-model'),
    ''
  );
});

test('platform model credentials resolve enabled server routes with fallback credentials', async () => {
  let encryptedPrimaryKey = '';
  let encryptedFallbackKey = '';
  const platformModelRepository = {
    getPlatformModel: (id) => id === 'platform-image' ? {
      id: 'platform-image',
      displayName: '平台图片 2.0',
      capability: 'imageGeneration',
      model: 'image2.0',
      isEnabled: true,
    } : null,
    listPlatformModelRoutes: () => [
      {
        id: 'route-primary',
        platformModelId: 'platform-image',
        apiKeyId: 'server-key-primary',
        providerId: 'aliyun-bailian',
        upstreamModel: 'wanx2.1-t2i-turbo',
        priority: 1,
        isEnabled: true,
      },
      {
        id: 'route-fallback',
        platformModelId: 'platform-image',
        apiKeyId: 'server-key-fallback',
        providerId: 'openai-compatible',
        upstreamModel: 'gpt-image-1',
        priority: 2,
        isEnabled: true,
      },
      {
        id: 'route-user-key',
        platformModelId: 'platform-image',
        apiKeyId: 'user-key',
        providerId: 'openai-compatible',
        upstreamModel: 'should-not-use',
        priority: 3,
        isEnabled: true,
      },
    ],
  };
  const apiKeyRepository = {
    getApiKey: (id) => ({
      'server-key-primary': {
        id,
        keyScope: 'server',
        providerId: 'aliyun-bailian',
        baseUrl: 'https://dashscope.aliyuncs.com',
        encryptedKey: encryptedPrimaryKey,
        isEnabled: true,
      },
      'server-key-fallback': {
        id,
        keyScope: 'server',
        providerId: 'openai-compatible',
        baseUrl: 'https://api.openai.example',
        encryptedKey: encryptedFallbackKey,
        isEnabled: true,
      },
      'user-key': {
        id,
        keyScope: 'user',
        providerId: 'openai-compatible',
        baseUrl: 'https://user.example',
        encryptedKey: encryptedFallbackKey,
        isEnabled: true,
      },
    }[id] || null),
  };
  const service = createCredentialService({
    apiKeyRepository,
    keyEncryptionSecret: '0123456789abcdef0123456789abcdef',
    platformModelRepository,
  });
  encryptedPrimaryKey = service.encryptSecret('sk-primary');
  encryptedFallbackKey = service.encryptSecret('sk-fallback');

  const credentials = await service.resolveApiCredentials({
    userId: 'ordinary-user',
    body: { platformModelId: 'platform-image' },
    secrets: {},
  });

  assert.equal(credentials.apiKey, 'sk-primary');
  assert.equal(credentials.apiKeyId, 'server-key-primary');
  assert.equal(credentials.baseUrl, 'https://dashscope.aliyuncs.com');
  assert.equal(credentials.keyScope, 'server');
  assert.equal(credentials.model, 'wanx2.1-t2i-turbo');
  assert.equal(credentials.platformModelId, 'platform-image');
  assert.equal(credentials.platformRouteId, 'route-primary');
  assert.equal(credentials.fallbackCredentials.length, 1);
  assert.equal(credentials.fallbackCredentials[0].apiKey, 'sk-fallback');
  assert.equal(credentials.fallbackCredentials[0].platformRouteId, 'route-fallback');
});

test('platform model credentials reject disabled models and models without enabled server routes', async () => {
  const service = createCredentialService({
    apiKeyRepository: {
      getApiKey: () => ({
        id: 'disabled-key',
        keyScope: 'server',
        encryptedKey: '',
        isEnabled: false,
      }),
    },
    keyEncryptionSecret: '0123456789abcdef0123456789abcdef',
    platformModelRepository: {
      getPlatformModel: (id) => ({
        id,
        displayName: '平台模型',
        capability: 'chat',
        model: 'text1.0',
        isEnabled: id !== 'disabled-model',
      }),
      listPlatformModelRoutes: () => [
        {
          id: 'disabled-route',
          apiKeyId: 'disabled-key',
          isEnabled: true,
        },
      ],
    },
  });

  await assert.rejects(
    () => service.resolveApiCredentials({
      userId: 'ordinary-user',
      body: { platformModelId: 'disabled-model' },
      secrets: {},
    }),
    /Platform model is not available/
  );

  await assert.rejects(
    () => service.resolveApiCredentials({
      userId: 'ordinary-user',
      body: { platformModelId: 'enabled-model' },
      secrets: {},
    }),
    /Platform model has no enabled server route/
  );
});
