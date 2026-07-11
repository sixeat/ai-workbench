const express = require('express');
const path = require('path');
const { DB_PATH } = require('./dataPaths.cjs');
const { DEFAULT_USER_ID } = require('./defaults.cjs');
const { hashPassword } = require('./auth.cjs');
const { LocalAssetStorage, OUTPUT_DIR } = require('./assetStorage.cjs');
const { authRepository } = require('./repositories/authRepository.cjs');
const { assetRepository } = require('./repositories/assetRepository.cjs');
const { taskRepository } = require('./repositories/taskRepository.cjs');
const {
  assertOpenLocationAllowed,
  assertProxyConfiguration,
  buildProxyAllowlist,
  deploymentMode,
  parseBoolean,
  resolveAdminToken,
  resolveAccessToken,
  resolveCorsOrigin,
  resolveHost,
  resolveKeyEncryptionSecret,
  resolveServeStatic,
  resolveSyncGeneration,
  shouldTrustClientUserId,
} = require('./security.cjs');
const { createEmailCodeRateLimit, registerAuthRoutes } = require('./routes/authRoutes.cjs');
const { registerApiKeyRoutes } = require('./routes/apiKeyRoutes.cjs');
const { registerTaskRoutes } = require('./routes/taskRoutes.cjs');
const { createPublicAsset, registerAssetRoutes } = require('./routes/assetRoutes.cjs');
const { registerModelProxyRoutes } = require('./routes/modelProxyRoutes.cjs');
const { registerGenerationRoutes } = require('./routes/generationRoutes.cjs');
const { registerWorkflowRoutes } = require('./routes/workflowRoutes.cjs');
const { registerProviderRoutes } = require('./routes/providerRoutes.cjs');
const { registerHealthRoutes } = require('./routes/healthRoutes.cjs');
const { registerCreditRoutes } = require('./routes/creditRoutes.cjs');
const { registerPlatformModelRoutes } = require('./routes/platformModelRoutes.cjs');
const { registerModelCatalogRoutes } = require('./routes/modelCatalogRoutes.cjs');
const { apiKeyModelRepository } = require('./repositories/apiKeyModelRepository.cjs');
const { platformModelRepository } = require('./repositories/platformModelRepository.cjs');
const { createApiKeyTestService } = require('./services/apiKeyTestService.cjs');
const { createCredentialService } = require('./services/credentialService.cjs');
const { joinUrl, proxyRequest } = require('./services/proxyService.cjs');
const { createSecretService } = require('./services/secretService.cjs');
const { createTaskService } = require('./services/taskService.cjs');
const { bootstrapAdminUser } = require('./services/bootstrapService.cjs');
const { createApiGateway } = require('./services/gatewayService.cjs');
const { resolveRequestConfig } = require('./services/requestConfigService.cjs');
const { createRequestUserIdResolver, createRequireAdmin } = require('./services/requestIdentityService.cjs');
const { createTaskRetryDispatcher } = require('./services/taskRetryDispatcher.cjs');
const { createCreditService } = require('./services/creditService.cjs');

