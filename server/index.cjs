const express = require('express');
const cors = require('cors');
const path = require('path');
const { loadEnv } = require('./env.cjs');

loadEnv();

const {
  DEFAULT_USER_ID,
  DB_PATH,
  countAllAssets,
  countAllTasks,
  countAllUsers,
  countAssets,
  countEnabledUsers,
  countTasks,
  deleteSessionByTokenHash,
  upsertBootstrapUser,
} = require('./db.cjs');
const {
  hashPassword,
} = require('./auth.cjs');
const { LocalAssetStorage, OUTPUT_DIR } = require('./assetStorage.cjs');
const {
  assertOpenLocationAllowed,
  assertProxyConfiguration,
  buildProxyAllowlist,
  deploymentMode,
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
const { createApiKeyTestService } = require('./services/apiKeyTestService.cjs');
const { createCredentialService } = require('./services/credentialService.cjs');
const { joinUrl, proxyRequest } = require('./services/proxyService.cjs');
const { createSecretService } = require('./services/secretService.cjs');
const { createTaskService } = require('./services/taskService.cjs');
const { createRateLimitFactory } = require('./services/rateLimitService.cjs');
const { bootstrapAdminUser } = require('./services/bootstrapService.cjs');
const { createSecurityHeadersMiddleware } = require('./services/securityHeadersService.cjs');
const { createSessionMiddleware } = require('./services/sessionMiddlewareService.cjs');
const { createApiAuthMiddleware } = require('./services/apiAuthMiddlewareService.cjs');
const { resolveRequestConfig } = require('./services/requestConfigService.cjs');
const { createRequestUserIdResolver, createRequireAdmin } = require('./services/requestIdentityService.cjs');
const { createTaskRetryDispatcher } = require('./services/taskRetryDispatcher.cjs');

const app = express();
const PORT = process.env.PROXY_PORT || 3000;
const DEPLOYMENT_MODE = deploymentMode();
const HOST = resolveHost(process.env, DEPLOYMENT_MODE);
const SECRETS_PATH = path.join(__dirname, 'secrets.json');
const assetStorage = new LocalAssetStorage(OUTPUT_DIR);
const KEY_ENCRYPTION_SECRET = resolveKeyEncryptionSecret(process.env, DEPLOYMENT_MODE);
const ACCESS_TOKEN = resolveAccessToken(process.env, DEPLOYMENT_MODE);
const ADMIN_TOKEN = resolveAdminToken(process.env, DEPLOYMENT_MODE);
const DIST_DIR = path.join(__dirname, '..', 'dist');
const SERVE_STATIC = resolveServeStatic(process.env, DEPLOYMENT_MODE);
const CORS_ORIGIN = resolveCorsOrigin(process.env, DEPLOYMENT_MODE);
const TRUST_CLIENT_USER_ID = shouldTrustClientUserId(process.env, DEPLOYMENT_MODE, HOST);
const ENABLE_SYNC_GENERATION = resolveSyncGeneration(process.env, DEPLOYMENT_MODE);
const PROXY_ALLOWLIST = buildProxyAllowlist(process.env);
const SAFE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const REQUEST_CONFIG = resolveRequestConfig(process.env, DEPLOYMENT_MODE);
const {
  allowDirectCredentials: ALLOW_DIRECT_CREDENTIALS,
  allowPublicRegistration: ALLOW_PUBLIC_REGISTRATION,
  emailCode: EMAIL_CODE_CONFIG,
  enableGenericProxy: ENABLE_GENERIC_PROXY,
  maxUserApiKeys: MAX_USER_API_KEYS,
  openLocationEnabled: OPEN_LOCATION_ENABLED,
  rateLimits: RATE_LIMITS,
  requireInvitationCode: REQUIRE_INVITATION_CODE,
  requireLogin: REQUIRE_LOGIN,
  sessionCookieOptions: SESSION_COOKIE_OPTIONS,
  sessionTtlDays: SESSION_TTL_DAYS,
  taskQueues: TASK_QUEUE_CONFIG,
  trustForwardedFor: TRUST_FORWARDED_FOR,
  uploadLimits: UPLOAD_LIMITS,
} = REQUEST_CONFIG;
const rateLimit = createRateLimitFactory({
  trustForwardedFor: TRUST_FORWARDED_FOR,
});
const publicAsset = createPublicAsset(DEPLOYMENT_MODE, OPEN_LOCATION_ENABLED);
const credentialService = createCredentialService({
  keyEncryptionSecret: KEY_ENCRYPTION_SECRET,
  deploymentMode: DEPLOYMENT_MODE,
  allowDirectCredentials: ALLOW_DIRECT_CREDENTIALS,
});
const taskService = createTaskService({
  publicAsset,
});
const secretService = createSecretService({
  deploymentMode: DEPLOYMENT_MODE,
  env: process.env,
  secretsPath: SECRETS_PATH,
});
const apiKeyTestService = createApiKeyTestService({
  joinUrl,
  proxyRequest,
  readSecrets: secretService.readSecrets,
  resolveApiCredentials: credentialService.resolveApiCredentials,
});

assertProxyConfiguration({
  mode: DEPLOYMENT_MODE,
  enabled: ENABLE_GENERIC_PROXY,
  allowlist: PROXY_ALLOWLIST,
});

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-workbench-token', 'x-workbench-admin-token'],
}));

