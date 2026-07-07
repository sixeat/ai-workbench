const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseMegabyteLimit,
  parsePositiveInt,
  resolveEmailCodeConfig,
  resolveRateLimits,
  resolveRequestConfig,
  resolveSessionCookieOptions,
  resolveTaskQueueConfig,
  resolveUploadLimits,
} = require('./services/requestConfigService.cjs');

test('parsePositiveInt accepts only positive integers', () => {
  assert.equal(parsePositiveInt('12', 5), 12);
  assert.equal(parsePositiveInt(3, 5), 3);
  assert.equal(parsePositiveInt('0', 5), 5);
  assert.equal(parsePositiveInt('-1', 5), 5);
  assert.equal(parsePositiveInt('1.5', 5), 5);
  assert.equal(parsePositiveInt('abc', 5), 5);
});

test('parseMegabyteLimit converts positive megabytes to bytes', () => {
  assert.equal(parseMegabyteLimit('2', 5), 2 * 1024 * 1024);
  assert.equal(parseMegabyteLimit('0.5', 5), 512 * 1024);
  assert.equal(parseMegabyteLimit('0', 5), 5 * 1024 * 1024);
  assert.equal(parseMegabyteLimit('bad', 5), 5 * 1024 * 1024);
});

test('resolveSessionCookieOptions preserves split-domain cookie settings', () => {
  assert.deepEqual(resolveSessionCookieOptions({}), {
    sameSite: 'Lax',
    secure: true,
  });

  assert.deepEqual(resolveSessionCookieOptions({}, 'local'), {
    sameSite: 'Lax',
    secure: false,
  });

  assert.deepEqual(resolveSessionCookieOptions({
    WORKBENCH_COOKIE_DOMAIN: '.example.com',
    WORKBENCH_COOKIE_SAMESITE: 'None',
    WORKBENCH_COOKIE_SECURE: 'true',
  }), {
    sameSite: 'None',
    domain: '.example.com',
    secure: true,
  });

  assert.deepEqual(resolveSessionCookieOptions({
    WORKBENCH_COOKIE_SECURE: '',
  }), {
    sameSite: 'Lax',
    secure: false,
  });
});

test('resolveUploadLimits uses server and local defaults', () => {
  const server = resolveUploadLimits({}, 'server');
  assert.equal(server.maxFileBytes, 20 * 1024 * 1024);
  assert.equal(server.maxUserAssetBytes, 2048 * 1024 * 1024);
  assert.equal(server.maxDailyUploadBytes, 200 * 1024 * 1024);
  assert.equal(server.uploadBodyLimitMb, 50);

  const local = resolveUploadLimits({}, 'local');
  assert.equal(local.maxUserAssetBytes, 10240 * 1024 * 1024);
  assert.equal(local.maxDailyUploadBytes, 2048 * 1024 * 1024);
});

test('resolveUploadLimits raises JSON body limit above large file limits', () => {
  const limits = resolveUploadLimits({
    WORKBENCH_MAX_UPLOAD_FILE_MB: '80',
  }, 'server');

  assert.equal(limits.maxFileBytes, 80 * 1024 * 1024);
  assert.equal(limits.uploadBodyLimitMb, 81);
});

test('resolveRateLimits keeps server mode stricter than local mode', () => {
  assert.deepEqual(resolveRateLimits({}, 'server'), {
    windowMs: 60_000,
    expensive: 12,
    upload: 30,
    proxy: 20,
  });

  assert.deepEqual(resolveRateLimits({}, 'local'), {
    windowMs: 60_000,
    expensive: 120,
    upload: 300,
    proxy: 200,
  });
});

test('resolveEmailCodeConfig keeps email and IP rate limits mode-aware', () => {
  assert.deepEqual(resolveEmailCodeConfig({}, 'server'), {
    ttlMinutes: 10,
    windowMs: 60 * 60 * 1000,
    emailLimit: 3,
    ipLimit: 20,
    maxVerifyAttempts: 5,
  });

  assert.deepEqual(resolveEmailCodeConfig({}, 'local'), {
    ttlMinutes: 10,
    windowMs: 60 * 60 * 1000,
    emailLimit: 50,
    ipLimit: 200,
    maxVerifyAttempts: 5,
  });

  assert.equal(resolveEmailCodeConfig({
    WORKBENCH_EMAIL_CODE_MAX_VERIFY_ATTEMPTS: '7',
  }, 'server').maxVerifyAttempts, 7);

  assert.equal(resolveEmailCodeConfig({
    WORKBENCH_EMAIL_CODE_MAX_VERIFY_ATTEMPTS: '0',
  }, 'server').maxVerifyAttempts, 5);
});

