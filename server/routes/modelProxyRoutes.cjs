const { listModelCapabilityPresets } = require('../modelCapabilities.cjs');
const { sendSafeError } = require('../httpErrors.cjs');
const {
  MODEL_CAPABILITY_LIMITS,
  createModelCapabilityService,
} = require('../services/modelCapabilityService.cjs');
const { createGenericProxyService } = require('../services/genericProxyService.cjs');
const { createModelListService } = require('../services/modelListService.cjs');
const { createTextTaskRequestService } = require('../services/textTaskRequestService.cjs');
const { createTextWorker } = require('../workers/textWorker.cjs');

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
    autoStartQueue = true,
    creditService,
    taskQueuePollIntervalMs = 1000,
    textQueueConcurrency = 2,
    modelCapabilityRepository,
  } = context;
  const textWorker = createTextWorker({
    autoStart: autoStartQueue,
    creditService,
    joinUrl,
    proxyRequest,
    readSecrets,
    resolveApiCredentials,
    resolveDirectCredentials,
    taskQueuePollIntervalMs,
    textQueueConcurrency,
  });
  const { textGenerationService } = textWorker;
  const modelCapabilityService = createModelCapabilityService({
    getRequestUserId,
    modelCapabilityRepository,
  });
  const modelListService = createModelListService({
    getRequestUserId,
    joinUrl,
    proxyRequest,
    readSecrets,
    resolveApiCredentials,
    resolveDirectCredentials,
  });
  const genericProxyService = createGenericProxyService({
    enableGenericProxy,
    proxyAllowlist,
    proxyRequest,
  });
  const textTaskRequestService = createTextTaskRequestService({
    creditService,
    getRequestUserId,
    readSecrets,
    textGenerationService,
    textWorker,
  });

  app.post('/api/models', async (req, res) => {
    try {
      const response = await modelListService.listModels(req);
      return res.status(response.status).json(response.data);
    } catch (error) {
      console.error('/api/models error:', error.message);
      sendSafeError(res, error, { message: 'Unable to fetch models.' });
    }
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const response = textTaskRequestService.enqueueTextTask(req, 'chat');
      return res.status(response.status).json(response.data);
    } catch (error) {
      console.error('/api/chat error:', error.message);
      return sendSafeError(res, error, { message: 'Chat request failed.' });
    }
  });

  if (allowSyncGeneration) {
    app.post('/api/chat/sync', async (req, res) => {
      try {
        const result = await textTaskRequestService.runSyncTextTask(req, 'chat');
        return res.status(result.status).json(result.data);
      } catch (error) {
        console.error('/api/chat/sync error:', error.message);
        return sendSafeError(res, error, { message: 'Chat request failed.' });
      }
    });
  }

  app.post('/api/claude', async (req, res) => {
    try {
      const response = textTaskRequestService.enqueueTextTask(req, 'claude');
      return res.status(response.status).json(response.data);
    } catch (error) {
      console.error('/api/claude error:', error.message);
      return sendSafeError(res, error, { message: 'Claude request failed.' });
    }
  });

  if (allowSyncGeneration) {
    app.post('/api/claude/sync', async (req, res) => {
      try {
        const result = await textTaskRequestService.runSyncTextTask(req, 'claude');
        return res.status(result.status).json(result.data);
      } catch (error) {
        console.error('/api/claude/sync error:', error.message);
        return sendSafeError(res, error, { message: 'Claude request failed.' });
      }
    });
  }

  app.post('/api/proxy', async (req, res) => {
    try {
      const response = await genericProxyService.proxy(req.body || {});
      return res.status(response.status).json(response.data);
    } catch (error) {
      console.error('/api/proxy error:', error.message);
      return sendSafeError(res, error, { message: 'Proxy request failed.' });
    }
  });

  app.get('/api/model-capabilities', (req, res) => {
    res.json(modelCapabilityService.listCapabilities(req.query || {}));
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
      const capability = modelCapabilityService.saveCapability(req, req.body || {});
      res.status(201).json({ capability });
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to save model capabilities.' });
    }
  });

  return {
    getTextQueueStats: textWorker.getTextQueueStats,
    retryTextTask: textTaskRequestService.retryTextTask,
    stopTextQueue: textWorker.stopTextQueue,
  };
}

module.exports = {
  MODEL_CAPABILITY_LIMITS,
  registerModelProxyRoutes,
};
