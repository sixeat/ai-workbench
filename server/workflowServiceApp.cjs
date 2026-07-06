const express = require('express');
const { DB_PATH } = require('./dataPaths.cjs');
const { DEFAULT_USER_ID } = require('./defaults.cjs');
const { assetRepository } = require('./repositories/assetRepository.cjs');
const { authRepository } = require('./repositories/authRepository.cjs');
const { taskRepository } = require('./repositories/taskRepository.cjs');
const { workflowRepository } = require('./repositories/workflowRepository.cjs');
const { registerHealthRoutes } = require('./routes/healthRoutes.cjs');
const { registerWorkflowRoutes } = require('./routes/workflowRoutes.cjs');
const {
  createInternalServiceIdentityMiddleware,
  pathMatchesProtectedPrefix,
  resolveInternalServiceToken,
} = require('./services/internalServiceAuthService.cjs');
const { assertInternalServiceHostAllowed } = require('./services/internalServiceExposureGuard.cjs');
const { createRequestUserIdResolver, createRequireAdmin } = require('./services/requestIdentityService.cjs');
const { createSecurityHeadersMiddleware } = require('./services/securityHeadersService.cjs');
const {
  deploymentMode,
  resolveAdminToken,
} = require('./security.cjs');

const WORKFLOW_SERVICE_PROTECTED_PREFIXES = [
  '/api/admin/health',
  '/api/workflows',
];

function resolveWorkflowServicePort(env = process.env) {
  return Number(env.WORKBENCH_WORKFLOW_SERVICE_PORT || 3005);
}

function resolveWorkflowServiceHost(env = process.env) {
  return env.WORKBENCH_WORKFLOW_SERVICE_HOST || '127.0.0.1';
}

function workflowServiceIdentityRequired(pathname = '') {
  return pathMatchesProtectedPrefix(pathname, WORKFLOW_SERVICE_PROTECTED_PREFIXES);
}

function createWorkflowServiceApp({ env = process.env } = {}) {
  const app = express();
  const deployment = deploymentMode(env);
  const host = resolveWorkflowServiceHost(env);
  const port = resolveWorkflowServicePort(env);
  assertInternalServiceHostAllowed({ env, envName: 'WORKBENCH_WORKFLOW_SERVICE_HOST', host, mode: deployment });
  const adminToken = resolveAdminToken(env, deployment);
  const getRequestUserId = createRequestUserIdResolver({
    defaultUserId: DEFAULT_USER_ID,
    trustClientUserId: false,
  });
  const requireAdmin = createRequireAdmin({
    adminToken,
    deploymentMode: deployment,
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ limit: '1mb' }));
  app.use(createSecurityHeadersMiddleware({ env }));
  app.use(createInternalServiceIdentityMiddleware({
    defaultUserId: DEFAULT_USER_ID,
    deployment,
    protectedPrefixes: WORKFLOW_SERVICE_PROTECTED_PREFIXES,
    token: resolveInternalServiceToken(env),
  }));

  registerWorkflowRoutes(app, {
    getRequestUserId,
    workflowRepository,
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
    outputDir: '',
    requireAdmin,
    serveStatic: false,
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Workflow service API route not found.' });
  });

  async function stop() {}

  return {
    app,
    config: {
      dbPath: DB_PATH,
      deploymentMode: deployment,
      host,
      port,
    },
    stop,
  };
}

module.exports = {
  WORKFLOW_SERVICE_PROTECTED_PREFIXES,
  createWorkflowServiceApp,
  resolveWorkflowServiceHost,
  resolveWorkflowServicePort,
  workflowServiceIdentityRequired,
};