test('resolveTaskQueueConfig keeps conservative defaults', () => {
  assert.deepEqual(resolveTaskQueueConfig({}), {
    textConcurrency: 2,
    generationConcurrency: 2,
    pollIntervalMs: 1000,
  });
});

test('resolveTaskQueueConfig supports separate text and generation concurrency overrides', () => {
  assert.deepEqual(resolveTaskQueueConfig({
    WORKBENCH_TEXT_QUEUE_CONCURRENCY: '5',
    WORKBENCH_GENERATION_QUEUE_CONCURRENCY: '3',
    WORKBENCH_TASK_QUEUE_POLL_INTERVAL_MS: '250',
  }), {
    textConcurrency: 5,
    generationConcurrency: 3,
    pollIntervalMs: 250,
  });
});

test('resolveTaskQueueConfig ignores invalid concurrency values', () => {
  assert.deepEqual(resolveTaskQueueConfig({
    WORKBENCH_TEXT_QUEUE_CONCURRENCY: '0',
    WORKBENCH_GENERATION_QUEUE_CONCURRENCY: '1.5',
    WORKBENCH_TASK_QUEUE_POLL_INTERVAL_MS: '-1',
  }), {
    textConcurrency: 2,
    generationConcurrency: 2,
    pollIntervalMs: 1000,
  });
});

test('resolveRequestConfig preserves key server mode defaults', () => {
  const config = resolveRequestConfig({}, 'server');

  assert.equal(config.allowDirectCredentials, false);
  assert.equal(config.allowPublicRegistration, false);
  assert.equal(config.enableGenericProxy, false);
  assert.equal(config.maxUserApiKeys, 20);
  assert.equal(config.openLocationEnabled, false);
  assert.equal(config.requireInvitationCode, true);
  assert.equal(config.requireLogin, true);
  assert.equal(config.sessionTtlDays, 14);
  assert.deepEqual(config.taskQueues, {
    textConcurrency: 2,
    generationConcurrency: 2,
    pollIntervalMs: 1000,
  });
  assert.equal(config.trustForwardedFor, false);
});

test('resolveRequestConfig supports explicit overrides without changing legacy booleans', () => {
  const config = resolveRequestConfig({
    WORKBENCH_ALLOW_DIRECT_API_KEYS: 'true',
    WORKBENCH_ALLOW_PUBLIC_REGISTRATION: 'true',
    WORKBENCH_ENABLE_GENERIC_PROXY: 'true',
    WORKBENCH_ENABLE_OPEN_LOCATION: 'true',
    WORKBENCH_EXPENSIVE_RATE_LIMIT: '8',
    WORKBENCH_MAX_USER_API_KEYS: '7',
    WORKBENCH_REQUIRE_INVITATION_CODE: 'false',
    WORKBENCH_REQUIRE_LOGIN: 'false',
    WORKBENCH_SESSION_TTL_DAYS: '30',
    WORKBENCH_TEXT_QUEUE_CONCURRENCY: '6',
    WORKBENCH_GENERATION_QUEUE_CONCURRENCY: '4',
    WORKBENCH_TASK_QUEUE_POLL_INTERVAL_MS: '300',
    WORKBENCH_TRUST_PROXY: 'true',
    WORKBENCH_UPLOAD_RATE_LIMIT: '9',
  }, 'local');

  assert.equal(config.allowDirectCredentials, true);
  assert.equal(config.allowPublicRegistration, true);
  assert.equal(config.enableGenericProxy, true);
  assert.equal(config.maxUserApiKeys, 7);
  assert.equal(config.openLocationEnabled, true);
  assert.equal(config.rateLimits.expensive, 8);
  assert.equal(config.rateLimits.upload, 9);
  assert.equal(config.requireInvitationCode, false);
  assert.equal(config.requireLogin, false);
  assert.equal(config.sessionTtlDays, 30);
  assert.deepEqual(config.taskQueues, {
    textConcurrency: 6,
    generationConcurrency: 4,
    pollIntervalMs: 300,
  });
  assert.equal(config.trustForwardedFor, true);
});
