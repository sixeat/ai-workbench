const {
  DEFAULT_SERVER_KEY_OWNER_USER_ID,
  apiKeyRepository: defaultApiKeyRepository,
} = require('../repositories/apiKeyRepository.cjs');

function listQuery(query = {}, defaults = {}) {
  return {
    keyScope: query.keyScope || '',
    limit: Math.max(1, Math.min(500, Number(query.limit || defaults.limit || 100) || defaults.limit || 100)),
    offset: Math.max(0, Number(query.offset || 0) || 0),
    providerId: query.providerId || '',
    search: query.search || query.q || '',
    status: query.status || '',
  };
}

function requestIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function requestUserAgent(req) {
  return String(req.headers?.['user-agent'] || '').slice(0, 500);
}

function apiKeyQuota(repository, userId, maxUserApiKeys) {
  const userKeyCount = repository.countApiKeys(userId, false, { keyScope: 'user' });
  return {
    maxUserApiKeys,
    remainingUserKeys: Math.max(0, maxUserApiKeys - userKeyCount),
    userKeyCount,
  };
}

function apiKeyUpdateAuditMetadata(existing, next, body = {}) {
  const requestedIsEnabled = body.isEnabled !== undefined ? Boolean(body.isEnabled) : Boolean(existing?.isEnabled);
  const nextProviderId = next?.providerId || body.providerId || existing?.providerId || '';
  return {
    changedBaseUrl: Boolean(body.baseUrl !== undefined && body.baseUrl !== existing?.baseUrl),
    changedEnabled: Boolean(body.isEnabled !== undefined && requestedIsEnabled !== Boolean(existing?.isEnabled)),
    changedName: Boolean(body.name !== undefined && body.name !== existing?.name),
    changedProvider: Boolean(body.providerId !== undefined && body.providerId !== existing?.providerId),
    changedSecret: Boolean(body.apiKey),
    isEnabled: Boolean(next?.isEnabled ?? requestedIsEnabled),
    operation: 'update',
    previousIsEnabled: Boolean(existing?.isEnabled),
    previousProviderId: existing?.providerId || '',
    providerId: nextProviderId,
  };
}

function response(status, data) {
  return { data, status };
}

function notFound() {
  return response(404, { error: 'API key not found' });
}

