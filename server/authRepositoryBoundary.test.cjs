const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SESSION_COOKIE_NAME,
  hashPassword,
  hashSessionToken,
  parseCookies,
} = require('./auth.cjs');
const { registerAuthRoutes } = require('./routes/authRoutes.cjs');
const { createSessionMiddleware } = require('./services/sessionMiddlewareService.cjs');

function createFakeApp() {
  const routes = [];
  return {
    routes,
    delete(pathname, ...handlers) {
      routes.push({ method: 'DELETE', pathname, handlers });
    },
    get(pathname, ...handlers) {
      routes.push({ method: 'GET', pathname, handlers });
    },
    patch(pathname, ...handlers) {
      routes.push({ method: 'PATCH', pathname, handlers });
    },
    post(pathname, ...handlers) {
      routes.push({ method: 'POST', pathname, handlers });
    },
  };
}

function createMockRes() {
  return {
    body: null,
    headers: {},
    statusCode: 200,
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
  };
}

function runRoute(route, req, res) {
  let index = 0;
  function next() {
    const handler = route.handlers[index];
    index += 1;
    if (handler) return handler(req, res, next);
    return undefined;
  }
  return next();
}

function findRoute(app, method, pathname) {
  return app.routes.find((route) => route.method === method && route.pathname === pathname);
}

function createInMemoryAuthRepository() {
  const users = new Map();
  const sessions = new Map();
  const auditLogs = [];

  return {
    auditLogs,
    sessions,
    users,
    createAuditLog(log) {
      auditLogs.push(log);
      return log;
    },
    createSession(session) {
      const next = {
        ...session,
        id: `session-${sessions.size + 1}`,
        user: users.get(session.userId),
      };
      sessions.set(next.tokenHash, next);
      return next;
    },
    deleteExpiredSessions() {
      return 0;
    },
    deleteSessionByTokenHash(tokenHash) {
      return sessions.delete(tokenHash);
    },
    getSessionByTokenHash(tokenHash) {
      return sessions.get(tokenHash) || null;
    },
    getUserByEmail(email, includeSecret = false) {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const user = Array.from(users.values()).find((item) => item.email === normalizedEmail);
      if (!user) return null;
      return includeSecret ? user : { ...user, passwordHash: undefined };
    },
    getUserByUsername(username, includeSecret = false) {
      const normalizedUsername = String(username || '').trim().toLowerCase();
      const user = Array.from(users.values()).find((item) => item.username === normalizedUsername);
      if (!user) return null;
      return includeSecret ? user : { ...user, passwordHash: undefined };
    },
  };
}

function registerRoutes(authRepository) {
  const app = createFakeApp();
  registerAuthRoutes(app, {
    allowPublicRegistration: false,
    authRepository,
    deploymentMode: 'server',
    emailCodeTtlMinutes: 10,
    getRequestUserId: (req) => req.authUser?.id || 'local-user',
    rateLimit: () => (_req, _res, next) => next(),
    requireAdmin: () => true,
    requireInvitationCode: true,
    requireLogin: true,
    sessionCookieOptions: { sameSite: 'Lax' },
    sessionTtlDays: 14,
    windowMs: 60_000,
  });
  return app;
}

test('auth routes can login and logout through an injected repository', () => {
  const authRepository = createInMemoryAuthRepository();
  authRepository.users.set('user-1', {
    email: 'repo-login@example.com',
    id: 'user-1',
    isEnabled: true,
    name: 'Repo Login',
    passwordHash: hashPassword('correct-password'),
    role: 'user',
    username: 'repo-login@example.com',
  });
  const app = registerRoutes(authRepository);

  const loginRes = createMockRes();
  runRoute(findRoute(app, 'POST', '/api/auth/login'), {
    body: { email: 'repo-login@example.com', password: 'correct-password' },
    headers: { 'user-agent': 'Repository Browser' },
    socket: { remoteAddress: '198.51.100.11' },
  }, loginRes);

  assert.equal(loginRes.statusCode, 200);
  assert.equal(loginRes.body.user.id, 'user-1');
  assert.equal(authRepository.sessions.size, 1);

  const cookie = loginRes.headers['set-cookie'];
  const token = parseCookies(cookie)[SESSION_COOKIE_NAME];
  assert.ok(token);

  const logoutRes = createMockRes();
  runRoute(findRoute(app, 'POST', '/api/auth/logout'), {
    headers: { cookie },
  }, logoutRes);

  assert.equal(logoutRes.statusCode, 200);
  assert.equal(logoutRes.body.ok, true);
  assert.equal(authRepository.sessions.has(hashSessionToken(token)), false);
});

test('session middleware can attach a user through an injected repository', () => {
  const authRepository = createInMemoryAuthRepository();
  const session = {
    expiresAt: '2026-07-07T00:00:00.000Z',
    id: 'session-1',
    tokenHash: 'hash:token-1',
    user: {
      email: 'session-user@example.com',
      id: 'user-1',
      isEnabled: true,
      role: 'user',
      username: 'session-user@example.com',
    },
    userId: 'user-1',
  };
  authRepository.sessions.set(session.tokenHash, session);

  const middleware = createSessionMiddleware({
    authRepository,
    hashToken: (token) => `hash:${token}`,
    now: () => new Date('2026-07-06T00:00:00.000Z').getTime(),
    parseCookieHeader: () => ({ session: 'token-1' }),
    sessionCookieName: 'session',
  });
  const req = { headers: {} };
  const res = createMockRes();
  let nextCalls = 0;

  middleware(req, res, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 1);
  assert.equal(req.authUser.id, 'user-1');
  assert.equal(req.authSession.id, 'session-1');
});
