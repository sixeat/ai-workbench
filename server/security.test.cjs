const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertGenericProxyAllowed,
  assertOpenLocationAllowed,
  assertProxyConfiguration,
  buildProxyAllowlist,
  getRequestUserId,
  isAdminRequestAuthorized,
  isApiRequestAuthorized,
  resolveAdminToken,
  resolveAccessToken,
  resolveCorsOrigin,
  resolveHost,
  resolveKeyEncryptionSecret,
  resolveServeStatic,
  resolveSyncGeneration,
  shouldTrustClientUserId,
} = require('./security.cjs');

test('server mode requires a real key encryption secret', () => {
  assert.throws(
    () => resolveKeyEncryptionSecret({ WORKBENCH_DEPLOYMENT_MODE: 'server' }, 'server'),
    /WORKBENCH_KEY_SECRET/
  );

  assert.throws(
    () => resolveKeyEncryptionSecret({
      WORKBENCH_DEPLOYMENT_MODE: 'server',
      WORKBENCH_KEY_SECRET: 'replace-with-a-long-random-secret',
    }, 'server'),
    /WORKBENCH_KEY_SECRET/
  );

  assert.equal(
    resolveKeyEncryptionSecret({
      WORKBENCH_DEPLOYMENT_MODE: 'server',
      WORKBENCH_KEY_SECRET: '0123456789abcdef0123456789abcdef',
    }, 'server'),
    '0123456789abcdef0123456789abcdef'
  );
});

test('server mode does not require a shared access token when login is enabled', () => {
  assert.equal(
    resolveAccessToken({ WORKBENCH_DEPLOYMENT_MODE: 'server' }, 'server'),
    ''
  );

  assert.equal(
    resolveAccessToken({
      WORKBENCH_DEPLOYMENT_MODE: 'server',
      WORKBENCH_REQUIRE_LOGIN: 'true',
    }, 'server'),
    ''
  );

  assert.equal(
    resolveAccessToken({
      WORKBENCH_DEPLOYMENT_MODE: 'server',
      WORKBENCH_ACCESS_TOKEN: 'shared-secret',
    }, 'server'),
    'shared-secret'
  );
});

test('server mode requires an access token when login is disabled unless public mode is explicit', () => {
  assert.throws(
    () => resolveAccessToken({
      WORKBENCH_DEPLOYMENT_MODE: 'server',
      WORKBENCH_REQUIRE_LOGIN: 'false',
    }, 'server'),
    /WORKBENCH_ACCESS_TOKEN/
  );

  assert.equal(
    resolveAccessToken({
      WORKBENCH_DEPLOYMENT_MODE: 'server',
      WORKBENCH_REQUIRE_LOGIN: 'false',
      WORKBENCH_ACCESS_TOKEN: 'shared-secret',
    }, 'server'),
    'shared-secret'
  );

  assert.equal(
    resolveAccessToken({
      WORKBENCH_DEPLOYMENT_MODE: 'server',
      WORKBENCH_REQUIRE_LOGIN: 'false',
      WORKBENCH_ALLOW_PUBLIC_SERVER: 'true',
    }, 'server'),
    ''
  );
});

test('server mode rejects identical admin and access tokens', () => {
  assert.throws(
    () => resolveAdminToken({
      WORKBENCH_DEPLOYMENT_MODE: 'server',
      WORKBENCH_ACCESS_TOKEN: 'same-token',
      WORKBENCH_ADMIN_TOKEN: 'same-token',
    }, 'server'),
    /WORKBENCH_ADMIN_TOKEN/
  );

  assert.equal(resolveAdminToken({
    WORKBENCH_DEPLOYMENT_MODE: 'server',
    WORKBENCH_ACCESS_TOKEN: 'access-token',
    WORKBENCH_ADMIN_TOKEN: 'admin-token',
  }, 'server'), 'admin-token');
});

test('local mode stays convenient but binds to loopback by default', () => {
  assert.equal(resolveHost({}, 'local'), '127.0.0.1');
  assert.equal(resolveHost({}, 'server'), '0.0.0.0');
  assert.equal(resolveKeyEncryptionSecret({}, 'local'), 'ai-workbench-local-development-secret');
});

test('browser-provided user ids are never trusted by default', () => {
  const req = {
    headers: { 'x-user-id': 'attacker' },
    query: { userId: 'query-user' },
    body: { userId: 'body-user' },
  };

  assert.equal(shouldTrustClientUserId({}, 'server'), false);
  assert.equal(shouldTrustClientUserId({}, 'local', '127.0.0.1'), false);
  assert.equal(shouldTrustClientUserId({}, 'local', '0.0.0.0'), false);
  assert.equal(getRequestUserId(req, 'local-user', { trustClientUserId: false }), 'local-user');
  assert.equal(getRequestUserId(req, 'local-user', { trustClientUserId: true }), 'attacker');
});

