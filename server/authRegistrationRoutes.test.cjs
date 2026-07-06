const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-auth-registration-routes-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');
process.env.WORKBENCH_EMAIL_DEV_CODE_VISIBLE = 'true';
process.env.WORKBENCH_VERIFICATION_CODE_PEPPER = 'test-pepper';

const {
  createEmailVerification,
  createUser,
  db,
  deleteSessionByTokenHash,
  getLatestEmailVerification,
  getSessionByTokenHash,
  getUserByEmail,
} = require('./db.cjs');
const {
  SESSION_COOKIE_NAME,
  hashPassword,
  hashSessionToken,
  parseCookies,
  verifyPassword,
} = require('./auth.cjs');
const { registerAuthRoutes } = require('./routes/authRoutes.cjs');

function createFakeApp() {
  const routes = [];
  return {
    routes,
    get(pathname, ...handlers) {
      routes.push({ method: 'GET', pathname, handlers });
    },
    post(pathname, ...handlers) {
      routes.push({ method: 'POST', pathname, handlers });
    },
    patch(pathname, ...handlers) {
      routes.push({ method: 'PATCH', pathname, handlers });
    },
    delete(pathname, ...handlers) {
      routes.push({ method: 'DELETE', pathname, handlers });
    },
  };
}

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

function registerRoutes(overrides = {}) {
  const app = createFakeApp();
  registerAuthRoutes(app, {
    allowPublicRegistration: true,
    deleteSessionByTokenHash,
    deploymentMode: 'local',
    emailCodeTtlMinutes: 10,
    getRequestUserId: (req) => req.authUser?.id || 'local-user',
    rateLimit: () => (_req, _res, next) => next(),
    requireAdmin: () => true,
    requireInvitationCode: false,
    requireLogin: false,
    sessionCookieOptions: { sameSite: 'Lax' },
    sessionTtlDays: 14,
    windowMs: 60_000,
    ...overrides,
  });
  return app;
}

function route(app, method, pathname) {
  return app.routes.find((item) => item.method === method && item.pathname === pathname);
}

function testVerificationHash(email, code) {
  return createHash('sha256')
    .update(`test-pepper:${String(email || '').trim().toLowerCase()}:${String(code).trim()}`)
    .digest('hex');
}

async function runRoute(routeItem, req, res) {
  let index = 0;
  async function next() {
    const handler = routeItem.handlers[index];
    index += 1;
    if (handler) return handler(req, res, next);
    return undefined;
  }
  return next();
}

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('public registration verifies email code, creates a user, and starts a session', async () => {
  const app = registerRoutes();
  const requestRoute = route(app, 'POST', '/api/auth/register/request');
  const verifyRoute = route(app, 'POST', '/api/auth/register/verify');

  const requestRes = createMockRes();
  await runRoute(requestRoute, {
    body: {
      email: 'NewUser@Example.com',
      name: 'New User',
      password: 'register-password-123',
    },
    headers: { 'user-agent': 'Registration Browser' },
    socket: { remoteAddress: '198.51.100.80' },
  }, requestRes);

  assert.equal(requestRes.statusCode, 200);
  assert.equal(requestRes.body.email, 'newuser@example.com');
  assert.match(requestRes.body.delivery.devCode, /^\d{6}$/);

  const verification = getLatestEmailVerification('newuser@example.com', 'register');
  assert.ok(verification);
  assert.notEqual(verification.codeHash, requestRes.body.delivery.devCode);
  assert.equal(verification.payload.email, 'newuser@example.com');
  assert.equal(verification.payload.name, 'New User');
  assert.equal(verification.payload.passwordHash.includes('register-password-123'), false);

  const verifyRes = createMockRes();
  await runRoute(verifyRoute, {
    body: {
      email: 'newuser@example.com',
      code: requestRes.body.delivery.devCode,
    },
    headers: { 'user-agent': 'Registration Browser' },
    socket: { remoteAddress: '198.51.100.80' },
  }, verifyRes);

  assert.equal(verifyRes.statusCode, 200);
  assert.equal(verifyRes.body.user.email, 'newuser@example.com');
  assert.equal(verifyRes.body.user.passwordHash, undefined);
  assert.match(verifyRes.headers['set-cookie'], new RegExp(`${SESSION_COOKIE_NAME}=`));

  const user = getUserByEmail('newuser@example.com', true);
  assert.ok(user);
  assert.equal(user.name, 'New User');
  assert.equal(verifyPassword('register-password-123', user.passwordHash), true);
  assert.equal(getLatestEmailVerification('newuser@example.com', 'register'), null);

  const token = parseCookies(verifyRes.headers['set-cookie'])[SESSION_COOKIE_NAME];
  const session = getSessionByTokenHash(hashSessionToken(token));
  assert.equal(session.userId, user.id);
  assert.equal(session.ipAddress, '198.51.100.80');
  assert.equal(session.userAgent, 'Registration Browser');
});

