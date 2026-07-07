const { createCipheriv, createDecipheriv, scryptSync, randomBytes } = require('crypto');
const { apiKeyRepository: defaultApiKeyRepository } = require('../repositories/apiKeyRepository.cjs');
const { platformModelRepository: defaultPlatformModelRepository } = require('../repositories/platformModelRepository.cjs');

function createCredentialService({
  keyEncryptionSecret,
  deploymentMode = 'local',
  allowDirectCredentials = false,
  apiKeyRepository = defaultApiKeyRepository,
  platformModelRepository = defaultPlatformModelRepository,
}) {
  function directCredentialsAllowed() {
    return deploymentMode !== 'server' || allowDirectCredentials;
  }

  function assertDirectCredentialsAllowed() {
    if (directCredentialsAllowed()) return;
    throw Object.assign(
      new Error('Direct API credentials are disabled in server mode. Save the key first and call with apiKeyId.'),
      { status: 400, expose: true }
    );
  }

  function encryptionKey() {
    return scryptSync(keyEncryptionSecret, 'ai-workbench-key-encryption-v1', 32);
  }

  function encryptSecret(value) {
    if (!value) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  function decryptSecret(value) {
    if (!value) return '';
    const [version, ivText, tagText, encryptedText] = String(value).split(':');
    if (version !== 'v1') return '';
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  function keyBelongsToUser(apiKey, userId) {
    return apiKey && (apiKey.ownerUserId === userId || apiKey.keyScope === 'server');
  }

  function keyCanBeUsedByUser(apiKey, userId) {
    return keyBelongsToUser(apiKey, userId) && apiKey.isEnabled;
  }

  function publicCredentialPolicy(stored) {
    return {
      allowedCapabilities: stored?.allowedCapabilities || {},
      models: Array.isArray(stored?.models) ? stored.models : [],
    };
  }

  function routeCredential(route, apiKey, platformModel, body = {}, secrets = {}) {
    const providerId = route.providerId || apiKey.providerId || body.providerId || 'openai-compatible';
    return {
      ...publicCredentialPolicy(apiKey),
      apiKey: decryptSecret(apiKey.encryptedKey),
      apiKeyId: apiKey.id,
      baseUrl: apiKey.baseUrl || secrets.baseUrl || '',
      keyScope: 'server',
      model: route.upstreamModel || platformModel.model || body.model || '',
      platformModel: {
        id: platformModel.id,
        displayName: platformModel.displayName,
        capability: platformModel.capability,
        model: platformModel.model,
      },
      platformModelId: platformModel.id,
      platformRouteId: route.id,
      providerId,
    };
  }

  function resolvePlatformCredentials({ body = {}, secrets = {} }) {
    const platformModelId = String(body.platformModelId || '').trim();
    if (!platformModelId) return null;
    const platformRouteId = String(body.platformRouteId || '').trim();

    const platformModel = platformModelRepository.getPlatformModel(platformModelId);
    if (!platformModel || !platformModel.isEnabled) {
      throw Object.assign(new Error('Platform model is not available.'), { status: 404, expose: true });
    }

    const routes = platformModelRepository
      .listPlatformModelRoutes(platformModel.id, { includeDisabled: false })
      .filter((route) => !platformRouteId || route.id === platformRouteId)
      .map((route) => {
        const apiKey = apiKeyRepository.getApiKey(route.apiKeyId, true);
        return { apiKey, route };
      })
      .filter(({ apiKey }) => apiKey?.keyScope === 'server' && apiKey.isEnabled);

    if (routes.length === 0) {
      throw Object.assign(new Error('Platform model has no enabled server route.'), { status: 503, expose: true });
    }

    const credentials = routes.map(({ apiKey, route }) => routeCredential(route, apiKey, platformModel, body, secrets));
    return {
      ...credentials[0],
      fallbackCredentials: credentials.slice(1),
    };
  }

  async function resolveApiCredentials({ userId, body, secrets }) {
    const platformCredentials = resolvePlatformCredentials({ userId, body, secrets });
    if (platformCredentials) return platformCredentials;

    if (body.apiKeyId) {
      const stored = apiKeyRepository.getApiKeyForUser(body.apiKeyId, userId, true);
      if (stored?.keyScope === 'server' && !body.allowServerApiKeyDirect) {
        throw Object.assign(new Error('Server API keys must be used through a platform model.'), { status: 403, expose: true });
      }
      if (!keyCanBeUsedByUser(stored, userId)) {
        throw Object.assign(new Error('API key is not available for this user.'), { status: 403 });
      }
      return {
        ...publicCredentialPolicy(stored),
        baseUrl: stored.baseUrl || secrets.baseUrl || '',
        apiKey: decryptSecret(stored.encryptedKey),
        providerId: body.providerId || stored.providerId || 'openai-compatible',
        keyScope: stored.keyScope,
      };
    }

    if (body.apiKey) {
      assertDirectCredentialsAllowed();
      return {
        baseUrl: body.baseUrl || '',
        apiKey: body.apiKey,
        providerId: body.providerId || 'openai-compatible',
        keyScope: 'user',
      };
    }

    return {
      baseUrl: secrets.baseUrl || '',
      apiKey: secrets.apiKey || '',
      providerId: body.providerId || 'openai-compatible',
      keyScope: 'server',
    };
  }

  function resolveDirectCredentials(body, secrets) {
    if (body.apiKey) {
      assertDirectCredentialsAllowed();
      return {
        baseUrl: body.baseUrl || '',
        apiKey: body.apiKey,
      };
    }

    if (body.baseUrl && body.baseUrl !== secrets.baseUrl) {
      assertDirectCredentialsAllowed();
      return {
        baseUrl: body.baseUrl,
        apiKey: '',
      };
    }

    return {
      baseUrl: secrets.baseUrl || '',
      apiKey: secrets.apiKey || '',
    };
  }

  return {
    decryptSecret,
    encryptSecret,
    keyBelongsToUser,
    resolveApiCredentials,
    resolveDirectCredentials,
  };
}

function credentialUsageError(credentials = {}, capabilityKey, model) {
  const capabilities = credentials.allowedCapabilities || {};
  if (Object.keys(capabilities).length > 0 && capabilities[capabilityKey] !== true) {
    return 'This API key is not enabled for this node capability.';
  }

  const models = Array.isArray(credentials.models)
    ? credentials.models.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (models.length > 0 && model && !models.includes(String(model))) {
    return 'This API key is not enabled for the selected model.';
  }

  return '';
}

module.exports = {
  createCredentialService,
  credentialUsageError,
};
