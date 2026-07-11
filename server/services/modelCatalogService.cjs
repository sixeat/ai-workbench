const {
  adapterSupportsCapabilities,
  classifyApiKeyModel,
  hasDeclaredOperation,
  isSupportedAdapterId,
  modelSupportsNodeType,
} = require('../modelCatalog.cjs');
const { apiKeyModelRepository: defaultApiKeyModelRepository } = require('../repositories/apiKeyModelRepository.cjs');
const { createPlatformModelService } = require('./platformModelService.cjs');

function response(status, data) {
  return { status, data };
}

function requestContext(req) {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || '',
    userAgent: String(req.headers?.['user-agent'] || '').slice(0, 500),
  };
}

function publicApiKeyModel(model) {
  return {
    id: model.id,
    apiKeyId: model.apiKeyId,
    upstreamModel: model.upstreamModel,
    modelProviderId: model.modelProviderId,
    adapterId: model.adapterId,
    displayName: model.displayName,
    capabilities: model.capabilities || {},
    capabilitySource: model.capabilitySource,
    isEnabled: Boolean(model.isEnabled),
    discoveryStatus: model.discoveryStatus,
    lastSeenAt: model.lastSeenAt,
    apiKey: model.apiKey ? {
      id: model.apiKey.id,
      name: model.apiKey.name,
      providerId: model.apiKey.providerId,
      keyScope: model.apiKey.keyScope,
      allowedCapabilities: model.apiKey.allowedCapabilities || {},
      isEnabled: model.apiKey.isEnabled,
    } : undefined,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

function createModelCatalogService({
  discoverModels,
  getRequestUserId = (req) => req.authUser?.id || 'local-user',
  modelRepository = defaultApiKeyModelRepository,
  platformModelRepository,
} = {}) {
  const platformModelService = createPlatformModelService({ repository: platformModelRepository });

  function enrichLegacyModel(model) {
    if (
      !model
      || model.discoveryStatus === 'missing'
      || model.capabilitySource === 'manual'
      || (hasDeclaredOperation(model.capabilities) && model.adapterId)
    ) return model;
    const classification = classifyApiKeyModel(
      model.modelProviderId || model.apiKey?.providerId,
      model.upstreamModel,
      {},
      model
    );
    if (classification.discoveryStatus !== 'active') {
      if (model.capabilitySource !== 'legacy') return model;
      return modelRepository.upsertApiKeyModel({
        ...model,
        adapterId: '',
        capabilities: {},
        capabilitySource: classification.capabilitySource,
        discoveryStatus: 'unknown',
        isEnabled: false,
        modelProviderId: classification.modelProviderId,
      });
    }
    return modelRepository.upsertApiKeyModel({
      ...model,
      adapterId: classification.adapterId,
      capabilities: classification.capabilities,
      capabilitySource: classification.capabilitySource,
      discoveryStatus: classification.discoveryStatus,
      modelProviderId: classification.modelProviderId,
    });
  }

  function keyForRequest(req) {
    const userId = getRequestUserId(req);
    const key = modelRepository.getApiKeyForUser(req.params.apiKeyId, userId, false);
    if (!key) return { error: response(404, { error: 'API key not found' }) };
    if (key.keyScope === 'server' && req.authUser?.role !== 'admin') {
      return { error: response(403, { error: 'Admin access is required for server key models.' }) };
    }
    return { key, userId };
  }

  function listKeyModels(req) {
    const access = keyForRequest(req);
    if (access.error) return access.error;
    const models = modelRepository.listApiKeyModels(access.key.id, {
      includeDisabled: true,
      includeMissing: true,
      search: req.query?.search || '',
    }).map(enrichLegacyModel);
    return response(200, { models: models.map(publicApiKeyModel), count: models.length });
  }

  async function discoverKeyModels(req) {
    const access = keyForRequest(req);
    if (access.error) return access.error;
    if (!discoverModels) return response(501, { error: 'Model discovery is not configured.' });

    const discovery = await discoverModels({
      req,
      userId: access.userId,
      apiKeyId: access.key.id,
      providerId: access.key.providerId,
    });
    const seenAt = new Date().toISOString();
    const seenModels = discovery.models.map((item) => String(item.id || '').trim()).filter(Boolean);
    const existingModels = new Map(
      modelRepository
        .listApiKeyModels(access.key.id, { includeDisabled: true, includeMissing: true })
        .map((model) => [model.upstreamModel, model])
    );

    for (const item of discovery.models) {
      const upstreamModel = String(item.id || '').trim();
      if (!upstreamModel) continue;
      const existing = existingModels.get(upstreamModel) || null;
      const classification = classifyApiKeyModel(access.key.providerId, upstreamModel, item, existing);
      modelRepository.upsertApiKeyModel({
        id: existing?.id,
        apiKeyId: access.key.id,
        upstreamModel,
        modelProviderId: classification.modelProviderId,
        adapterId: classification.adapterId,
        displayName: existing?.displayName || upstreamModel,
        capabilities: classification.capabilities,
        capabilitySource: classification.capabilitySource,
        isEnabled: existing?.isEnabled || false,
        discoveryStatus: classification.discoveryStatus,
        rawMetadata: {
          ownedBy: item.ownedBy || '',
          source: discovery.source,
        },
        lastSeenAt: seenAt,
        createdAt: existing?.createdAt,
      });
    }
    modelRepository.markApiKeyModelsMissing(access.key.id, seenModels, seenAt);
    modelRepository.createAuditLog({
      action: 'api_key_models.discover',
      actorUserId: req.authUser?.id || access.userId,
      targetType: 'api_key',
      targetId: access.key.id,
      metadata: { discovered: seenModels.length, providerId: access.key.providerId, source: discovery.source },
      ...requestContext(req),
    });

    return listKeyModels(req);
  }

  function updateKeyModel(req) {
    const access = keyForRequest(req);
    if (access.error) return access.error;
    const existing = modelRepository.getApiKeyModel(req.params.apiKeyModelId);
    if (!existing || existing.apiKeyId !== access.key.id) return response(404, { error: 'API key model not found' });
    const body = req.body || {};
    const capabilities = body.capabilities && typeof body.capabilities === 'object' && !Array.isArray(body.capabilities)
      ? body.capabilities
      : existing.capabilities;
    const modelProviderId = String(body.modelProviderId || existing.modelProviderId || access.key.providerId).trim();
    const adapterId = String(body.adapterId ?? existing.adapterId).trim();
    const isEnabled = body.isEnabled === undefined ? existing.isEnabled : Boolean(body.isEnabled);
    if (isEnabled && existing.discoveryStatus === 'missing') {
      return response(409, { error: 'A missing upstream model cannot be enabled.' });
    }
    if (adapterId && !isSupportedAdapterId(adapterId)) {
      return response(400, { error: 'adapterId is not supported.' });
    }
    if (isEnabled && (!hasDeclaredOperation(capabilities) || !adapterId)) {
      return response(409, { error: 'Declare model capabilities and an adapter before enabling this model.' });
    }
    if (isEnabled && !adapterSupportsCapabilities(adapterId, capabilities)) {
      return response(409, { error: 'The selected adapter does not support the declared model operation.' });
    }

    const model = modelRepository.upsertApiKeyModel({
      ...existing,
      modelProviderId,
      adapterId,
      displayName: String(body.displayName ?? existing.displayName).trim() || existing.upstreamModel,
      capabilities,
      capabilitySource: body.capabilities ? 'manual' : existing.capabilitySource,
      isEnabled,
      discoveryStatus: existing.discoveryStatus === 'unknown' && hasDeclaredOperation(capabilities) && adapterId
        ? 'active'
        : existing.discoveryStatus,
    });
    modelRepository.createAuditLog({
      action: 'api_key_model.update',
      actorUserId: req.authUser?.id || access.userId,
      targetType: 'api_key_model',
      targetId: model.id,
      metadata: { apiKeyId: access.key.id, isEnabled: model.isEnabled, upstreamModel: model.upstreamModel },
      ...requestContext(req),
    });
    return response(200, { model: publicApiKeyModel(model) });
  }

  function listCatalog(req) {
    const userId = getRequestUserId(req);
    const nodeType = String(req.query?.nodeType || '').trim();
    const personalModels = modelRepository
      .listUserApiKeyModels(userId, { includeDisabled: false, includeMissing: false })
      .map(enrichLegacyModel)
      .filter((model) => !nodeType || modelSupportsNodeType(model, nodeType))
      .map(publicApiKeyModel);
    const platformResponse = platformModelService.listPublicPlatformModels({ query: req.query || {} });
    const platformModels = platformResponse.data.models.filter((model) => !nodeType || modelSupportsNodeType(model, nodeType));
    return response(200, {
      personalModels,
      platformModels,
      count: personalModels.length + platformModels.length,
    });
  }

  return {
    discoverKeyModels,
    listCatalog,
    listKeyModels,
    updateKeyModel,
  };
}

module.exports = {
  createModelCatalogService,
  publicApiKeyModel,
};