function createApiKeyManagementService({
  apiKeyRepository = defaultApiKeyRepository,
  encryptSecret,
  getRequestUserId = (req) => req.authUser?.id || 'local-user',
  keyBelongsToUser,
  maxUserApiKeys = 20,
  testApiKey,
}) {
  function auditLog(req, action, apiKey, metadata = {}) {
    apiKeyRepository.createAuditLog({
      action,
      actorUserId: req.authUser?.id || getRequestUserId(req),
      ipAddress: requestIp(req),
      metadata: {
        keyScope: apiKey?.keyScope,
        ownerUserId: apiKey?.ownerUserId,
        providerId: apiKey?.providerId,
        ...metadata,
      },
      targetId: apiKey?.id || '',
      targetType: 'api_key',
      userAgent: requestUserAgent(req),
    });
  }

  function listApiKeys(req) {
    const userId = getRequestUserId(req);
    const query = listQuery(req.query);
    const apiKeys = apiKeyRepository.listApiKeys(userId, true, query);
    return response(200, {
      apiKeys,
      count: apiKeys.length,
      limit: query.limit,
      offset: query.offset,
      quota: apiKeyQuota(apiKeyRepository, userId, maxUserApiKeys),
      total: apiKeyRepository.countApiKeys(userId, true, query),
    });
  }

  function createApiKey(req, { ensureAdmin = () => true } = {}) {
    const userId = getRequestUserId(req);
    const body = req.body || {};
    if (!body.providerId) return response(400, { error: 'providerId is required' });
    if (!body.apiKey) return response(400, { error: 'apiKey is required' });

    const keyScope = body.keyScope === 'server' ? 'server' : 'user';
    if (keyScope === 'server' && !ensureAdmin()) return null;

    const existing = body.id ? apiKeyRepository.getApiKey(body.id, true) : null;
    if (existing && !keyBelongsToUser(existing, userId)) return notFound();
    if (existing?.keyScope === 'server' && !ensureAdmin()) return null;

    if (keyScope === 'user' && !existing) {
      const quota = apiKeyQuota(apiKeyRepository, userId, maxUserApiKeys);
      if (quota.userKeyCount >= maxUserApiKeys) {
        return response(429, {
          error: `API key limit reached. You can save up to ${maxUserApiKeys} user keys.`,
          quota,
        });
      }
    }

    const apiKey = apiKeyRepository.upsertApiKey({
      baseUrl: body.baseUrl || '',
      encryptedKey: encryptSecret(body.apiKey),
      id: body.id,
      isEnabled: body.isEnabled !== false,
      keyScope: existing?.keyScope || keyScope,
      name: body.name || body.providerId,
      ownerUserId: existing?.ownerUserId || (keyScope === 'server' ? DEFAULT_SERVER_KEY_OWNER_USER_ID : userId),
      providerId: body.providerId,
    });

    auditLog(req, existing ? 'api_key.update' : 'api_key.create', apiKey, existing
      ? apiKeyUpdateAuditMetadata(existing, apiKey, body)
      : { operation: 'create' });
    return response(201, { apiKey });
  }

  function updateApiKey(req, { ensureAdmin = () => true } = {}) {
    const userId = getRequestUserId(req);
    const existing = apiKeyRepository.getApiKeyForUser(req.params.apiKeyId, userId, true);
    if (!keyBelongsToUser(existing, userId)) return notFound();
    if (existing.keyScope === 'server' && !ensureAdmin()) return null;

    const body = req.body || {};
    const apiKey = apiKeyRepository.upsertApiKey({
      baseUrl: body.baseUrl ?? existing.baseUrl,
      encryptedKey: body.apiKey ? encryptSecret(body.apiKey) : existing.encryptedKey,
      id: existing.id,
      isEnabled: body.isEnabled ?? existing.isEnabled,
      keyScope: existing.keyScope,
      name: body.name ?? existing.name,
      ownerUserId: existing.ownerUserId,
      providerId: body.providerId || existing.providerId,
    });

    auditLog(req, 'api_key.update', apiKey, apiKeyUpdateAuditMetadata(existing, apiKey, body));
    return response(200, { apiKey });
  }

  function deleteApiKey(req, { ensureAdmin = () => true } = {}) {
    const userId = getRequestUserId(req);
    const existing = apiKeyRepository.getApiKeyForUser(req.params.apiKeyId, userId, true);
    if (!keyBelongsToUser(existing, userId)) return notFound();
    if (existing.keyScope === 'server' && !ensureAdmin()) return null;

    const deleted = apiKeyRepository.deleteApiKey(req.params.apiKeyId, userId);
    if (!deleted) return notFound();

    auditLog(req, 'api_key.delete', existing);
    return response(200, { ok: true });
  }

  async function testSavedApiKey(req, { ensureAdmin = () => true } = {}) {
    if (!testApiKey) return response(501, { error: 'API key testing is not configured.' });

    const userId = getRequestUserId(req);
    const existing = apiKeyRepository.getApiKeyForUser(req.params.apiKeyId, userId, true);
    if (!keyBelongsToUser(existing, userId)) return notFound();
    if (existing.keyScope === 'server' && !ensureAdmin()) return null;

    try {
      const result = await testApiKey({
        apiKeyId: existing.id,
        model: req.body?.model || '',
        providerId: req.body?.providerId || existing.providerId,
        req,
        testImage: Boolean(req.body?.testImage),
        testText: Boolean(req.body?.testText),
        testVideo: Boolean(req.body?.testVideo),
        userId,
      });
      auditLog(req, 'api_key.test', existing, {
        imageOk: Boolean(result.tests?.image?.ok),
        model: result.selectedModel || '',
        modelsOk: Boolean(result.models?.ok || result.models?.skipped),
        textOk: Boolean(result.tests?.text?.ok),
        videoOk: Boolean(result.tests?.video?.ok),
      });
      return response(200, { result });
    } catch (error) {
      auditLog(req, 'api_key.test_failed', existing, {
        message: error?.expose ? error.message : 'API key test failed.',
      });
      const status = Number(error?.status || 500);
      return response(status >= 400 && status < 600 ? status : 500, {
        error: error?.expose ? error.message : 'API key test failed.',
      });
    }
  }

  return {
    createApiKey,
    deleteApiKey,
    listApiKeys,
    testSavedApiKey,
    updateApiKey,
  };
}

module.exports = {
  apiKeyQuota,
  apiKeyUpdateAuditMetadata,
  createApiKeyManagementService,
  listQuery,
};
