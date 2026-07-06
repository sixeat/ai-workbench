const {
  addTaskLog,
  countModelCapabilities,
  createAuditLog,
  listModelCapabilities,
  upsertModelCapability,
} = require('../db.cjs');
const { BASE_CAPABILITIES, listModelCapabilityPresets } = require('../modelCapabilities.cjs');
const { assertGenericProxyAllowed } = require('../security.cjs');
const { sendSafeError } = require('../httpErrors.cjs');
const { createTaskQueueService } = require('../services/taskQueueService.cjs');
const { createTextGenerationService } = require('../services/textGenerationService.cjs');
const { taskRetryLogData } = require('../services/taskRelationshipService.cjs');

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

function pick(input, keys) {
  const result = {};
  for (const key of keys) {
    if (input?.[key] !== undefined && input[key] !== null && input[key] !== '') {
      result[key] = input[key];
    }
  }
  return result;
}

function textRetryBody(task) {
  return {
    ...pick(task.input || {}, [
      'apiKeyId',
      'baseUrl',
      'requestKind',
      'model',
      'messages',
      'system',
      'temperature',
      'max_tokens',
      'maxTokens',
      'stream',
      'upstreamTaskIds',
    ]),
    providerId: task.providerId || task.input?.providerId || 'openai-compatible',
    retryOf: task.id,
  };
}

function retryLogData(sourceTask, nextTask) {
  return taskRetryLogData(sourceTask, nextTask, 'text');
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
    search: query.search || query.q || '',
    providerId: query.providerId || '',
  };
}

