const express = require('express');
const path = require('path');
const { DB_PATH } = require('./dataPaths.cjs');
const { DEFAULT_USER_ID } = require('./defaults.cjs');
const { LocalAssetStorage, OUTPUT_DIR } = require('./assetStorage.cjs');
const { assetRepository } = require('./repositories/assetRepository.cjs');
const { authRepository } = require('./repositories/authRepository.cjs');
const { taskRepository } = require('./repositories/taskRepository.cjs');
const { registerGenerationRoutes } = require('./routes/generationRoutes.cjs');
const { registerHealthRoutes } = require('./routes/healthRoutes.cjs');
const { registerTaskRoutes } = require('./routes/taskRoutes.cjs');
const { createPublicAsset } = require('./services/assetService.cjs');
const { createCredentialService } = require('./services/credentialService.cjs');
const { createCreditService } = require('./services/creditService.cjs');
const { createSecurityHeadersMiddleware } = require('./services/securityHeadersService.cjs');
const { createSecretService } = require('./services/secretService.cjs');
const {
  createInternalServiceIdentityMiddleware,
  pathMatchesProtectedPrefix,
  resolveInternalServiceToken,
} = require('./services/internalServiceAuthService.cjs');
const { assertInternalServiceHostAllowed } = require('./services/internalServiceExposureGuard.cjs');
const { createTaskRetryDispatcher } = require('./services/taskRetryDispatcher.cjs');
const { createTaskService } = require('./services/taskService.cjs');
const { createTextTaskRequestService } = require('./services/textTaskRequestService.cjs');
const { joinUrl, proxyRequest } = require('./services/proxyService.cjs');
const { createTextWorker } = require('./workers/textWorker.cjs');
const {
  deploymentMode,
  parseBoolean,
  resolveKeyEncryptionSecret,
} = require('./security.cjs');
const { resolveRequestConfig } = require('./services/requestConfigService.cjs');

const WORKER_SERVICE_PROTECTED_PREFIXES = [
  '/api/admin/health',
  '/api/images',
  '/api/tasks',
  '/api/videos',
];

function resolveWorkerServicePort(env = process.env) {
  return Number(env.WORKBENCH_WORKER_SERVICE_PORT || env.PROXY_PORT || 3001);
}

function resolveWorkerServiceHost(env = process.env) {
  return env.WORKBENCH_WORKER_SERVICE_HOST || '127.0.0.1';
}

function workerServiceIdentityRequired(pathname = '') {
  return pathMatchesProtectedPrefix(pathname, WORKER_SERVICE_PROTECTED_PREFIXES);
}

function createWorkerServiceApp({ env = process.env, startWorkers } = {}) {
  const app = express();
  const deployment = deploymentMode(env);
  const requestConfig = resolveRequestConfig(env, deployment);
  const host = resolveWorkerServiceHost(env);
  const port = resolveWorkerServicePort(env);
  assertInternalServiceHostAllowed({ env, envName: 'WORKBENCH_WORKER_SERVICE_HOST', host, mode: deployment });
  const shouldStartWorkers = startWorkers ?? parseBoolean(env.WORKBENCH_WORKER_SERVICE_START_QUEUE, true);
  const secretsPath = path.join(__dirname, 'secrets.json');
  const assetStorage = new LocalAssetStorage(OUTPUT_DIR);
  const publicAsset = createPublicAsset(deployment, false);
  const keyEncryptionSecret = resolveKeyEncryptionSecret(env, deployment);
  const credentialService = createCredentialService({
    keyEncryptionSecret,
    deploymentMode: deployment,
    allowDirectCredentials: requestConfig.allowDirectCredentials,
  });
  const creditService = createCreditService();
  const secretService = createSecretService({
    deploymentMode: deployment,
    env,
    secretsPath,
  });
  const getRequestUserId = (req) => req.authUser?.id || DEFAULT_USER_ID;

  app.use(['/api/images', '/api/videos'], express.json({ limit: `${requestConfig.uploadLimits.uploadBodyLimitMb}mb` }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ limit: '1mb' }));
  app.use(createSecurityHeadersMiddleware({ env }));
  app.use(createInternalServiceIdentityMiddleware({
    defaultUserId: DEFAULT_USER_ID,
    deployment,
    protectedPrefixes: WORKER_SERVICE_PROTECTED_PREFIXES,
    token: resolveInternalServiceToken(env),
  }));

  const textWorker = createTextWorker({
    autoStart: shouldStartWorkers,
    creditService,
    joinUrl,
    proxyRequest,
    readSecrets: secretService.readSecrets,
    resolveApiCredentials: credentialService.resolveApiCredentials,
    resolveDirectCredentials: credentialService.resolveDirectCredentials,
    taskQueuePollIntervalMs: requestConfig.taskQueues.pollIntervalMs,
    textQueueConcurrency: requestConfig.taskQueues.textConcurrency,
  });
  const textTaskRequestService = createTextTaskRequestService({
    creditService,
    getRequestUserId,
    readSecrets: secretService.readSecrets,
    textGenerationService: textWorker.textGenerationService,
    textWorker,
  });
  const generationHandlers = registerGenerationRoutes(app, {
    assetStorage,
    autoStartQueue: shouldStartWorkers,
    creditService,
    generationQueueConcurrency: requestConfig.taskQueues.generationConcurrency,
    getRequestUserId,
    joinUrl,
    proxyRequest,
    publicAsset,
    readSecrets: secretService.readSecrets,
    resolveApiCredentials: credentialService.resolveApiCredentials,
    taskQueuePollIntervalMs: requestConfig.taskQueues.pollIntervalMs,
    uploadLimits: {
      maxUserAssetBytes: requestConfig.uploadLimits.maxUserAssetBytes,
    },
  });
  const taskService = createTaskService({
    creditService,
    publicAsset,
  });

  registerTaskRoutes(app, {
    getRequestUserId,
    retryTask: createTaskRetryDispatcher({
      retryGenerationTask: generationHandlers.retryGenerationTask,
      retryTextTask: textTaskRequestService.retryTextTask,
    }),
    taskService,
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
    getQueueHealth: () => [
      textWorker.getTextQueueStats(),
      generationHandlers.getGenerationQueueStats(),
    ],
    host,
    outputDir: OUTPUT_DIR,
    requireAdmin: () => true,
    serveStatic: false,
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Worker service API route not found.' });
  });

  async function stop() {
    await Promise.all([
      textWorker.stopTextQueue(),
      generationHandlers.stopGenerationQueue(),
    ]);
  }

  return {
    app,
    config: {
      dbPath: DB_PATH,
      deploymentMode: deployment,
      host,
      outputDir: OUTPUT_DIR,
      port,
      startWorkers: shouldStartWorkers,
    },
    handlers: {
      generationHandlers,
      textWorker,
    },
    stop,
  };
}

module.exports = {
  createWorkerServiceApp,
  resolveWorkerServiceHost,
  resolveWorkerServicePort,
  WORKER_SERVICE_PROTECTED_PREFIXES,
  workerServiceIdentityRequired,
};
