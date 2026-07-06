const express = require('express');
const path = require('path');
const { DB_PATH } = require('./dataPaths.cjs');
const { DEFAULT_USER_ID } = require('./defaults.cjs');
const { assetRepository } = require('./repositories/assetRepository.cjs');
const { authRepository } = require('./repositories/authRepository.cjs');
const { taskRepository } = require('./repositories/taskRepository.cjs');
const { registerApiKeyRoutes } = require('./routes/apiKeyRoutes.cjs');
const { registerHealthRoutes } = require('./routes/healthRoutes.cjs');
const { registerModelProxyRoutes } = require('./routes/modelProxyRoutes.cjs');
const { registerProviderRoutes } = require('./routes/providerRoutes.cjs');
const { createApiKeyTestService } = require('./services/apiKeyTestService.cjs');
const { createCredentialService } = require('./services/credentialService.cjs');
const {
  createInternalServiceIdentityMiddleware,
  pathMatchesProtectedPrefix,
  resolveInternalServiceToken,
} = require('./services/internalServiceAuthService.cjs');
const { assertInternalServiceHostAllowed } = require('./services/internalServiceExposureGuard.cjs');
const { createSecretService } = require('./services/secretService.cjs');
const { createSecurityHeadersMiddleware } = require('./services/securityHeadersService.cjs');
const { joinUrl, proxyRequest } = require('./services/proxyService.cjs');
const { createRequestUserIdResolver, createRequireAdmin } = require('./services/requestIdentityService.cjs');
const {
  assertProxyConfiguration,
  buildProxyAllowlist,
  deploymentMode,
  parseBoolean,
  resolveAdminToken,
  resolveKeyEncryptionSecret,
  resolveSyncGeneration,
} = require('./security.cjs');
const { resolveRequestConfig } = require('./services/requestConfigService.cjs');

const MODEL_SERVICE_PROTECTED_PREFIXES = [
  '/api/admin/health',
  '/api/api-keys',
  '/api/chat',
  '/api/claude',
  '/api/model-capabilities',
  '/api/model-capability-presets',
  '/api/models',
  '/api/providers',
  '/api/proxy',
];

function resolveModelServicePort(env = process.env) {
  return Number(env.WORKBENCH_MODEL_SERVICE_PORT || 3003);
}

function resolveModelServiceHost(env = process.env) {
  return env.WORKBENCH_MODEL_SERVICE_HOST || '127.0.0.1';
}

function modelServiceIdentityRequired(pathname = '') {
  return pathMatchesProtectedPrefix(pathname, MODEL_SERVICE_PROTECTED_PREFIXES);
}

function createModelServiceApp({ env = process.env, startWorkers } = {}) {
  const app = express();
  const deployment = deploymentMode(env);
  const requestConfig = resolveRequestConfig(env, deployment);
  const host = resolveModelServiceHost(env);
  const port = resolveModelServicePort(env);
  assertInternalServiceHostAllowed({ env, envName: 'WORKBENCH_MODEL_SERVICE_HOST', host, mode: deployment });
  const secretsPath = path.join(__dirname, 'secrets.json');
  const proxyAllowlist = buildProxyAllowlist(env);
  const shouldStartTextQueue = startWorkers ?? parseBoolean(env.WORKBENCH_MODEL_SERVICE_START_QUEUE, false);
  const keyEncryptionSecret = resolveKeyEncryptionSecret(env, deployment);
  const adminToken = resolveAdminToken(env, deployment);
  const enableGenericProxy = requestConfig.enableGenericProxy;
  const enableSyncGeneration = resolveSyncGeneration(env, deployment);
  const credentialService = createCredentialService({
    allowDirectCredentials: requestConfig.allowDirectCredentials,
    deploymentMode: deployment,
    keyEncryptionSecret,
  });
  const secretService = createSecretService({
    deploymentMode: deployment,
    env,
    secretsPath,
  });
  const getRequestUserId = createRequestUserIdResolver({
    defaultUserId: DEFAULT_USER_ID,
    trustClientUserId: false,
  });
  const requireAdmin = createRequireAdmin({
    adminToken,
    deploymentMode: deployment,
  });
  const apiKeyTestService = createApiKeyTestService({
    joinUrl,
    proxyRequest,
    readSecrets: secretService.readSecrets,
    resolveApiCredentials: credentialService.resolveApiCredentials,
  });

  assertProxyConfiguration({
    allowlist: proxyAllowlist,
    enabled: enableGenericProxy,
    mode: deployment,
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ limit: '1mb' }));
  app.use(createSecurityHeadersMiddleware({ env }));
  app.use(createInternalServiceIdentityMiddleware({
    defaultUserId: DEFAULT_USER_ID,
    deployment,
    protectedPrefixes: MODEL_SERVICE_PROTECTED_PREFIXES,
    token: resolveInternalServiceToken(env),
  }));

  const modelProxyHandlers = registerModelProxyRoutes(app, {
    allowSyncGeneration: enableSyncGeneration,
    autoStartQueue: shouldStartTextQueue,
    enableGenericProxy,
    getRequestUserId,
    joinUrl,
    proxyAllowlist,
    proxyRequest,
    readSecrets: secretService.readSecrets,
    requireAdmin,
    resolveApiCredentials: credentialService.resolveApiCredentials,
    resolveDirectCredentials: credentialService.resolveDirectCredentials,
    taskQueuePollIntervalMs: requestConfig.taskQueues.pollIntervalMs,
    textQueueConcurrency: requestConfig.taskQueues.textConcurrency,
  });

  registerApiKeyRoutes(app, {
    encryptSecret: credentialService.encryptSecret,
    getRequestUserId,
    keyBelongsToUser: credentialService.keyBelongsToUser,
    maxUserApiKeys: requestConfig.maxUserApiKeys,
    requireAdmin,
    testApiKey: apiKeyTestService.testApiKey,
  });

  registerProviderRoutes(app);

  registerHealthRoutes(app, {
    countAllAssets: assetRepository.countAllAssets,
    countAllTasks: taskRepository.countAllTasks,
    countAllUsers: authRepository.countAllUsers,
    countAssets: assetRepository.countAssets,
    countEnabledUsers: authRepository.countEnabledUsers,
    countTasks: taskRepository.countTasks,
    dbPath: DB_PATH,
    defaultUserId: DEFAULT_USER_ID,
    deploymentMode: deployment,
    getQueueHealth: () => [
      modelProxyHandlers.getTextQueueStats(),
    ],
    host,
    outputDir: '',
    requireAdmin,
    serveStatic: false,
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Model service API route not found.' });
  });

  async function stop() {
    await modelProxyHandlers.stopTextQueue();
  }

  return {
    app,
    config: {
      dbPath: DB_PATH,
      deploymentMode: deployment,
      enableSyncGeneration,
      host,
      port,
      startWorkers: shouldStartTextQueue,
    },
    handlers: {
      modelProxyHandlers,
    },
    stop,
  };
}

module.exports = {
  MODEL_SERVICE_PROTECTED_PREFIXES,
  createModelServiceApp,
  modelServiceIdentityRequired,
  resolveModelServiceHost,
  resolveModelServicePort,
};
