const express = require('express');
const { DB_PATH } = require('./dataPaths.cjs');
const { DEFAULT_USER_ID } = require('./defaults.cjs');
const { LocalAssetStorage, OUTPUT_DIR } = require('./assetStorage.cjs');
const { assetRepository } = require('./repositories/assetRepository.cjs');
const { authRepository } = require('./repositories/authRepository.cjs');
const { taskRepository } = require('./repositories/taskRepository.cjs');
const { registerAssetRoutes } = require('./routes/assetRoutes.cjs');
const { registerHealthRoutes } = require('./routes/healthRoutes.cjs');
const { createPublicAsset } = require('./services/assetService.cjs');
const {
  createInternalServiceIdentityMiddleware,
  pathMatchesProtectedPrefix,
  resolveInternalServiceToken,
} = require('./services/internalServiceAuthService.cjs');
const { assertInternalServiceHostAllowed } = require('./services/internalServiceExposureGuard.cjs');
const { createSecurityHeadersMiddleware } = require('./services/securityHeadersService.cjs');
const { deploymentMode } = require('./security.cjs');
const { resolveRequestConfig } = require('./services/requestConfigService.cjs');

const SAFE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const ASSET_SERVICE_PROTECTED_PREFIXES = [
  '/api/admin/health',
  '/api/asset-collection-templates',
  '/api/asset-collections',
  '/api/assets',
  '/api/images',
];

function resolveAssetServicePort(env = process.env) {
  return Number(env.WORKBENCH_ASSET_SERVICE_PORT || 3002);
}

function resolveAssetServiceHost(env = process.env) {
  return env.WORKBENCH_ASSET_SERVICE_HOST || '127.0.0.1';
}

function assetServiceIdentityRequired(pathname = '') {
  return pathMatchesProtectedPrefix(pathname, ASSET_SERVICE_PROTECTED_PREFIXES);
}

function createAssetServiceApp({ env = process.env } = {}) {
  const app = express();
  const deployment = deploymentMode(env);
  const requestConfig = resolveRequestConfig(env, deployment);
  const host = resolveAssetServiceHost(env);
  const port = resolveAssetServicePort(env);
  assertInternalServiceHostAllowed({ env, envName: 'WORKBENCH_ASSET_SERVICE_HOST', host, mode: deployment });
  const assetStorage = new LocalAssetStorage(OUTPUT_DIR);
  const publicAsset = createPublicAsset(deployment, false);
  const getRequestUserId = (req) => req.authUser?.id || DEFAULT_USER_ID;

  app.use('/api/assets/upload', express.json({ limit: `${requestConfig.uploadLimits.uploadBodyLimitMb}mb` }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ limit: '1mb' }));
  app.use(createSecurityHeadersMiddleware({ env }));
  app.use(createInternalServiceIdentityMiddleware({
    defaultUserId: DEFAULT_USER_ID,
    deployment,
    protectedPrefixes: ASSET_SERVICE_PROTECTED_PREFIXES,
    token: resolveInternalServiceToken(env),
  }));

  registerAssetRoutes(app, {
    assetRepository,
    assetStorage,
    assertOpenLocationAllowed: () => {
      throw Object.assign(new Error('Opening local file locations is not available from asset-service.'), {
        expose: true,
        status: 403,
      });
    },
    deploymentMode: deployment,
    getRequestUserId,
    openLocationEnabled: false,
    outputDir: OUTPUT_DIR,
    publicAsset,
    safeImageMimeTypes: SAFE_IMAGE_MIME_TYPES,
    uploadLimits: {
      maxDailyUploadBytes: requestConfig.uploadLimits.maxDailyUploadBytes,
      maxFileBytes: requestConfig.uploadLimits.maxFileBytes,
      maxUserAssetBytes: requestConfig.uploadLimits.maxUserAssetBytes,
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
    getQueueHealth: () => [],
    host,
    outputDir: OUTPUT_DIR,
    requireAdmin: () => true,
    serveStatic: false,
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Asset service API route not found.' });
  });

  async function stop() {}

  return {
    app,
    config: {
      dbPath: DB_PATH,
      deploymentMode: deployment,
      host,
      outputDir: OUTPUT_DIR,
      port,
    },
    stop,
  };
}

module.exports = {
  ASSET_SERVICE_PROTECTED_PREFIXES,
  createAssetServiceApp,
  assetServiceIdentityRequired,
  resolveAssetServiceHost,
  resolveAssetServicePort,
};