test('registration verify consumes the code when the email becomes registered first', async () => {
  const app = registerRoutes();
  const requestRoute = route(app, 'POST', '/api/auth/register/request');
  const verifyRoute = route(app, 'POST', '/api/auth/register/verify');

  const requestRes = createMockRes();
  await runRoute(requestRoute, {
    body: {
      email: 'RaceUser@example.com',
      name: 'Race User',
      password: 'register-password-123',
    },
    headers: { 'user-agent': 'Registration Browser' },
    socket: { remoteAddress: '198.51.100.81' },
  }, requestRes);

  const verification = getLatestEmailVerification('raceuser@example.com', 'register');
  assert.ok(verification);

  createUser({
    email: 'raceuser@example.com',
    username: 'raceuser@example.com',
    name: 'Already Registered',
    passwordHash: hashPassword('existing-password-123'),
  });

  const verifyRes = createMockRes();
  await runRoute(verifyRoute, {
    body: {
      email: 'raceuser@example.com',
      code: requestRes.body.delivery.devCode,
    },
    headers: { 'user-agent': 'Registration Browser' },
    socket: { remoteAddress: '198.51.100.81' },
  }, verifyRes);

  assert.equal(verifyRes.statusCode, 409);
  assert.match(verifyRes.body.error, /already registered/i);
  assert.equal(getLatestEmailVerification('raceuser@example.com', 'register'), null);
});

test('password reset hides unknown accounts and resets enabled accounts with an email code', async () => {
  const user = createUser({
    email: 'reset-user@example.com',
    username: 'reset-user@example.com',
    name: 'Reset User',
    passwordHash: hashPassword('old-password-123'),
  });
  const app = registerRoutes();
  const requestRoute = route(app, 'POST', '/api/auth/password-reset/request');
  const verifyRoute = route(app, 'POST', '/api/auth/password-reset/verify');

  const unknownRes = createMockRes();
  await runRoute(requestRoute, {
    body: { email: 'missing-reset@example.com' },
    headers: { 'user-agent': 'Reset Browser' },
    socket: { remoteAddress: '198.51.100.82' },
  }, unknownRes);

  assert.equal(unknownRes.statusCode, 200);
  assert.equal(unknownRes.body.ok, true);
  assert.equal(unknownRes.body.delivery, undefined);
  assert.equal(getLatestEmailVerification('missing-reset@example.com', 'password-reset'), null);

  const requestRes = createMockRes();
  await runRoute(requestRoute, {
    body: { email: 'reset-user@example.com' },
    headers: { 'user-agent': 'Reset Browser' },
    socket: { remoteAddress: '198.51.100.82' },
  }, requestRes);

  assert.equal(requestRes.statusCode, 200);
  assert.match(requestRes.body.delivery.devCode, /^\d{6}$/);

  const verification = getLatestEmailVerification('reset-user@example.com', 'password-reset');
  assert.ok(verification);
  assert.equal(verification.payload.userId, user.id);
  assert.notEqual(verification.codeHash, requestRes.body.delivery.devCode);

  const verifyRes = createMockRes();
  await runRoute(verifyRoute, {
    body: {
      email: 'reset-user@example.com',
      code: requestRes.body.delivery.devCode,
      password: 'new-password-456',
    },
    headers: { 'user-agent': 'Reset Browser' },
    socket: { remoteAddress: '198.51.100.82' },
  }, verifyRes);

  assert.equal(verifyRes.statusCode, 200);
  assert.equal(verifyRes.body.user.id, user.id);
  assert.match(verifyRes.headers['set-cookie'], new RegExp(`${SESSION_COOKIE_NAME}=`));

  const updatedUser = getUserByEmail('reset-user@example.com', true);
  assert.equal(verifyPassword('old-password-123', updatedUser.passwordHash), false);
  assert.equal(verifyPassword('new-password-456', updatedUser.passwordHash), true);
  assert.equal(getLatestEmailVerification('reset-user@example.com', 'password-reset'), null);

  const token = parseCookies(verifyRes.headers['set-cookie'])[SESSION_COOKIE_NAME];
  const session = getSessionByTokenHash(hashSessionToken(token));
  assert.equal(session.userId, user.id);
});

test('password reset rejects disabled accounts and consumes stale verification records', async () => {
  const disabledUser = createUser({
    email: 'disabled-reset@example.com',
    username: 'disabled-reset@example.com',
    name: 'Disabled Reset',
    passwordHash: hashPassword('disabled-password-123'),
    isEnabled: false,
  });
  const app = registerRoutes();
  const verifyRoute = route(app, 'POST', '/api/auth/password-reset/verify');
  const code = '135790';
  const verification = createEmailVerification({
    email: disabledUser.email,
    purpose: 'password-reset',
    codeHash: testVerificationHash(disabledUser.email, code),
    payload: { userId: disabledUser.id },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  const verifyRes = createMockRes();
  await runRoute(verifyRoute, {
    body: {
      email: disabledUser.email,
      code,
      password: 'new-password-456',
    },
    headers: { 'user-agent': 'Reset Browser' },
    socket: { remoteAddress: '198.51.100.83' },
  }, verifyRes);

  assert.equal(verifyRes.statusCode, 400);
  assert.match(verifyRes.body.error, /expired or invalid/i);
  assert.equal(getLatestEmailVerification(disabledUser.email, 'password-reset'), null);
  assert.equal(verification.consumedAt, null);
});