test('api authorization accepts bearer or header token only', () => {
  assert.equal(isApiRequestAuthorized({ headers: {}, query: {} }, 'shared-secret'), false);
  assert.equal(isApiRequestAuthorized({
    headers: { authorization: 'Bearer shared-secret' },
    query: {},
  }, 'shared-secret'), true);
  assert.equal(isApiRequestAuthorized({
    headers: { 'x-workbench-token': 'shared-secret' },
    query: {},
  }, 'shared-secret'), true);
  assert.equal(isApiRequestAuthorized({
    headers: {},
    query: { accessToken: 'shared-secret' },
  }, 'shared-secret'), false);
});

test('admin authorization requires admin token in server mode', () => {
  assert.equal(isAdminRequestAuthorized({ headers: {}, query: {} }, '', 'server'), false);
  assert.equal(isAdminRequestAuthorized({
    headers: { 'x-workbench-admin-token': 'admin-secret' },
    query: {},
  }, 'admin-secret', 'server'), true);
  assert.equal(isAdminRequestAuthorized({ headers: {}, query: {} }, '', 'local'), false);
});

test('generic proxy is disabled unless explicitly enabled and allowlisted', () => {
  assert.throws(
    () => assertGenericProxyAllowed('https://api.openai.com/v1/models', { enabled: false }),
    /Generic proxy is disabled/
  );

  const allowlist = buildProxyAllowlist({ WORKBENCH_PROXY_ALLOWLIST: 'api.openai.com,*.volces.com' });
  assert.doesNotThrow(() => assertGenericProxyAllowed('https://api.openai.com/v1/models', {
    enabled: true,
    allowlist,
  }));
  assert.doesNotThrow(() => assertGenericProxyAllowed('https://ark.cn-beijing.volces.com/api/v3', {
    enabled: true,
    allowlist,
  }));
  assert.throws(() => assertGenericProxyAllowed('https://example.com', {
    enabled: true,
    allowlist,
  }), /not allowed/);
});

test('server mode requires proxy allowlist when generic proxy is enabled', () => {
  assert.throws(
    () => assertProxyConfiguration({ mode: 'server', enabled: true, allowlist: [] }),
    /WORKBENCH_PROXY_ALLOWLIST/
  );
  assert.doesNotThrow(() => assertProxyConfiguration({ mode: 'server', enabled: true, allowlist: ['api.openai.com'] }));
  assert.doesNotThrow(() => assertProxyConfiguration({ mode: 'server', enabled: false, allowlist: [] }));
});

test('open-location is local-only', () => {
  const previous = process.env.WORKBENCH_ENABLE_OPEN_LOCATION;
  delete process.env.WORKBENCH_ENABLE_OPEN_LOCATION;
  assert.throws(() => assertOpenLocationAllowed('local'), /disabled/);
  process.env.WORKBENCH_ENABLE_OPEN_LOCATION = 'true';
  assert.doesNotThrow(() => assertOpenLocationAllowed('local'));
  assert.throws(() => assertOpenLocationAllowed('server'), /local mode/);
  if (previous === undefined) {
    delete process.env.WORKBENCH_ENABLE_OPEN_LOCATION;
  } else {
    process.env.WORKBENCH_ENABLE_OPEN_LOCATION = previous;
  }
});

test('server mode disables CORS by default and local mode only allows local origins', () => {
  assert.equal(resolveCorsOrigin({}, 'server'), false);

  const localCors = resolveCorsOrigin({}, 'local');
  assert.equal(typeof localCors, 'function');

  localCors('http://localhost:5173', (error, allowed) => {
    assert.equal(error, null);
    assert.equal(allowed, true);
  });

  localCors('https://evil.example', (error, allowed) => {
    assert.equal(error, null);
    assert.equal(allowed, false);
  });
});

test('static frontend serving defaults to local only and can be explicit', () => {
  assert.equal(resolveServeStatic({}, 'server'), false);
  assert.equal(resolveServeStatic({}, 'local'), true);
  assert.equal(resolveServeStatic({ WORKBENCH_SERVE_STATIC: 'true' }, 'server'), true);
  assert.equal(resolveServeStatic({ WORKBENCH_SERVE_STATIC: 'false' }, 'local'), false);
});

test('sync generation endpoints are local-only and opt-in', () => {
  assert.equal(resolveSyncGeneration({}, 'server'), false);
  assert.equal(resolveSyncGeneration({ WORKBENCH_ENABLE_SYNC_GENERATION: 'true' }, 'server'), false);
  assert.equal(resolveSyncGeneration({}, 'local'), false);
  assert.equal(resolveSyncGeneration({ WORKBENCH_ENABLE_SYNC_GENERATION: 'true' }, 'local'), true);
});
