const assert = require('node:assert/strict');
const test = require('node:test');

const { createEmailCodeRateLimit } = require('./routes/authRoutes.cjs');

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
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

function runMiddleware(middleware, req) {
  const res = createMockRes();
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

test('email verification limiter blocks repeated requests for the same email', () => {
  const limit = createEmailCodeRateLimit({
    windowMs: 60_000,
    maxPerEmail: 2,
    maxPerIp: 100,
  })('register');

  assert.equal(runMiddleware(limit, { body: { email: 'Person@Example.com' }, ip: '203.0.113.1' }).nextCalled, true);
  assert.equal(runMiddleware(limit, { body: { email: 'person@example.com' }, ip: '203.0.113.2' }).nextCalled, true);

  const blocked = runMiddleware(limit, { body: { email: 'person@example.com' }, ip: '203.0.113.3' });
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.match(blocked.res.body.error, /verification code/i);
  assert.equal(Boolean(blocked.res.headers['retry-after']), true);
});

test('email verification limiter blocks repeated requests from the same IP', () => {
  const limit = createEmailCodeRateLimit({
    windowMs: 60_000,
    maxPerEmail: 100,
    maxPerIp: 2,
  })('password-reset');

  assert.equal(runMiddleware(limit, { body: { email: 'a@example.com' }, ip: '203.0.113.10' }).nextCalled, true);
  assert.equal(runMiddleware(limit, { body: { email: 'b@example.com' }, ip: '203.0.113.10' }).nextCalled, true);

  const blocked = runMiddleware(limit, { body: { email: 'c@example.com' }, ip: '203.0.113.10' });
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.res.statusCode, 429);
});
