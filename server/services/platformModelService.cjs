const { platformModelRepository: defaultPlatformModelRepository } = require('../repositories/platformModelRepository.cjs');
const { BASE_CAPABILITIES, resolveModelCapabilitiesDetailed } = require('../modelCapabilities.cjs');

const PLATFORM_MODEL_CAPABILITIES = new Set(['chat', 'imageGeneration', 'videoGeneration']);

function requestIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function requestUserAgent(req) {
  return String(req.headers?.['user-agent'] || '').slice(0, 500);
}

function response(status, data) {
  return { status, data };
}

function normalizeCapability(value) {
  const capability = String(value || '').trim();
  return PLATFORM_MODEL_CAPABILITIES.has(capability) ? capability : '';
}

function normalizeCapabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function hasCapabilities(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
}

function mergeCapabilities(base, patch) {
  const baseImage = base?.image && typeof base.image === 'object' && !Array.isArray(base.image) ? base.image : {};
  const patchImage = patch?.image && typeof patch.image === 'object' && !Array.isArray(patch.image) ? patch.image : {};
  const baseVideo = base?.video && typeof base.video === 'object' && !Array.isArray(base.video) ? base.video : {};
  const patchVideo = patch?.video && typeof patch.video === 'object' && !Array.isArray(patch.video) ? patch.video : {};

  return {
    ...base,
    ...patch,
    image: {
      ...baseImage,
      ...patchImage,
    },
    video: {
      ...baseVideo,
      ...patchVideo,
    },
  };
}

function capabilityFallback(capability) {
  if (capability === 'imageGeneration') {
    return mergeCapabilities(BASE_CAPABILITIES, { chat: false, imageGeneration: true, videoGeneration: false });
  }
  if (capability === 'videoGeneration') {
    return mergeCapabilities(BASE_CAPABILITIES, { chat: false, imageGeneration: false, videoGeneration: true });
  }
  if (capability === 'chat') {
    return mergeCapabilities(BASE_CAPABILITIES, { chat: true, imageGeneration: false, videoGeneration: false });
  }
  return { ...BASE_CAPABILITIES };
}

function inferredRouteCapabilityResult(repository, model) {
  const route = repository
    .listPlatformModelRoutes(model.id, { includeDisabled: false })
    .find((item) => item.isEnabled && item.apiKey?.isEnabled !== false);
  if (!route) {
    return {
      capabilities: capabilityFallback(model.capability),
      source: 'fallback',
      warnings: ['No enabled route is available; using capability fallback.'],
    };
  }

  const providerId = route.providerId || route.apiKey?.providerId || '';
  const upstreamModel = route.upstreamModel || model.model || '';
  if (!providerId || !upstreamModel) {
    return {
      capabilities: capabilityFallback(model.capability),
      source: 'fallback',
      warnings: ['Route is missing provider or upstream model; using capability fallback.'],
    };
  }

  const resolved = resolveModelCapabilitiesDetailed(providerId, upstreamModel);
  return {
    capabilities: resolved.capabilities,
    matchedRules: resolved.matchedRules,
    source: resolved.source === 'matched-rules' ? 'route-inferred' : 'fallback',
    warnings: resolved.source === 'matched-rules'
      ? []
      : [`No capability rule matched ${providerId}/${upstreamModel}; using base fallback.`],
  };
}

