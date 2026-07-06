const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applySecurityHeaders,
  buildContentSecurityPolicy,
  configuredCspSource,
  createSecurityHeadersMiddleware,
} = require('./services/securityHeadersService.cjs');

function createMockRes() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
  };
}

test('configuredCspSource uses trimmed env values and falls back safely', () => {
  assert.equal(configuredCspSource({}, 'WORKBENCH_CSP_IMG_SRC', "'self'"), "'self'");
  assert.equal(
    configuredCspSource({ WORKBENCH_CSP_IMG_SRC: '  https://cdn.example.com data:  ' }, 'WORKBENCH_CSP_IMG_SRC', "'self'"),
    'https://cdn.example.com data:'
  );
});

test('buildContentSecurityPolicy keeps restrictive defaults', () => {
  const policy = buildContentSecurityPolicy();

  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /script-src 'self'/);
  assert.match(policy, /style-src 'self' 'unsafe-inline'/);
  assert.match(policy, /img-src 'self' data: blob:/);
  assert.match(policy, /media-src 'self' data: blob:/);
  assert.match(policy, /connect-src 'self'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /base-uri 'self'/);
  assert.match(policy, /form-action 'self'/);
});

test('buildContentSecurityPolicy supports explicit media and connect overrides', () => {
  const policy = buildContentSecurityPolicy({
    WORKBENCH_CSP_IMG_SRC: "'self' https://img.example.com",
    WORKBENCH_CSP_MEDIA_SRC: "'self' https://media.example.com",
    WORKBENCH_CSP_CONNECT_SRC: "'self' https://api.example.com",
  });

  assert.match(policy, /img-src 'self' https:\/\/img\.example\.com/);
  assert.match(policy, /media-src 'self' https:\/\/media\.example\.com/);
  assert.match(policy, /connect-src 'self' https:\/\/api\.example\.com/);
});

test('applySecurityHeaders writes all baseline browser protection headers', () => {
  const res = createMockRes();
  applySecurityHeaders(res, { env: {} });

  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['referrer-policy'], 'same-origin');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
});

test('security headers middleware applies headers then calls next', () => {
  const res = createMockRes();
  let nextCalls = 0;
  const middleware = createSecurityHeadersMiddleware({ env: {} });

  middleware({}, res, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 1);
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
});
