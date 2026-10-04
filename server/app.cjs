const express = require('express');
const fs = require('node:fs');
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
const { registerWorkflowRunRoutes } = require('./routes/workflowRunRoutes.cjs');
const { createWorkflowRunService } = require('./services/workflowRunService.cjs');
const { createWorkflowRunWorker } = require('./workers/workflowRunWorker.cjs');
const { workflowRunRepository } = require('./repositories/workflowRunRepository.cjs');
const { registerProviderRoutes } = require('./routes/providerRoutes.cjs');
const { registerHealthRoutes } = require('./routes/healthRoutes.cjs');
const { registerCreditRoutes } = require('./routes/creditRoutes.cjs');
const { registerPlatformModelRoutes } = require('./routes/platformModelRoutes.cjs');
const { registerModelCatalogRoutes } = require('./routes/modelCatalogRoutes.cjs');
const { apiKeyModelRepository } = require('./repositories/apiKeyModelRepository.cjs');
const { platformModelRepository } = require('./repositories/platformModelRepository.cjs');
const { workflowRepository } = require('./repositories/workflowRepository.cjs');
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

  // 服务端工作流编排。
  //
  // 关键点：节点仍然走和 /api/images、/api/videos、/api/chat 完全相同的入队路径，
  // 所以能力过滤、凭据回退、积分计费、失败退款全部自动继承，不需要重写。
  const workflowRunService = createWorkflowRunService({ workflowRepository });
  const workflowRunEnabled = parseBoolean(env.WORKBENCH_SERVER_SIDE_RUNS, false);

  async function submitWorkflowNodeTask({ body, kind, userId }) {
    // 合成一个请求对象复用现有入队服务：它们只读取 userId 与 publicBaseUrl。
    const requestLike = { authUser: { id: userId }, body, headers: {} };
    if (kind === 'image') {
      const response = generationHandlers.enqueueImageTask(requestLike, body);
      return { taskId: response?.data?.taskId || '' };
    }
    if (kind === 'video') {
      const response = generationHandlers.enqueueVideoTask(requestLike, body);
      return { taskId: response?.data?.taskId || '' };
    }
    if (kind === 'text') {
      const prompt = String(body.prompt || body.content || '').trim();
      const textBody = {
        ...body,
        messages: Array.isArray(body.messages) && body.messages.length > 0
          ? body.messages
          : [{ content: prompt, role: 'user' }],
        requestKind: 'chat',
      };
      const response = modelProxyHandlers.enqueueTextTask({ ...requestLike, body: textBody }, 'chat');
      return { taskId: response?.data?.taskId || '' };
    }
    throw Object.assign(new Error(`Unsupported workflow node task kind: ${kind}`), { status: 400 });
  }

  const workflowRunWorker = createWorkflowRunWorker({
    autoStart: shouldStartWorkers,
    enabled: workflowRunEnabled,
    // 视频是上游异步任务，必须由后台轮询才能落定；缺了它节点会永远停在 queued
    advanceVideoTask: ({ taskId, userId }) => generationHandlers.advanceVideoTask({ taskId, userId }),
    enqueueTask: ({ body, kind, userId }) => submitWorkflowNodeTask({ body, kind, userId }),
    pollIntervalMs: Number(env.WORKBENCH_WORKFLOW_RUN_POLL_INTERVAL_MS || 2000),
    taskRepository,
    workflowRunRepository,
    workflowRunService,
  });

  registerWorkflowRunRoutes(app, {
    getRequestUserId,
    workflowRunService,
    workflowRunsEnabled: workflowRunEnabled,
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
    // 旧前端（原先内嵌在 backend/src）已移除，backend/dist 可能不存在。
    // 直接把不存在的目录交给 express.static 会让所有页面请求走进
    // sendFile 的兜底并报 ENOENT，错误信息指向一个不存在的文件，
    // 排查成本很高。这里显式判断，给出可操作的提示。
    if (fs.existsSync(path.join(distDir, 'index.html'))) {
      app.use(express.static(distDir));
      app.get(/^(?!\/api).*/, (req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    } else {
      app.get(/^(?!\/api).*/, (req, res) => {
        res.status(404).json({
          error:
            'No frontend is bundled with this backend. Build the frontend in ../frontend and serve it '
            + 'separately, or copy its build output into backend/dist to let this service host it. '
            + 'Set WORKBENCH_SERVE_STATIC=false to silence this route.',
        });
      });
    }
  }

  async function stop() {
    await Promise.all([
      modelProxyHandlers.stopTextQueue(),
      generationHandlers.stopGenerationQueue(),
      workflowRunWorker.stopWorkflowRunWorker(),
    ]);
  }

  return {
    app,
    config: {
      dbPath: DB_PATH,
      deploymentMode: deployment,
      distDir,
      enableSyncGeneration,
      enableWorkflowRuns: workflowRunEnabled,
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