function publicPlatformModel(model, repository = defaultPlatformModelRepository) {
  if (!model) return null;
  const inferred = inferredRouteCapabilityResult(repository, model);
  const capabilities = hasCapabilities(model.capabilities)
    ? mergeCapabilities(inferred.capabilities, model.capabilities)
    : inferred.capabilities;
  const capabilitySource = hasCapabilities(model.capabilities)
    ? 'platform-override'
    : inferred.source;
  return {
    id: model.id,
    displayName: model.displayName,
    description: model.description || '',
    capability: model.capability,
    model: model.model,
    capabilities,
    capabilitySource,
    capabilityWarnings: inferred.warnings || [],
    isEnabled: Boolean(model.isEnabled),
    sortOrder: model.sortOrder || 100,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

function publicRoute(route) {
  if (!route) return null;
  return {
    id: route.id,
    platformModelId: route.platformModelId,
    apiKeyId: route.apiKeyId,
    providerId: route.providerId || route.apiKey?.providerId || '',
    upstreamModel: route.upstreamModel || '',
    priority: route.priority || 100,
    isEnabled: Boolean(route.isEnabled),
    apiKey: route.apiKey ? {
      id: route.apiKey.id,
      name: route.apiKey.name,
      providerId: route.apiKey.providerId,
      keyScope: route.apiKey.keyScope,
      isEnabled: Boolean(route.apiKey.isEnabled),
    } : undefined,
    createdAt: route.createdAt,
    updatedAt: route.updatedAt,
  };
}

function adminPlatformModel(repository, model) {
  const publicModel = publicPlatformModel(model, repository);
  if (!publicModel) return null;
  return {
    ...publicModel,
    capabilityOverrides: normalizeCapabilities(model.capabilities),
    routes: repository.listPlatformModelRoutes(model.id, { includeDisabled: true }).map(publicRoute),
  };
}

function listQuery(query = {}, includeDisabled = false) {
  return {
    capability: normalizeCapability(query.capability),
    includeDisabled,
    limit: Math.max(1, Math.min(500, Number(query.limit || 100) || 100)),
    offset: Math.max(0, Number(query.offset || 0) || 0),
    search: String(query.search || query.q || '').trim(),
  };
}

function auditLog(repository, req, action, targetId, metadata = {}) {
  repository.createAuditLog({
    action,
    actorUserId: req.authUser?.id || '',
    ipAddress: requestIp(req),
    metadata,
    targetId,
    targetType: 'platform_model',
    userAgent: requestUserAgent(req),
  });
}

function createPlatformModelService({
  repository = defaultPlatformModelRepository,
} = {}) {
  function listPublicPlatformModels(req) {
    const query = listQuery(req.query || {}, false);
    const models = repository.listPlatformModels(query).map((model) => publicPlatformModel(model, repository));
    return response(200, {
      count: models.length,
      limit: query.limit,
      models,
      offset: query.offset,
      total: repository.countPlatformModels(query),
    });
  }

  function listAdminPlatformModels(req) {
    const query = listQuery(req.query || {}, true);
    const models = repository.listPlatformModels(query).map((model) => adminPlatformModel(repository, model));
    return response(200, {
      count: models.length,
      limit: query.limit,
      models,
      offset: query.offset,
      total: repository.countPlatformModels(query),
    });
  }

  function savePlatformModel(req) {
    const body = req.body || {};
    const capability = normalizeCapability(body.capability);
    if (!String(body.displayName || '').trim()) return response(400, { error: 'displayName is required' });
    if (!capability) return response(400, { error: 'capability must be chat, imageGeneration, or videoGeneration' });
    if (!String(body.model || '').trim()) return response(400, { error: 'model is required' });

    const existing = body.id ? repository.getPlatformModel(body.id) : null;
    const model = repository.upsertPlatformModel({
      capabilities: normalizeCapabilities(body.capabilities),
      capability,
      description: String(body.description || '').trim(),
      displayName: String(body.displayName || '').trim(),
      id: body.id,
      isEnabled: body.isEnabled !== false,
      model: String(body.model || '').trim(),
      sortOrder: Number(body.sortOrder || 100) || 100,
    });
    auditLog(repository, req, existing ? 'platform_model.update' : 'platform_model.create', model.id, {
      capability: model.capability,
      displayName: model.displayName,
      isEnabled: model.isEnabled,
    });
    return response(existing ? 200 : 201, { model: adminPlatformModel(repository, model) });
  }

  function deletePlatformModel(req) {
    const existing = repository.getPlatformModel(req.params.platformModelId);
    if (!existing) return response(404, { error: 'Platform model not found' });
    const deleted = repository.deletePlatformModel(existing.id);
    if (!deleted) return response(404, { error: 'Platform model not found' });
    auditLog(repository, req, 'platform_model.delete', existing.id, {
      capability: existing.capability,
      displayName: existing.displayName,
    });
    return response(200, { ok: true });
  }

  function savePlatformModelRoute(req) {
    const platformModel = repository.getPlatformModel(req.params.platformModelId);
    if (!platformModel) return response(404, { error: 'Platform model not found' });
    const body = req.body || {};
    if (!String(body.apiKeyId || '').trim()) return response(400, { error: 'apiKeyId is required' });

    const apiKey = repository.getApiKey(String(body.apiKeyId), false);
    if (!apiKey || apiKey.keyScope !== 'server' || !apiKey.isEnabled) {
      return response(400, { error: 'Platform model routes can only use enabled server keys.' });
    }

    const existing = body.id ? repository.getPlatformModelRoute(body.id) : null;
    if (existing && existing.platformModelId !== platformModel.id) {
      return response(404, { error: 'Platform model route not found' });
    }

    const route = repository.upsertPlatformModelRoute({
      apiKeyId: String(body.apiKeyId).trim(),
      id: body.id,
      isEnabled: body.isEnabled !== false,
      platformModelId: platformModel.id,
      priority: Number(body.priority || 100) || 100,
      providerId: String(body.providerId || apiKey.providerId || '').trim(),
      upstreamModel: String(body.upstreamModel || platformModel.model || '').trim(),
    });
    auditLog(repository, req, existing ? 'platform_model_route.update' : 'platform_model_route.create', platformModel.id, {
      apiKeyId: route.apiKeyId,
      platformModelId: platformModel.id,
      routeId: route.id,
    });
    return response(existing ? 200 : 201, { route: publicRoute(route), model: adminPlatformModel(repository, platformModel) });
  }

  function deletePlatformModelRoute(req) {
    const route = repository.getPlatformModelRoute(req.params.routeId);
    if (!route || route.platformModelId !== req.params.platformModelId) {
      return response(404, { error: 'Platform model route not found' });
    }
    const deleted = repository.deletePlatformModelRoute(route.id);
    if (!deleted) return response(404, { error: 'Platform model route not found' });
    auditLog(repository, req, 'platform_model_route.delete', route.platformModelId, {
      apiKeyId: route.apiKeyId,
      routeId: route.id,
    });
    return response(200, { ok: true });
  }

  return {
    deletePlatformModel,
    deletePlatformModelRoute,
    listAdminPlatformModels,
    listPublicPlatformModels,
    savePlatformModel,
    savePlatformModelRoute,
  };
}

module.exports = {
  PLATFORM_MODEL_CAPABILITIES,
  createPlatformModelService,
  publicPlatformModel,
  publicRoute,
};
