const { parseBoolean } = require('../security.cjs');

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseMegabyteLimit(value, fallbackMb) {
  const parsed = Number(value);
  const megabytes = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMb;
  return Math.floor(megabytes * 1024 * 1024);
}

function resolveSessionCookieOptions(env = {}, mode = 'server') {
  return {
    sameSite: env.WORKBENCH_COOKIE_SAMESITE || 'Lax',
    ...(env.WORKBENCH_COOKIE_DOMAIN ? { domain: env.WORKBENCH_COOKIE_DOMAIN } : {}),
    ...(env.WORKBENCH_COOKIE_SECURE !== undefined
      ? { secure: parseBoolean(env.WORKBENCH_COOKIE_SECURE, false) }
      : { secure: mode === 'server' }),
  };
}

function resolveUploadLimits(env = {}, mode = 'server') {
  const maxFileBytes = parseMegabyteLimit(env.WORKBENCH_MAX_UPLOAD_FILE_MB, 20);
  return {
    maxFileBytes,
    maxUserAssetBytes: parseMegabyteLimit(
      env.WORKBENCH_MAX_USER_ASSET_STORAGE_MB,
      mode === 'server' ? 2048 : 10240
    ),
    maxDailyUploadBytes: parseMegabyteLimit(
      env.WORKBENCH_MAX_DAILY_UPLOAD_MB,
      mode === 'server' ? 200 : 2048
    ),
    uploadBodyLimitMb: Math.max(50, Math.ceil(maxFileBytes / 1024 / 1024) + 1),
  };
}

function resolveRateLimits(env = {}, mode = 'server') {
  return {
    windowMs: parsePositiveInt(env.WORKBENCH_RATE_LIMIT_WINDOW_MS, 60_000),
    expensive: parsePositiveInt(env.WORKBENCH_EXPENSIVE_RATE_LIMIT, mode === 'server' ? 12 : 120),
    upload: parsePositiveInt(env.WORKBENCH_UPLOAD_RATE_LIMIT, mode === 'server' ? 30 : 300),
    proxy: parsePositiveInt(env.WORKBENCH_PROXY_RATE_LIMIT, mode === 'server' ? 20 : 200),
  };
}

function resolveEmailCodeConfig(env = {}, mode = 'server') {
  return {
    ttlMinutes: parsePositiveInt(env.WORKBENCH_EMAIL_CODE_TTL_MINUTES, 10),
    windowMs: parsePositiveInt(env.WORKBENCH_EMAIL_CODE_WINDOW_MS, 60 * 60 * 1000),
    emailLimit: parsePositiveInt(env.WORKBENCH_EMAIL_CODE_EMAIL_LIMIT, mode === 'server' ? 3 : 50),
    ipLimit: parsePositiveInt(env.WORKBENCH_EMAIL_CODE_IP_LIMIT, mode === 'server' ? 20 : 200),
    maxVerifyAttempts: parsePositiveInt(env.WORKBENCH_EMAIL_CODE_MAX_VERIFY_ATTEMPTS, 5),
  };
}

function resolveTaskQueueConfig(env = {}) {
  return {
    textConcurrency: parsePositiveInt(env.WORKBENCH_TEXT_QUEUE_CONCURRENCY, 2),
    generationConcurrency: parsePositiveInt(env.WORKBENCH_GENERATION_QUEUE_CONCURRENCY, 2),
    pollIntervalMs: parsePositiveInt(env.WORKBENCH_TASK_QUEUE_POLL_INTERVAL_MS, 1000),
  };
}

function resolveRequestConfig(env = {}, mode = 'server') {
  return {
    allowDirectCredentials: env.WORKBENCH_ALLOW_DIRECT_API_KEYS === 'true',
    allowPublicRegistration: env.WORKBENCH_ALLOW_PUBLIC_REGISTRATION === 'true',
    emailCode: resolveEmailCodeConfig(env, mode),
    enableGenericProxy: env.WORKBENCH_ENABLE_GENERIC_PROXY === 'true',
    maxUserApiKeys: parsePositiveInt(env.WORKBENCH_MAX_USER_API_KEYS, mode === 'server' ? 20 : 100),
    openLocationEnabled: mode === 'local' && env.WORKBENCH_ENABLE_OPEN_LOCATION === 'true',
    rateLimits: resolveRateLimits(env, mode),
    requireInvitationCode: env.WORKBENCH_REQUIRE_INVITATION_CODE !== 'false',
    requireLogin: env.WORKBENCH_REQUIRE_LOGIN !== 'false',
    sessionCookieOptions: resolveSessionCookieOptions(env, mode),
    sessionTtlDays: parsePositiveInt(env.WORKBENCH_SESSION_TTL_DAYS, 14),
    taskQueues: resolveTaskQueueConfig(env),
    trustForwardedFor: env.WORKBENCH_TRUST_PROXY === 'true',
    uploadLimits: resolveUploadLimits(env, mode),
  };
}

module.exports = {
  parseMegabyteLimit,
  parsePositiveInt,
  resolveEmailCodeConfig,
  resolveRateLimits,
  resolveRequestConfig,
  resolveSessionCookieOptions,
  resolveTaskQueueConfig,
  resolveUploadLimits,
};
