const { platformModelRepository: defaultPlatformModelRepository } = require('../repositories/platformModelRepository.cjs');
const { BASE_CAPABILITIES, resolveModelCapabilitiesDetailed } = require('../modelCapabilities.cjs');
const {
  adapterIdForModel,
  adapterSupportsCapabilities,
  capabilityContractIssues,
  keyAllowsCapability,
} = require('../modelCatalog.cjs');

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

function normalizeModelList(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
}

function hasCapabilities(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
}

function offeringCapabilities(offering, fallbackProviderId = '', fallbackModel = '') {
  if (hasCapabilities(offering?.capabilities)) return offering.capabilities;
  const providerId = offering?.modelProviderId || fallbackProviderId;
  const upstreamModel = offering?.upstreamModel || fallbackModel;
  if (!providerId || !upstreamModel) return {};
  return resolveModelCapabilitiesDetailed(providerId, upstreamModel).capabilities;
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

function alignCapabilitiesToPlatformCapability(capabilities, capability) {
  if (capability === 'imageGeneration') {
    return mergeCapabilities(capabilities, { chat: false, imageGeneration: true, videoGeneration: false });
  }
  if (capability === 'videoGeneration') {
    return mergeCapabilities(capabilities, {
      chat: false,
      imageGeneration: false,
      imageReference: false,
      multiImageReference: false,
      videoGeneration: true,
    });
  }
  if (capability === 'chat') {
    return mergeCapabilities(capabilities, {
      chat: true,
      imageGeneration: false,
      imageReference: false,
      multiImageReference: false,
      videoGeneration: false,
    });
  }
  return capabilities;
}

function keySupportsPlatformContract(apiKey, capability, contract = {}) {
  if (!keyAllowsCapability(apiKey, capability)) return false;
  if (contract.imageReference && !keyAllowsCapability(apiKey, 'imageReference')) return false;
  if (contract.multiImageReference && !keyAllowsCapability(apiKey, 'multiImageReference')) return false;
  return true;
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

  const routeCapabilities = offeringCapabilities(route.apiKeyModel, providerId, upstreamModel);
  const resolved = resolveModelCapabilitiesDetailed(providerId, upstreamModel);
  const hasModelInstanceCapabilities = hasCapabilities(route.apiKeyModel?.capabilities);
  return {
    capabilities: alignCapabilitiesToPlatformCapability(
      hasCapabilities(routeCapabilities) ? routeCapabilities : resolved.capabilities,
      model.capability
    ),
    matchedRules: resolved.matchedRules,
    source: hasModelInstanceCapabilities || resolved.source === 'matched-rules' ? 'route-inferred' : 'fallback',
    warnings: hasModelInstanceCapabilities || resolved.source === 'matched-rules'
      ? []
      : [`No capability rule matched ${providerId}/${upstreamModel}; using base fallback.`],
  };
}

function isUsablePlatformRoute(route, platformModel = null) {
  const routeCapabilities = offeringCapabilities(
    route?.apiKeyModel,
    route?.providerId || route?.apiKey?.providerId,
    route?.upstreamModel
  );
  const adapterId = route?.apiKeyModel?.adapterId
    || adapterIdForModel(route?.apiKeyModel?.modelProviderId || route?.providerId || route?.apiKey?.providerId, routeCapabilities);
  const platformCapabilitySupported = !platformModel?.capability || routeCapabilities[platformModel.capability] === true;
  const contract = hasCapabilities(platformModel?.capabilities) ? platformModel.capabilities : {};
  const contractSupported = !hasCapabilities(contract) || capabilityContractIssues(routeCapabilities, contract).length === 0;
  return Boolean(
    route?.isEnabled &&
    route.apiKey?.isEnabled !== false &&
    route.apiKey?.keyScope === 'server' &&
    route.apiKeyModel?.id &&
    route.apiKeyModel.isEnabled &&
    route.apiKeyModel.discoveryStatus !== 'missing' &&
    adapterSupportsCapabilities(adapterId, routeCapabilities) &&
    platformCapabilitySupported &&
    contractSupported &&
    keySupportsPlatformContract(route.apiKey, platformModel?.capability, contract)
  );
}

function hasUsablePlatformRoute(repository, model) {
  return repository
    .listPlatformModelRoutes(model.id, { includeDisabled: false })
    .some((route) => isUsablePlatformRoute(route, model));
}

function publicPlatformModel(model, repository = defaultPlatformModelRepository) {
  if (!model) return null;
  const inferred = inferredRouteCapabilityResult(repository, model);
  const capabilities = alignCapabilitiesToPlatformCapability(
    hasCapabilities(model.capabilities)
      ? model.capabilities
      : inferred.capabilities,
    model.capability
  );
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
    apiKeyModelId: route.apiKeyModelId || '',
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
    apiKeyModel: route.apiKeyModel ? {
      id: route.apiKeyModel.id,
      upstreamModel: route.apiKeyModel.upstreamModel,
      modelProviderId: route.apiKeyModel.modelProviderId,
      adapterId: route.apiKeyModel.adapterId || adapterIdForModel(route.apiKeyModel.modelProviderId, route.apiKeyModel.capabilities),
      displayName: route.apiKeyModel.displayName,
      capabilities: route.apiKeyModel.capabilities || {},
      capabilitySource: route.apiKeyModel.capabilitySource,
      isEnabled: route.apiKeyModel.isEnabled,
      discoveryStatus: route.apiKeyModel.discoveryStatus,
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

function findRouteByKeyAndUpstreamModel(repository, apiKeyId, upstreamModel) {
  const query = { includeDisabled: true, limit: 500, offset: 0 };
  const total = repository.countPlatformModels(query);
  let offset = 0;
  while (offset < total) {
    const models = repository.listPlatformModels({ ...query, offset });
    for (const model of models) {
      const route = repository
        .listPlatformModelRoutes(model.id, { includeDisabled: true })
        .find((item) => item.apiKeyId === apiKeyId && item.upstreamModel === upstreamModel);
      if (route) return { model, route };
    }
    offset += query.limit;
  }
  return null;
}

function findRouteByApiKeyModelId(repository, apiKeyModelId) {
  if (!apiKeyModelId) return null;
  const query = { includeDisabled: true, limit: 500, offset: 0 };
  const total = repository.countPlatformModels(query);
  let offset = 0;
  while (offset < total) {
    const models = repository.listPlatformModels({ ...query, offset });
    for (const model of models) {
      const route = repository
        .listPlatformModelRoutes(model.id, { includeDisabled: true })
        .find((item) => item.apiKeyModelId === apiKeyModelId);
      if (route) return { model, route };
    }
    offset += query.limit;
  }
  return null;
}

function createPlatformModelService({
  repository = defaultPlatformModelRepository,
} = {}) {
  function getPublicPlatformModel(platformModelId) {
    const model = repository.getPlatformModel(platformModelId);
    if (!model?.isEnabled || !hasUsablePlatformRoute(repository, model)) return null;
    return publicPlatformModel(model, repository);
  }

  function listPublicPlatformModels(req) {
    const query = listQuery(req.query || {}, false);
    const scanLimit = 500;
    const scanQuery = { ...query, limit: scanLimit, offset: 0 };
    const totalCandidates = repository.countPlatformModels(scanQuery);
    const runnableModels = [];

    while (scanQuery.offset < totalCandidates) {
      for (const model of repository.listPlatformModels(scanQuery)) {
        if (hasUsablePlatformRoute(repository, model)) {
          runnableModels.push(publicPlatformModel(model, repository));
        }
      }
      scanQuery.offset += scanLimit;
    }

    const models = runnableModels.slice(query.offset, query.offset + query.limit);
    return response(200, {
      count: models.length,
      limit: query.limit,
      models,
      offset: query.offset,
      total: runnableModels.length,
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
    const nextCapabilities = normalizeCapabilities(body.capabilities);
    if (existing && hasCapabilities(nextCapabilities)) {
      const incompatibleRoutes = repository
        .listPlatformModelRoutes(existing.id, { includeDisabled: false })
        .map((route) => ({
          route,
          issues: capabilityContractIssues(
            offeringCapabilities(route.apiKeyModel, route.providerId || route.apiKey?.providerId, route.upstreamModel),
            alignCapabilitiesToPlatformCapability(nextCapabilities, capability)
          ),
        }))
        .filter((item) => item.issues.length > 0);
      if (incompatibleRoutes.length > 0) {
        return response(409, {
          error: 'The platform capability contract is not supported by every enabled route.',
          incompatibleRoutes: incompatibleRoutes.map(({ route, issues }) => ({ routeId: route.id, issues })),
        });
      }
    }
    const model = repository.upsertPlatformModel({
      capabilities: nextCapabilities,
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
    const requestedApiKeyModelId = String(body.apiKeyModelId || '').trim();
    let apiKeyModel = requestedApiKeyModelId ? repository.getApiKeyModel(requestedApiKeyModelId) : null;
    const legacyApiKeyId = String(body.apiKeyId || apiKeyModel?.apiKeyId || '').trim();
    const legacyUpstreamModel = String(body.upstreamModel || platformModel.model || '').trim();
    if (!apiKeyModel && legacyApiKeyId && legacyUpstreamModel) {
      apiKeyModel = repository.getApiKeyModelByKeyAndName(legacyApiKeyId, legacyUpstreamModel);
    }
    if (!apiKeyModel) return response(400, { error: 'apiKeyModelId is required and must reference a discovered model.' });

    const apiKey = repository.getApiKey(apiKeyModel.apiKeyId, false);
    if (!apiKey || apiKey.keyScope !== 'server' || !apiKey.isEnabled) {
      return response(400, { error: 'Platform model routes can only use enabled server keys.' });
    }
    if (!apiKeyModel.isEnabled || apiKeyModel.discoveryStatus === 'missing') {
      return response(409, { error: 'Platform model routes can only use active, enabled API key models.' });
    }

    const existing = body.id ? repository.getPlatformModelRoute(body.id) : null;
    if (existing && existing.platformModelId !== platformModel.id) {
      return response(404, { error: 'Platform model route not found' });
    }

    const routeCapabilities = offeringCapabilities(apiKeyModel, apiKeyModel.modelProviderId || apiKey.providerId, apiKeyModel.upstreamModel);
    const routeAdapterId = apiKeyModel.adapterId
      || adapterIdForModel(apiKeyModel.modelProviderId || apiKey.providerId, routeCapabilities);
    if (!adapterSupportsCapabilities(routeAdapterId, routeCapabilities)) {
      return response(409, { error: 'The selected API key model does not have a compatible executable adapter.' });
    }
    let contract = platformModel.capabilities;
    let savedPlatformModel = platformModel;
    const routeWillBeEnabled = body.isEnabled !== false;
    if (!hasCapabilities(contract) && routeWillBeEnabled) {
      contract = alignCapabilitiesToPlatformCapability(routeCapabilities, platformModel.capability);
      savedPlatformModel = repository.upsertPlatformModel({ ...platformModel, capabilities: contract });
    }
    const compatibilityIssues = hasCapabilities(contract)
      ? capabilityContractIssues(routeCapabilities, contract)
      : [];
    if (routeWillBeEnabled && !keySupportsPlatformContract(apiKey, platformModel.capability, contract)) {
      return response(409, {
        error: 'The selected server key usage policy does not satisfy the platform capability contract.',
        compatibility: { compatible: false, issues: ['apiKey.allowedCapabilities does not cover the platform contract'] },
      });
    }
    if (routeWillBeEnabled && compatibilityIssues.length > 0) {
      return response(409, {
        error: 'The selected API key model does not satisfy the platform capability contract.',
        compatibility: { compatible: false, issues: compatibilityIssues },
      });
    }

    const route = repository.upsertPlatformModelRoute({
      apiKeyId: apiKeyModel.apiKeyId,
      apiKeyModelId: apiKeyModel.id,
      id: body.id,
      isEnabled: routeWillBeEnabled,
      platformModelId: platformModel.id,
      priority: Number(body.priority || 100) || 100,
      providerId: apiKeyModel.modelProviderId || apiKey.providerId,
      upstreamModel: apiKeyModel.upstreamModel,
    });
    auditLog(repository, req, existing ? 'platform_model_route.update' : 'platform_model_route.create', platformModel.id, {
      apiKeyId: route.apiKeyId,
      apiKeyModelId: route.apiKeyModelId,
      platformModelId: platformModel.id,
      routeId: route.id,
    });
    return response(existing ? 200 : 201, {
      compatibility: { compatible: true, issues: [] },
      route: publicRoute(route),
      model: adminPlatformModel(repository, savedPlatformModel),
    });
  }

  function createPlatformModelsFromKey(req) {
    const body = req.body || {};
    const apiKeyId = String(body.apiKeyId || '').trim();
    const capability = normalizeCapability(body.capability);
    const requestedModelIds = normalizeModelList(body.apiKeyModelIds);
    const requestedModels = normalizeModelList(body.models);
    const sortOrder = Number(body.sortOrder || 100) || 100;

    if (!apiKeyId) return response(400, { error: 'apiKeyId is required' });
    if (!capability) return response(400, { error: 'capability must be chat, imageGeneration, or videoGeneration' });
    if (requestedModels.length === 0 && requestedModelIds.length === 0) {
      return response(400, { error: 'apiKeyModelIds must include at least one discovered model.' });
    }

    const apiKey = repository.getApiKey(apiKeyId, false);
    if (!apiKey || apiKey.keyScope !== 'server' || !apiKey.isEnabled) {
      return response(400, { error: 'Platform models can only be generated from enabled server keys.' });
    }

    const requestedInstances = requestedModelIds.length > 0
      ? requestedModelIds.map((id) => repository.getApiKeyModel(id))
      : requestedModels.map((upstreamModel) => repository.getApiKeyModelByKeyAndName(apiKeyId, upstreamModel));
    const invalidModels = requestedInstances
      .map((model, index) => model?.apiKeyId === apiKeyId ? '' : requestedModelIds[index] || requestedModels[index])
      .filter(Boolean);
    if (invalidModels.length > 0) {
      return response(400, {
        error: 'Some model instances do not belong to the selected server key.',
        invalidModels,
      });
    }

    const created = [];
    const skipped = [];

    for (const apiKeyModel of requestedInstances) {
      const upstreamModel = apiKeyModel.upstreamModel;
      if (!apiKeyModel || !apiKeyModel.isEnabled || apiKeyModel.discoveryStatus === 'missing') {
        skipped.push({ reason: 'model_not_enabled', upstreamModel });
        continue;
      }
      const routeCapabilities = offeringCapabilities(
        apiKeyModel,
        apiKeyModel.modelProviderId || apiKey.providerId,
        upstreamModel
      );
      if (routeCapabilities[capability] !== true) {
        skipped.push({ reason: 'capability_mismatch', upstreamModel });
        continue;
      }
      if (!keySupportsPlatformContract(apiKey, capability, routeCapabilities)) {
        skipped.push({ reason: 'key_capability_mismatch', upstreamModel });
        continue;
      }
      const routeAdapterId = apiKeyModel.adapterId
        || adapterIdForModel(apiKeyModel.modelProviderId || apiKey.providerId, routeCapabilities);
      if (!adapterSupportsCapabilities(routeAdapterId, routeCapabilities)) {
        skipped.push({ reason: 'adapter_not_configured', upstreamModel });
        continue;
      }
      const existing = findRouteByApiKeyModelId(repository, apiKeyModel.id)
        || findRouteByKeyAndUpstreamModel(repository, apiKeyId, upstreamModel);
      if (existing) {
        skipped.push({
          platformModelId: existing.model.id,
          routeId: existing.route.id,
          reason: 'already_bound',
          upstreamModel,
        });
        continue;
      }

      const platformModel = repository.upsertPlatformModel({
        capabilities: alignCapabilitiesToPlatformCapability(
          routeCapabilities,
          capability
        ),
        capability,
        description: '',
        displayName: upstreamModel,
        isEnabled: body.isEnabled !== false,
        model: upstreamModel,
        sortOrder,
      });
      const route = repository.upsertPlatformModelRoute({
        apiKeyId,
        apiKeyModelId: apiKeyModel.id,
        isEnabled: true,
        platformModelId: platformModel.id,
        priority: 100,
        providerId: String(apiKeyModel.modelProviderId || apiKey.providerId || '').trim(),
        upstreamModel,
      });
      created.push({
        model: adminPlatformModel(repository, platformModel),
        route: publicRoute(route),
        upstreamModel,
      });
    }

    auditLog(repository, req, 'platform_model.bulk_create_from_key', apiKeyId, {
      apiKeyId,
      capability,
      created: created.length,
      requested: requestedInstances.length,
      skipped: skipped.length,
    });

    return response(201, {
      count: {
        created: created.length,
        skipped: skipped.length,
      },
      created,
      skipped,
    });
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
    createPlatformModelsFromKey,
    getPublicPlatformModel,
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
