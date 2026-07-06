const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createClearCookie,
  createSessionMiddleware,
  isSecureRequest,
  isSessionUsable,
} = require('./services/sessionMiddlewareService.cjs');

function createMockReq(options = {}) {
  return {
    headers: options.headers || {},
    secure: Boolean(options.secure),
  };
}

function createMockRes() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
  };
}

function runMiddleware(middleware, req = createMockReq()) {
  const res = createMockRes();
  let nextCalls = 0;
  middleware(req, res, () => {
    nextCalls += 1;
  });
  return { nextCalls, req, res };
}

function futureSession(overrides = {}) {
  return {
    id: 'session-1',
    tokenHash: 'hashed-session-token',
    expiresAt: new Date('2026-07-06T00:00:00.000Z').toISOString(),
    user: {
      id: 'user-1',
      email: 'user@example.com',
      isEnabled: true,
    },
    ...overrides,
  };
}

test('isSecureRequest detects direct HTTPS and forwarded HTTPS', () => {
  assert.equal(isSecureRequest(createMockReq({ secure: true })), true);
  assert.equal(isSecureRequest(createMockReq({ headers: { 'x-forwarded-proto': 'https' } })), true);
  assert.equal(isSecureRequest(createMockReq({ headers: { 'x-forwarded-proto': 'http' } })), false);
});

test('isSessionUsable rejects missing, expired, and disabled sessions', () => {
  const now = new Date('2026-07-05T00:00:00.000Z').getTime();

  assert.equal(isSessionUsable(futureSession(), now), true);
  assert.equal(isSessionUsable(null, now), false);
  assert.equal(isSessionUsable(futureSession({ expiresAt: '2026-07-04T00:00:00.000Z' }), now), false);
  assert.equal(isSessionUsable(futureSession({ user: { id: 'user-1', isEnabled: false } }), now), false);
});

test('createClearCookie infers secure from request unless explicitly configured', () => {
  const clearCookie = (options) => `secure=${Boolean(options.secure)}`;

  assert.equal(createClearCookie(createMockReq({ headers: { 'x-forwarded-proto': 'https' } }), {}, clearCookie), 'secure=true');
  assert.equal(createClearCookie(createMockReq({ headers: { 'x-forwarded-proto': 'https' } }), { secure: false }, clearCookie), 'secure=false');
});

test('session middleware cleans expired sessions and skips lookup without a cookie', () => {
  const calls = [];
  const middleware = createSessionMiddleware({
    deleteExpired: () => calls.push('deleteExpired'),
    getSession: () => calls.push('getSession'),
    parseCookieHeader: () => ({}),
  });

  const result = runMiddleware(middleware);

  assert.equal(result.nextCalls, 1);
  assert.deepEqual(calls, ['deleteExpired']);
  assert.equal(result.req.authUser, undefined);
  assert.equal(result.res.headers['set-cookie'], undefined);
});

test('session middleware attaches valid session user to the request', () => {
  const session = futureSession();
  const middleware = createSessionMiddleware({
    deleteExpired: () => {},
    getSession: (tokenHash) => {
      assert.equal(tokenHash, 'hash:token-1');
      return session;
    },
    hashToken: (token) => `hash:${token}`,
    now: () => new Date('2026-07-05T00:00:00.000Z').getTime(),
    parseCookieHeader: () => ({ session: 'token-1' }),
    sessionCookieName: 'session',
  });

  const result = runMiddleware(middleware);

  assert.equal(result.nextCalls, 1);
  assert.equal(result.req.authUser.id, 'user-1');
  assert.equal(result.req.authSession.id, 'session-1');
  assert.equal(result.res.headers['set-cookie'], undefined);
});

test('session middleware clears cookies for missing sessions', () => {
  const middleware = createSessionMiddleware({
    clearCookie: (options) => `cleared; secure=${Boolean(options.secure)}`,
    deleteExpired: () => {},
    deleteSession: () => {
      throw new Error('missing session should not be deleted');
    },
    getSession: () => null,
    hashToken: (token) => `hash:${token}`,
    parseCookieHeader: () => ({ session: 'missing-token' }),
    sessionCookieName: 'session',
  });

  const result = runMiddleware(middleware, createMockReq({ headers: { 'x-forwarded-proto': 'https' } }));

  assert.equal(result.nextCalls, 1);
  assert.equal(result.req.authUser, undefined);
  assert.equal(result.res.headers['set-cookie'], 'cleared; secure=true');
});

test('session middleware deletes unusable stored sessions and clears cookie', () => {
  const deleted = [];
  const middleware = createSessionMiddleware({
    clearCookie: (options) => `cleared; domain=${options.domain || ''}`,
    deleteExpired: () => {},
    deleteSession: (tokenHash) => deleted.push(tokenHash),
    getSession: () => futureSession({ user: { id: 'user-1', isEnabled: false } }),
    now: () => new Date('2026-07-05T00:00:00.000Z').getTime(),
    parseCookieHeader: () => ({ session: 'disabled-token' }),
    sessionCookieName: 'session',
    sessionCookieOptions: { domain: '.example.com' },
  });

  const result = runMiddleware(middleware);

  assert.equal(result.nextCalls, 1);
  assert.deepEqual(deleted, ['hashed-session-token']);
  assert.equal(result.req.authUser, undefined);
  assert.equal(result.res.headers['set-cookie'], 'cleared; domain=.example.com');
});