const SAFE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function createWorkbenchApp({ env = process.env, startWorkers } = {}) {
  const app = express();
  const port = env.PROXY_PORT || 3000;
  const deployment = deploymentMode(env);
  const host = resolveHost(env, deployment);
  const secretsPath = path.join(__dirname, 'secrets.json');
  const distDir = path.join(__dirname, '..', 'dist');
  const assetStorage = new LocalAssetStorage(OUTPUT_DIR);
  const keyEncryptionSecret = resolveKeyEncryptionSecret(env, deployment);
  const accessToken = resolveAccessToken(env, deployment);
  const adminToken = resolveAdminToken(env, deployment);
  const serveStatic = resolveServeStatic(env, deployment);
  const corsOrigin = resolveCorsOrigin(env, deployment);
  const trustClientUserId = shouldTrustClientUserId(env, deployment, host);
  const enableSyncGeneration = resolveSyncGeneration(env, deployment);
  const shouldStartWorkers = startWorkers ?? parseBoolean(env.WORKBENCH_START_WORKERS, true);
  const proxyAllowlist = buildProxyAllowlist(env);
  const requestConfig = resolveRequestConfig(env, deployment);
  const {
    allowDirectCredentials,
    allowPublicRegistration,
    emailCode,
    enableGenericProxy,
    maxUserApiKeys,
    openLocationEnabled,
    rateLimits,
    requireInvitationCode,
    requireLogin,
    sessionCookieOptions,
    sessionTtlDays,
    taskQueues,
    trustForwardedFor,
    uploadLimits,
  } = requestConfig;
  const publicAsset = createPublicAsset(deployment, openLocationEnabled);
  const credentialService = createCredentialService({
    keyEncryptionSecret,
    deploymentMode: deployment,
    allowDirectCredentials,
    platformModelRepository,
    apiKeyModelRepository,
  });
  const creditService = createCreditService();
  const taskService = createTaskService({
    creditService,
    publicAsset,
  });
  const secretService = createSecretService({
    deploymentMode: deployment,
    env,
    secretsPath,
  });
  const apiKeyTestService = createApiKeyTestService({
    joinUrl,
    proxyRequest,
    readSecrets: secretService.readSecrets,
    resolveApiCredentials: credentialService.resolveApiCredentials,
  });

  assertProxyConfiguration({
    mode: deployment,
    enabled: enableGenericProxy,
    allowlist: proxyAllowlist,
  });

  bootstrapAdminUser({
    env,
    hashPassword,
    upsertBootstrapUser: authRepository.upsertBootstrapUser,
  });

  const apiGateway = createApiGateway({
    accessToken,
    authRepository,
    corsOrigin,
    env,
    rateLimits,
    requireLogin,
    sessionCookieOptions,
    trustForwardedFor,
    uploadLimits,
  });
  apiGateway.registerBeforeRoutes(app);
  const { rateLimit } = apiGateway;

  const requireAdmin = createRequireAdmin({
    adminToken,
    deploymentMode: deployment,
  });
  const getRequestUserId = createRequestUserIdResolver({
    defaultUserId: DEFAULT_USER_ID,
    trustClientUserId,
  });

  registerAuthRoutes(app, {
    allowPublicRegistration,
    authRepository,
    deploymentMode: deployment,
    emailCodeRateLimit: createEmailCodeRateLimit({
      windowMs: emailCode.windowMs,
      maxPerEmail: emailCode.emailLimit,
      maxPerIp: emailCode.ipLimit,
    }),
    emailCodeTtlMinutes: emailCode.ttlMinutes,
    getRequestUserId,
    rateLimit,
    requireAdmin,
    requireInvitationCode,
    requireLogin,
    sessionCookieOptions,
    sessionTtlDays,
    maxEmailCodeVerifyAttempts: emailCode.maxVerifyAttempts,
    windowMs: rateLimits.windowMs,
  });

  const modelProxyHandlers = registerModelProxyRoutes(app, {
    enableGenericProxy,
    joinUrl,
    proxyAllowlist,
    proxyRequest,
    getRequestUserId,
    readSecrets: secretService.readSecrets,
    resolveApiCredentials: credentialService.resolveApiCredentials,
    requireAdmin,
    resolveDirectCredentials: credentialService.resolveDirectCredentials,
    allowSyncGeneration: enableSyncGeneration,
    autoStartQueue: shouldStartWorkers,
    creditService,
    taskQueuePollIntervalMs: taskQueues.pollIntervalMs,
    textQueueConcurrency: taskQueues.textConcurrency,
  });

  const generationHandlers = registerGenerationRoutes(app, {
    assetStorage,
    getRequestUserId,
    joinUrl,
    proxyRequest,
    publicAsset,
    readSecrets: secretService.readSecrets,
    resolveApiCredentials: credentialService.resolveApiCredentials,
    allowSyncGeneration: enableSyncGeneration,
    autoStartQueue: shouldStartWorkers,
    creditService,
    generationQueueConcurrency: taskQueues.generationConcurrency,
    taskQueuePollIntervalMs: taskQueues.pollIntervalMs,
    uploadLimits: {
      maxUserAssetBytes: uploadLimits.maxUserAssetBytes,
    },
  });

  registerApiKeyRoutes(app, {
    encryptSecret: credentialService.encryptSecret,
    getRequestUserId,
    keyBelongsToUser: credentialService.keyBelongsToUser,
    maxUserApiKeys,
    requireAdmin,
    testApiKey: apiKeyTestService.testApiKey,
  });

  registerCreditRoutes(app, {
    creditService,
    getRequestUserId,
    requireAdmin,
  });

  registerPlatformModelRoutes(app, {
    platformModelRepository,
    requireAdmin,
  });

  registerModelCatalogRoutes(app, {
    discoverModels: apiKeyTestService.discoverModels,
    getRequestUserId,
    modelRepository: apiKeyModelRepository,
    platformModelRepository,
  });

  registerTaskRoutes(app, {
    getRequestUserId,
    retryTask: createTaskRetryDispatcher({
      retryTextTask: modelProxyHandlers.retryTextTask,
      retryGenerationTask: generationHandlers.retryGenerationTask,
    }),
    taskService,
  });

  registerWorkflowRoutes(app, {
    getRequestUserId,
  });

  registerProviderRoutes(app);

  registerAssetRoutes(app, {
    assetStorage,
    assertOpenLocationAllowed,
    deploymentMode: deployment,
    getRequestUserId,
    openLocationEnabled,
    outputDir: OUTPUT_DIR,
    publicAsset,
    safeImageMimeTypes: SAFE_IMAGE_MIME_TYPES,
    uploadLimits: {
      maxFileBytes: uploadLimits.maxFileBytes,
      maxUserAssetBytes: uploadLimits.maxUserAssetBytes,
      maxDailyUploadBytes: uploadLimits.maxDailyUploadBytes,
    },
  });

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
    host,
    getQueueHealth: () => [
      modelProxyHandlers.getTextQueueStats(),
      generationHandlers.getGenerationQueueStats(),
    ],
    outputDir: OUTPUT_DIR,
    requireAdmin,
    serveStatic,
  });

  apiGateway.registerAfterRoutes(app);

  if (serveStatic) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  async function stop() {
    await Promise.all([
      modelProxyHandlers.stopTextQueue(),
      generationHandlers.stopGenerationQueue(),
    ]);
  }

  return {
    app,
    config: {
      dbPath: DB_PATH,
      deploymentMode: deployment,
      distDir,
      enableSyncGeneration,
      host,
      outputDir: OUTPUT_DIR,
      port,
      serveStatic,
      startWorkers: shouldStartWorkers,
    },
    handlers: {
      generationHandlers,
      modelProxyHandlers,
    },
    stop,
  };
}

module.exports = {
  createWorkbenchApp,
};
