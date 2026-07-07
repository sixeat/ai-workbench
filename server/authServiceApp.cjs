const express = require('express');
const { DB_PATH } = require('./dataPaths.cjs');
const { DEFAULT_USER_ID } = require('./defaults.cjs');
const { hashPassword } = require('./auth.cjs');
const { assetRepository } = require('./repositories/assetRepository.cjs');
const { authRepository } = require('./repositories/authRepository.cjs');
const { taskRepository } = require('./repositories/taskRepository.cjs');
const { createEmailCodeRateLimit, registerAuthRoutes } = require('./routes/authRoutes.cjs');
const { registerCreditRoutes } = require('./routes/creditRoutes.cjs');
const { registerHealthRoutes } = require('./routes/healthRoutes.cjs');
const { bootstrapAdminUser } = require('./services/bootstrapService.cjs');
const {
  createInternalServiceIdentityMiddleware,
  pathMatchesProtectedPrefix,
  resolveInternalServiceToken,
} = require('./services/internalServiceAuthService.cjs');
const { assertInternalServiceHostAllowed } = require('./services/internalServiceExposureGuard.cjs');
const { createRateLimitFactory } = require('./services/rateLimitService.cjs');
const { createRequestUserIdResolver, createRequireAdmin } = require('./services/requestIdentityService.cjs');
const { resolveRequestConfig } = require('./services/requestConfigService.cjs');
const { createSecurityHeadersMiddleware } = require('./services/securityHeadersService.cjs');
const { createSessionMiddleware } = require('./services/sessionMiddlewareService.cjs');
const { createCreditService } = require('./services/creditService.cjs');
const {
  deploymentMode,
  resolveAdminToken,
} = require('./security.cjs');

const AUTH_SERVICE_PROTECTED_PREFIXES = [
  '/api/admin',
];

function resolveAuthServicePort(env = process.env) {
  return Number(env.WORKBENCH_AUTH_SERVICE_PORT || 3004);
}

function resolveAuthServiceHost(env = process.env) {
  return env.WORKBENCH_AUTH_SERVICE_HOST || '127.0.0.1';
}

function authServiceIdentityRequired(pathname = '') {
  return pathMatchesProtectedPrefix(pathname, AUTH_SERVICE_PROTECTED_PREFIXES);
}

function createAuthServiceApp({ env = process.env } = {}) {
  const app = express();
  const deployment = deploymentMode(env);
  const requestConfig = resolveRequestConfig(env, deployment);
  const host = resolveAuthServiceHost(env);
  const port = resolveAuthServicePort(env);
  assertInternalServiceHostAllowed({ env, envName: 'WORKBENCH_AUTH_SERVICE_HOST', host, mode: deployment });
  const adminToken = resolveAdminToken(env, deployment);
  const rateLimit = createRateLimitFactory({
    trustForwardedFor: requestConfig.trustForwardedFor,
  });
  const requireAdmin = createRequireAdmin({
    adminToken,
    deploymentMode: deployment,
  });
  const getRequestUserId = createRequestUserIdResolver({
    defaultUserId: DEFAULT_USER_ID,
    trustClientUserId: false,
  });
  const creditService = createCreditService();

  bootstrapAdminUser({
    env,
    hashPassword,
    upsertBootstrapUser: authRepository.upsertBootstrapUser,
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ limit: '1mb' }));
  app.use(createSecurityHeadersMiddleware({ env }));
  app.use(createSessionMiddleware({
    authRepository,
    sessionCookieOptions: requestConfig.sessionCookieOptions,
  }));
  app.use(createInternalServiceIdentityMiddleware({
    defaultUserId: DEFAULT_USER_ID,
    deployment,
    protectedPrefixes: AUTH_SERVICE_PROTECTED_PREFIXES,
    token: resolveInternalServiceToken(env),
  }));

  registerAuthRoutes(app, {
    allowPublicRegistration: requestConfig.allowPublicRegistration,
    authRepository,
    deploymentMode: deployment,
    emailCodeRateLimit: createEmailCodeRateLimit({
      maxPerEmail: requestConfig.emailCode.emailLimit,
      maxPerIp: requestConfig.emailCode.ipLimit,
      windowMs: requestConfig.emailCode.windowMs,
    }),
    emailCodeTtlMinutes: requestConfig.emailCode.ttlMinutes,
    getRequestUserId,
    maxEmailCodeVerifyAttempts: requestConfig.emailCode.maxVerifyAttempts,
    rateLimit,
    requireAdmin,
    requireInvitationCode: requestConfig.requireInvitationCode,
    requireLogin: requestConfig.requireLogin,
    sessionCookieOptions: requestConfig.sessionCookieOptions,
    sessionTtlDays: requestConfig.sessionTtlDays,
    windowMs: requestConfig.rateLimits.windowMs,
  });

  registerCreditRoutes(app, {
    creditService,
    getRequestUserId,
    requireAdmin,
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
    res.status(404).json({ error: 'Auth service API route not found.' });
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
  AUTH_SERVICE_PROTECTED_PREFIXES,
  authServiceIdentityRequired,
  createAuthServiceApp,
  resolveAuthServiceHost,
  resolveAuthServicePort,
};