function registerModelProxyRoutes(app, context) {
  const {
    enableGenericProxy,
    joinUrl,
    proxyAllowlist,
    proxyRequest,
    getRequestUserId,
    readSecrets,
    resolveApiCredentials,
    requireAdmin,
    resolveDirectCredentials,
    allowSyncGeneration = false,
    textQueueConcurrency = 2,
  } = context;
  const textGenerationService = createTextGenerationService({
    joinUrl,
    proxyRequest,
    resolveApiCredentials,
    resolveDirectCredentials,
  });
  const textQueue = createTaskQueueService({
    name: 'text',
    concurrency: textQueueConcurrency,
    handlers: {
      text: async (task, payload = {}) => {
        const secrets = await readSecrets();
        await textGenerationService.runTextTask({
          userId: task.userId,
          body: payload.body || task.input || {},
          secrets,
          task,
        });
      },
    },
  });
  textQueue.start();

  function auditLog(req, action, targetType, targetId, metadata = {}) {
    createAuditLog({
      actorUserId: req.authUser?.id || getRequestUserId(req),
      action,
      targetType,
      targetId,
      ipAddress: requestIp(req),
      userAgent: requestUserAgent(req),
      metadata,
    });
  }

  async function resolveRequestCredentials(req, secrets) {
    const body = req.body || {};
    if (body.apiKeyId) {
      return resolveApiCredentials({
        userId: getRequestUserId(req),
        body,
        secrets,
      });
    }
    return resolveDirectCredentials(body, secrets);
  }

  function enqueueTextTask(req, res, requestKind) {
    const userId = getRequestUserId(req);
    const body = {
      ...(req.body || {}),
      requestKind,
      ...(requestKind === 'claude' ? { providerId: req.body?.providerId || 'anthropic' } : {}),
    };
    const task = textGenerationService.createTextTask(userId, body, 'queued');
    textQueue.enqueue(task, { body });
    return res.status(202).json({ task, taskId: task.id, status: task.status });
  }

  app.post('/api/models', async (req, res) => {
    try {
      const secrets = await readSecrets();
      const { baseUrl, apiKey } = await resolveRequestCredentials(req, secrets);

      if (!baseUrl) return res.status(400).json({ error: 'Base URL is required' });

      const result = await proxyRequest(joinUrl(baseUrl, '/v1/models'), {
        method: 'GET',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });

      if (result.status >= 400) {
        return res.status(result.status).json({
          error: result.data?.error?.message || `HTTP ${result.status}`,
        });
      }

      const models = Array.isArray(result.data?.data)
        ? result.data.data
          .map((item) => ({
            id: String(item.id || ''),
            ownedBy: item.owned_by ? String(item.owned_by) : undefined,
          }))
          .filter((item) => item.id)
          .sort((a, b) => a.id.localeCompare(b.id))
        : [];

      res.json({ models, count: models.length });
    } catch (error) {
      console.error('/api/models error:', error.message);
      sendSafeError(res, error, { message: 'Unable to fetch models.' });
    }
  });

  app.post('/api/chat', async (req, res) => {
    try {
      return enqueueTextTask(req, res, 'chat');
    } catch (error) {
      console.error('/api/chat error:', error.message);
      return sendSafeError(res, error, { message: 'Chat request failed.' });
    }
  });

  if (allowSyncGeneration) {
    app.post('/api/chat/sync', async (req, res) => {
      try {
        const secrets = await readSecrets();
        const userId = getRequestUserId(req);
        const result = await textGenerationService.runTextTask({
          userId,
          body: { ...(req.body || {}), requestKind: 'chat' },
          secrets,
        });
        return res.status(result.status).json(result.data);
      } catch (error) {
        console.error('/api/chat/sync error:', error.message);
        return sendSafeError(res, error, { message: 'Chat request failed.' });
      }
    });
  }

  app.post('/api/claude', async (req, res) => {
    try {
      return enqueueTextTask(req, res, 'claude');
    } catch (error) {
      console.error('/api/claude error:', error.message);
      return sendSafeError(res, error, { message: 'Claude request failed.' });
    }
  });

  if (allowSyncGeneration) {
    app.post('/api/claude/sync', async (req, res) => {
      try {
        const secrets = await readSecrets();
        const userId = getRequestUserId(req);
        const result = await textGenerationService.runTextTask({
          userId,
          body: {
            ...(req.body || {}),
            requestKind: 'claude',
            providerId: req.body?.providerId || 'anthropic',
          },
          secrets,
        });
        return res.status(result.status).json(result.data);
      } catch (error) {
        console.error('/api/claude/sync error:', error.message);
        return sendSafeError(res, error, { message: 'Claude request failed.' });
      }
    });
  }

  app.post('/api/proxy', async (req, res) => {
    try {
      const body = req.body || {};
      const { url, method = 'GET', headers = {}, body: proxyBody } = body;
      if (!url) return res.status(400).json({ error: 'URL is required' });
      assertGenericProxyAllowed(url, {
        enabled: enableGenericProxy,
        allowlist: proxyAllowlist,
      });

      const result = await proxyRequest(url, { method, headers, body: proxyBody });
      return res.status(result.status).json(result.data);
    } catch (error) {
      console.error('/api/proxy error:', error.message);
      return sendSafeError(res, error, { message: 'Proxy request failed.' });
    }
  });

  app.get('/api/model-capabilities', (req, res) => {
    const query = listQuery(req.query, { limit: 500 });
    const capabilities = listModelCapabilities(query);
    res.json({
      capabilities,
      count: capabilities.length,
      total: countModelCapabilities(query),
      limit: query.limit,
      offset: query.offset,
    });
  });

  app.get('/api/model-capability-presets', (req, res) => {
    const providerId = String(req.query.providerId || '').trim();
    const presets = listModelCapabilityPresets()
      .filter((preset) => !providerId || preset.providerId === providerId);
    res.json({ presets, count: presets.length });
  });

  app.post('/api/model-capabilities', (req, res) => {
    if (!requireAdmin(req, res)) return;

    try {
      const body = req.body || {};
      const providerId = normalizeProviderId(body.providerId);
      const modelPattern = normalizeModelPattern(body.modelPattern);
      const capabilities = normalizeCapabilityPatch(body.capabilities);

      upsertModelCapability(providerId, modelPattern, {
        ...BASE_CAPABILITIES,
        ...capabilities,
      });

      const capability = listModelCapabilities()
        .find((item) => item.providerId === providerId && item.modelPattern === modelPattern);

      auditLog(req, 'model_capability.upsert', 'model_capability', capability?.id || `${providerId}:${modelPattern}`, {
        providerId,
        modelPattern,
        capabilityKeys: Object.keys(capabilities).sort(),
      });

      res.status(201).json({ capability });
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to save model capabilities.' });
    }
  });

  async function retryTextTask({ userId, task }) {
    const body = textRetryBody(task);
    const nextTask = textGenerationService.createTextTask(userId, body, 'queued');
    const logData = retryLogData(task, nextTask);
    addTaskLog(task.id, {
      event: 'retry_created',
      message: 'A retry task was created from this failed text task.',
      data: logData,
    });
    addTaskLog(nextTask.id, {
      event: 'created_from_retry',
      message: 'This text task was created by retrying a failed task.',
      data: {
        ...logData,
        sourceTaskId: task.id,
      },
    });
    textQueue.enqueue(nextTask, { body });
    return {
      status: 202,
      data: {
        task: nextTask,
        taskId: nextTask.id,
        status: nextTask.status,
      },
    };
  }

  return {
    getTextQueueStats: () => textQueue.getStats(),
    retryTextTask,
    stopTextQueue: () => textQueue.stop(),
  };
}

module.exports = {
  MODEL_CAPABILITY_LIMITS,
  registerModelProxyRoutes,
};
