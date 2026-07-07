const { BASE_CAPABILITIES, resolveModelCapabilitiesDetailed } = require('../modelCapabilities.cjs');
const {
  modelCapabilityRepository: defaultModelCapabilityRepository,
} = require('../repositories/modelCapabilityRepository.cjs');

const MODEL_CAPABILITY_LIMITS = {
  maxProviderIdLength: 80,
  maxModelPatternLength: 180,
  maxCapabilitiesBytes: 128 * 1024,
};

function publicError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function requestIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function requestUserAgent(req) {
  return String(req.headers?.['user-agent'] || '').slice(0, 500);
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeProviderId(value) {
  const providerId = String(value || '').trim();
  if (!providerId) throw publicError(400, 'providerId is required');
  if (providerId.length > MODEL_CAPABILITY_LIMITS.maxProviderIdLength) {
    throw publicError(400, `providerId can include at most ${MODEL_CAPABILITY_LIMITS.maxProviderIdLength} characters.`);
  }
  if (!/^[a-z0-9._-]+$/i.test(providerId)) {
    throw publicError(400, 'providerId can only include letters, numbers, dot, underscore, and hyphen.');
  }
  return providerId;
}

function normalizeModelPattern(value) {
  const modelPattern = String(value || '').trim();
  if (!modelPattern) throw publicError(400, 'modelPattern is required');
  if (modelPattern.length > MODEL_CAPABILITY_LIMITS.maxModelPatternLength) {
    throw publicError(400, `modelPattern can include at most ${MODEL_CAPABILITY_LIMITS.maxModelPatternLength} characters.`);
  }
  if ([...modelPattern].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  })) {
    throw publicError(400, 'modelPattern cannot include control characters.');
  }
  return modelPattern;
}

function normalizeCapabilityPatch(value) {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw publicError(400, 'capabilities must be an object');

  const size = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (size > MODEL_CAPABILITY_LIMITS.maxCapabilitiesBytes) {
    throw publicError(413, `capabilities can include at most ${MODEL_CAPABILITY_LIMITS.maxCapabilitiesBytes} bytes.`);
  }
  return value;
}

function listQuery(query = {}, defaults = {}) {
  return {
    limit: Math.max(1, Math.min(500, Number(query.limit || defaults.limit || 100) || defaults.limit || 100)),
    offset: Math.max(0, Number(query.offset || 0) || 0),
    providerId: query.providerId || '',
    search: query.search || query.q || '',
  };
}

function sortedCapabilityKeys(capabilities) {
  return Object.keys(isRecord(capabilities) ? capabilities : {}).sort();
}

function createModelCapabilityService(options = {}) {
  const {
    getRequestUserId = (req) => req.authUser?.id || 'local-user',
    modelCapabilityRepository = defaultModelCapabilityRepository,
  } = options;

  function auditLog(req, action, targetType, targetId, metadata = {}) {
    modelCapabilityRepository.createAuditLog({
      action,
      actorUserId: req.authUser?.id || getRequestUserId(req),
      ipAddress: requestIp(req),
      metadata,
      targetId,
      targetType,
      userAgent: requestUserAgent(req),
    });
  }

  function listCapabilities(queryParams = {}) {
    const query = listQuery(queryParams, { limit: 500 });
    const capabilities = modelCapabilityRepository.listModelCapabilities(query);
    return {
      capabilities,
      count: capabilities.length,
      limit: query.limit,
      offset: query.offset,
      total: modelCapabilityRepository.countModelCapabilities(query),
    };
  }

  function resolveCapabilities(queryParams = {}) {
    const providerId = normalizeProviderId(queryParams.providerId || 'openai-compatible');
    const model = String(queryParams.model || '').trim();
    if (!model) throw publicError(400, 'model is required');

    return resolveModelCapabilitiesDetailed(providerId, model, modelCapabilityRepository);
  }

  function saveCapability(req, body = {}) {
    const providerId = normalizeProviderId(body.providerId);
    const modelPattern = normalizeModelPattern(body.modelPattern);
    const capabilities = normalizeCapabilityPatch(body.capabilities);
    const previousCapability = modelCapabilityRepository.listModelCapabilities({ providerId })
      .find((item) => item.modelPattern === modelPattern);

    modelCapabilityRepository.upsertModelCapability(providerId, modelPattern, {
      ...BASE_CAPABILITIES,
      ...capabilities,
    });

    const capability = modelCapabilityRepository.listModelCapabilities()
      .find((item) => item.providerId === providerId && item.modelPattern === modelPattern);

    auditLog(req, 'model_capability.upsert', 'model_capability', capability?.id || `${providerId}:${modelPattern}`, {
      capabilityKeys: sortedCapabilityKeys(capabilities),
      modelPattern,
      operation: previousCapability ? 'update' : 'create',
      ...(previousCapability ? {
        previousCapabilityKeys: sortedCapabilityKeys(previousCapability.capabilities),
      } : {}),
      providerId,
    });

    return capability;
  }

  return {
    listCapabilities,
    resolveCapabilities,
    saveCapability,
  };
}

module.exports = {
  MODEL_CAPABILITY_LIMITS,
  createModelCapabilityService,
  listQuery,
  normalizeCapabilityPatch,
  normalizeModelPattern,
  normalizeProviderId,
  sortedCapabilityKeys,
};
