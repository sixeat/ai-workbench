const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createRateLimitFactory,
  requestIp,
} = require('./services/rateLimitService.cjs');

function createMockRes() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createReq({ forwardedFor = '', ip = '10.0.0.10', remoteAddress = '10.0.0.20' } = {}) {
  return {
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    ip,
    socket: { remoteAddress },
  };
}

function runMiddleware(middleware, req = createReq()) {
  const res = createMockRes();
  let nextCalls = 0;
  middleware(req, res, () => {
    nextCalls += 1;
  });
  return { nextCalls, res };
}

test('rate limit blocks requests above the configured limit', () => {
  let currentTime = 1_000;
  const rateLimit = createRateLimitFactory({ now: () => currentTime });
  const middleware = rateLimit({ windowMs: 60_000, max: 1, label: 'login' });

  assert.equal(runMiddleware(middleware).nextCalls, 1);

  const blocked = runMiddleware(middleware);
  assert.equal(blocked.nextCalls, 0);
  assert.equal(blocked.res.statusCode, 429);
  assert.equal(blocked.res.headers['retry-after'], '60');
  assert.deepEqual(blocked.res.body, { error: 'Too many login requests. Please try again later.' });

  currentTime += 60_001;
  assert.equal(runMiddleware(middleware).nextCalls, 1);
});

test('rate limit does not trust x-forwarded-for unless enabled', () => {
  const rateLimit = createRateLimitFactory({ now: () => 1_000, trustForwardedFor: false });
  const middleware = rateLimit({ windowMs: 60_000, max: 1, label: 'proxy' });

  assert.equal(runMiddleware(middleware, createReq({ forwardedFor: '203.0.113.1', ip: '10.0.0.5' })).nextCalls, 1);
  const blocked = runMiddleware(middleware, createReq({ forwardedFor: '203.0.113.2', ip: '10.0.0.5' }));

  assert.equal(blocked.res.statusCode, 429);
});

test('rate limit can trust x-forwarded-for when proxy trust is explicit', () => {
  const rateLimit = createRateLimitFactory({ now: () => 1_000, trustForwardedFor: true });
  const middleware = rateLimit({ windowMs: 60_000, max: 1, label: 'proxy' });

  assert.equal(runMiddleware(middleware, createReq({ forwardedFor: '203.0.113.1', ip: '10.0.0.5' })).nextCalls, 1);
  assert.equal(runMiddleware(middleware, createReq({ forwardedFor: '203.0.113.2', ip: '10.0.0.5' })).nextCalls, 1);
});

test('requestIp falls back to socket address and unknown safely', () => {
  assert.equal(requestIp(createReq({ forwardedFor: '203.0.113.8', ip: '10.0.0.5' }), true), '203.0.113.8');
  assert.equal(requestIp({ headers: {}, socket: { remoteAddress: '10.0.0.20' } }, false), '10.0.0.20');
  assert.equal(requestIp({ headers: {}, socket: {} }, false), 'unknown');
});