app.use(['/api/assets/upload', '/api/images', '/api/videos'], express.json({ limit: `${UPLOAD_LIMITS.uploadBodyLimitMb}mb` }));
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ limit: '1mb' }));

bootstrapAdminUser({
  env: process.env,
  hashPassword,
  upsertBootstrapUser,
});

app.use(createSecurityHeadersMiddleware({ env: process.env }));
app.use(createSessionMiddleware({
  sessionCookieOptions: SESSION_COOKIE_OPTIONS,
}));

app.use('/api', createApiAuthMiddleware({
  accessToken: ACCESS_TOKEN,
  requireLogin: REQUIRE_LOGIN,
}));

const expensiveRateLimit = rateLimit({
  windowMs: RATE_LIMITS.windowMs,
  max: RATE_LIMITS.expensive,
  label: 'generation',
});
const uploadRateLimit = rateLimit({
  windowMs: RATE_LIMITS.windowMs,
  max: RATE_LIMITS.upload,
  label: 'upload',
});
const proxyRateLimit = rateLimit({
  windowMs: RATE_LIMITS.windowMs,
  max: RATE_LIMITS.proxy,
  label: 'proxy',
});

app.use(['/api/images', '/api/videos', '/api/chat', '/api/claude'], expensiveRateLimit);
app.use('/api/assets/upload', uploadRateLimit);
app.use('/api/proxy', proxyRateLimit);

const requireAdmin = createRequireAdmin({
  adminToken: ADMIN_TOKEN,
  deploymentMode: DEPLOYMENT_MODE,
});

const getRequestUserId = createRequestUserIdResolver({
  defaultUserId: DEFAULT_USER_ID,
  trustClientUserId: TRUST_CLIENT_USER_ID,
});

registerAuthRoutes(app, {
  allowPublicRegistration: ALLOW_PUBLIC_REGISTRATION,
  deleteSessionByTokenHash,
  deploymentMode: DEPLOYMENT_MODE,
  emailCodeRateLimit: createEmailCodeRateLimit({
    windowMs: EMAIL_CODE_CONFIG.windowMs,
    maxPerEmail: EMAIL_CODE_CONFIG.emailLimit,
    maxPerIp: EMAIL_CODE_CONFIG.ipLimit,
  }),
  emailCodeTtlMinutes: EMAIL_CODE_CONFIG.ttlMinutes,
  getRequestUserId,
  rateLimit,
  requireAdmin,
  requireInvitationCode: REQUIRE_INVITATION_CODE,
  requireLogin: REQUIRE_LOGIN,
  sessionCookieOptions: SESSION_COOKIE_OPTIONS,
  sessionTtlDays: SESSION_TTL_DAYS,
  windowMs: RATE_LIMITS.windowMs,
});

