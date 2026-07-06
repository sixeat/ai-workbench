const {
  DEFAULT_USER_ID,
  countApiKeys,
  createAuditLog,
  deleteApiKey,
  getApiKey,
  getApiKeyForUser,
  listApiKeys,
  upsertApiKey,
} = require('../db.cjs');

function listQuery(query = {}, defaults = {}) {
  return {
    limit: Math.max(1, Math.min(500, Number(query.limit || defaults.limit || 100) || defaults.limit || 100)),
    offset: Math.max(0, Number(query.offset || 0) || 0),
    search: query.search || query.q || '',
    providerId: query.providerId || '',
    keyScope: query.keyScope || '',
    status: query.status || '',
  };
}

function requestIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function requestUserAgent(req) {
  return String(req.headers?.['user-agent'] || '').slice(0, 500);
}

function apiKeyQuota(userId, maxUserApiKeys) {
  const userKeyCount = countApiKeys(userId, false, { keyScope: 'user' });
  return {
    userKeyCount,
    maxUserApiKeys,
    remainingUserKeys: Math.max(0, maxUserApiKeys - userKeyCount),
  };
}

function registerApiKeyRoutes(app, context) {
  const {
    encryptSecret,
    getRequestUserId,
    keyBelongsToUser,
    maxUserApiKeys = 20,
    requireAdmin,
    testApiKey,
  } = context;

  function auditLog(req, action, apiKey, metadata = {}) {
    createAuditLog({
      actorUserId: req.authUser?.id || getRequestUserId(req),
      action,
      targetType: 'api_key',
      targetId: apiKey?.id || '',
      ipAddress: requestIp(req),
      userAgent: requestUserAgent(req),
      metadata: {
        keyScope: apiKey?.keyScope,
        providerId: apiKey?.providerId,
        ownerUserId: apiKey?.ownerUserId,
        ...metadata,
      },
    });
  }

  app.get('/api/api-keys', (req, res) => {
    const userId = getRequestUserId(req);
    const query = listQuery(req.query);
    const apiKeys = listApiKeys(userId, true, query);
    res.json({
      apiKeys,
      count: apiKeys.length,
      total: countApiKeys(userId, true, query),
      limit: query.limit,
      offset: query.offset,
      quota: apiKeyQuota(userId, maxUserApiKeys),
    });
  });

  app.post('/api/api-keys', (req, res) => {
    const userId = getRequestUserId(req);
    const body = req.body || {};
    if (!body.providerId) return res.status(400).json({ error: 'providerId is required' });
    if (!body.apiKey) return res.status(400).json({ error: 'apiKey is required' });

    const keyScope = body.keyScope === 'server' ? 'server' : 'user';
    if (keyScope === 'server' && !requireAdmin(req, res)) return;
    const existing = body.id ? getApiKey(body.id, true) : null;
    if (existing && !keyBelongsToUser(existing, userId)) {
      return res.status(404).json({ error: 'API key not found' });
    }
    if (existing?.keyScope === 'server' && !requireAdmin(req, res)) return;
    if (keyScope === 'user' && !existing) {
      const quota = apiKeyQuota(userId, maxUserApiKeys);
      if (quota.userKeyCount >= maxUserApiKeys) {
        return res.status(429).json({
          error: `API key limit reached. You can save up to ${maxUserApiKeys} user keys.`,
          quota,
        });
      }
    }

    const apiKey = upsertApiKey({
      id: body.id,
      ownerUserId: existing?.ownerUserId || (keyScope === 'server' ? DEFAULT_USER_ID : userId),
      keyScope: existing?.keyScope || keyScope,
      providerId: body.providerId,
      name: body.name || body.providerId,
      baseUrl: body.baseUrl || '',
      encryptedKey: encryptSecret(body.apiKey),
      isEnabled: body.isEnabled !== false,
    });

    auditLog(req, existing ? 'api_key.update' : 'api_key.create', apiKey, existing ? {
      changedProvider: body.providerId !== undefined,
      changedName: body.name !== undefined,
      changedBaseUrl: body.baseUrl !== undefined,
      changedSecret: true,
      changedEnabled: body.isEnabled !== undefined,
    } : {});
    res.status(201).json({ apiKey });
  });

  app.patch('/api/api-keys/:apiKeyId', (req, res) => {
    const userId = getRequestUserId(req);
    const existing = getApiKeyForUser(req.params.apiKeyId, userId, true);
    if (!keyBelongsToUser(existing, userId)) return res.status(404).json({ error: 'API key not found' });
    if (existing.keyScope === 'server' && !requireAdmin(req, res)) return;

    const body = req.body || {};
    const apiKey = upsertApiKey({
      id: existing.id,
      ownerUserId: existing.ownerUserId,
      keyScope: existing.keyScope,
      providerId: body.providerId || existing.providerId,
      name: body.name ?? existing.name,
      baseUrl: body.baseUrl ?? existing.baseUrl,
      encryptedKey: body.apiKey ? encryptSecret(body.apiKey) : existing.encryptedKey,
      isEnabled: body.isEnabled ?? existing.isEnabled,
    });

    auditLog(req, 'api_key.update', apiKey, {
      changedProvider: body.providerId !== undefined,
      changedName: body.name !== undefined,
      changedBaseUrl: body.baseUrl !== undefined,
      changedSecret: Boolean(body.apiKey),
      changedEnabled: body.isEnabled !== undefined,
    });
    res.json({ apiKey });
  });

  app.delete('/api/api-keys/:apiKeyId', (req, res) => {
    const userId = getRequestUserId(req);
    const existing = getApiKeyForUser(req.params.apiKeyId, userId, true);
    if (!keyBelongsToUser(existing, userId)) return res.status(404).json({ error: 'API key not found' });
    if (existing.keyScope === 'server' && !requireAdmin(req, res)) return;
    const deleted = deleteApiKey(req.params.apiKeyId, userId);
    if (!deleted) return res.status(404).json({ error: 'API key not found' });
    auditLog(req, 'api_key.delete', existing);
    res.json({ ok: true });
  });

  app.post('/api/api-keys/:apiKeyId/test', async (req, res) => {
    if (!testApiKey) return res.status(501).json({ error: 'API key testing is not configured.' });

    const userId = getRequestUserId(req);
    const existing = getApiKeyForUser(req.params.apiKeyId, userId, true);
    if (!keyBelongsToUser(existing, userId)) return res.status(404).json({ error: 'API key not found' });
    if (existing.keyScope === 'server' && !requireAdmin(req, res)) return;

    try {
      const result = await testApiKey({
        req,
        userId,
        apiKeyId: existing.id,
        providerId: req.body?.providerId || existing.providerId,
        model: req.body?.model || '',
        testText: Boolean(req.body?.testText),
        testImage: Boolean(req.body?.testImage),
        testVideo: Boolean(req.body?.testVideo),
      });
      auditLog(req, 'api_key.test', existing, {
        model: result.selectedModel || '',
        modelsOk: Boolean(result.models?.ok || result.models?.skipped),
        textOk: Boolean(result.tests?.text?.ok),
        imageOk: Boolean(result.tests?.image?.ok),
        videoOk: Boolean(result.tests?.video?.ok),
      });
      res.json({ result });
    } catch (error) {
      auditLog(req, 'api_key.test_failed', existing, {
        message: error?.expose ? error.message : 'API key test failed.',
      });
      const status = Number(error?.status || 500);
      res.status(status >= 400 && status < 600 ? status : 500).json({
        error: error?.expose ? error.message : 'API key test failed.',
      });
    }
  });
}

module.exports = {
  registerApiKeyRoutes,
};