const modelProxyHandlers = registerModelProxyRoutes(app, {
  enableGenericProxy: ENABLE_GENERIC_PROXY,
  joinUrl,
  proxyAllowlist: PROXY_ALLOWLIST,
  proxyRequest,
  getRequestUserId,
  readSecrets: secretService.readSecrets,
  resolveApiCredentials: credentialService.resolveApiCredentials,
  requireAdmin,
  resolveDirectCredentials: credentialService.resolveDirectCredentials,
  allowSyncGeneration: ENABLE_SYNC_GENERATION,
  textQueueConcurrency: TASK_QUEUE_CONFIG.textConcurrency,
});

const generationHandlers = registerGenerationRoutes(app, {
  assetStorage,
  getRequestUserId,
  joinUrl,
  proxyRequest,
  publicAsset,
  readSecrets: secretService.readSecrets,
  resolveApiCredentials: credentialService.resolveApiCredentials,
  allowSyncGeneration: ENABLE_SYNC_GENERATION,
  generationQueueConcurrency: TASK_QUEUE_CONFIG.generationConcurrency,
  uploadLimits: {
    maxUserAssetBytes: UPLOAD_LIMITS.maxUserAssetBytes,
  },
});

registerApiKeyRoutes(app, {
  encryptSecret: credentialService.encryptSecret,
  getRequestUserId,
  keyBelongsToUser: credentialService.keyBelongsToUser,
  maxUserApiKeys: MAX_USER_API_KEYS,
  requireAdmin,
  testApiKey: apiKeyTestService.testApiKey,
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
  deploymentMode: DEPLOYMENT_MODE,
  getRequestUserId,
  openLocationEnabled: OPEN_LOCATION_ENABLED,
  outputDir: OUTPUT_DIR,
  publicAsset,
  safeImageMimeTypes: SAFE_IMAGE_MIME_TYPES,
  uploadLimits: {
    maxFileBytes: UPLOAD_LIMITS.maxFileBytes,
    maxUserAssetBytes: UPLOAD_LIMITS.maxUserAssetBytes,
    maxDailyUploadBytes: UPLOAD_LIMITS.maxDailyUploadBytes,
  },
});

registerHealthRoutes(app, {
  countAllAssets,
  countAllTasks,
  countAllUsers,
  countAssets,
  countEnabledUsers,
  countTasks,
  dbPath: DB_PATH,
  defaultUserId: DEFAULT_USER_ID,
  deploymentMode: DEPLOYMENT_MODE,
  host: HOST,
  getQueueHealth: () => [
    modelProxyHandlers.getTextQueueStats(),
    generationHandlers.getGenerationQueueStats(),
  ],
  outputDir: OUTPUT_DIR,
  requireAdmin,
  serveStatic: SERVE_STATIC,
});

if (SERVE_STATIC) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`\n  AI Workbench Proxy Server\n  Listening on http://localhost:${PORT}\n`);
  console.log(`  Host: ${HOST}`);
  console.log('  Endpoints:');
  console.log('    POST /api/models   - models');
  console.log('    POST /api/chat     - chat');
  console.log('    POST /api/images   - image generation');
  console.log('    POST /api/claude   - Claude messages');
  console.log('    POST /api/proxy    - generic proxy');
  console.log('    GET  /api/tasks    - task history');
  console.log('    GET  /api/workflows - workflows');
  console.log('    GET  /api/providers - provider templates');
  console.log('    GET  /api/assets   - assets');
  console.log('    GET  /api/assets/:id');
  console.log('    GET  /api/model-capabilities');
  console.log('    GET  /api/model-capability-presets');
  console.log('    GET  /api/health');
  console.log('    GET  /api/admin/health');
  console.log(`  SQLite DB: ${DB_PATH}`);
  console.log(`  Assets will be saved to ${OUTPUT_DIR}`);
  console.log(`  Static frontend: ${SERVE_STATIC ? DIST_DIR : 'disabled'}`);
  console.log(`  Sync generation endpoints: ${ENABLE_SYNC_GENERATION ? 'enabled' : 'disabled'}`);
  console.log('');
});
