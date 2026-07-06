const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SESSION_COOKIE_NAME,
  hashPassword,
  hashSessionToken,
  parseCookies,
} = require('./auth.cjs');
const { createAuthSessionService } = require('./services/authSessionService.cjs');

function createAuthRepository() {
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
        createdAt: '2026-07-06T00:00:00.000Z',
        id: `session-${sessions.size + 1}`,
        updatedAt: '2026-07-06T00:00:00.000Z',
        user: users.get(session.userId),
      };
      sessions.set(next.tokenHash, next);
      return next;
    },
    deleteSessionByTokenHash(tokenHash) {
      return sessions.delete(tokenHash);
    },
    deleteSessionForUser(sessionId, userId) {
      for (const [tokenHash, session] of sessions.entries()) {
        if (session.id === sessionId && session.userId === userId) {
          sessions.delete(tokenHash);
          return true;
        }
      }
      return false;
    },
    deleteSessionsForUser(userId) {
      let deleted = 0;
      for (const [tokenHash, session] of sessions.entries()) {
        if (session.userId === userId) {
          sessions.delete(tokenHash);
          deleted += 1;
        }
      }
      return deleted;
    },
    getUserByEmail(email, includeSecret = false) {
      const user = Array.from(users.values()).find((item) => item.email === String(email || '').trim().toLowerCase());
      return includeSecret ? user || null : user ? { ...user, passwordHash: undefined } : null;
    },
    getUserByUsername(username, includeSecret = false) {
      const user = Array.from(users.values()).find((item) => item.username === String(username || '').trim().toLowerCase());
      return includeSecret ? user || null : user ? { ...user, passwordHash: undefined } : null;
    },
    listSessionsForUser(userId) {
      return Array.from(sessions.values()).filter((session) => session.userId === userId);
    },
  };
}

function createRequest(overrides = {}) {
  return {
    authSession: overrides.authSession,
    authUser: overrides.authUser,
    headers: overrides.headers || { 'user-agent': 'Service Browser' },
    secure: Boolean(overrides.secure),
    socket: overrides.socket || { remoteAddress: '198.51.100.30' },
  };
}

test('auth session service signs in with a saved user and creates a cookie session', () => {
  const authRepository = createAuthRepository();
  authRepository.users.set('user-1', {
    email: 'session-login@example.com',
    id: 'user-1',
    isEnabled: true,
    name: 'Session Login',
    passwordHash: hashPassword('correct-password'),
    role: 'user',
    username: 'session-login@example.com',
  });
  const service = createAuthSessionService({
    authRepository,
    sessionCookieOptions: { sameSite: 'Lax' },
    sessionTtlDays: 14,
  });

  const result = service.signInWithPassword(
    createRequest(),
    'session-login@example.com',
    'correct-password'
  );

  assert.ok(result.cookie.includes(`${SESSION_COOKIE_NAME}=`));
  assert.equal(result.user.id, 'user-1');
  assert.equal(Object.hasOwn(result.user, 'passwordHash'), false);
  assert.equal(authRepository.sessions.size, 1);
});

test('auth session service rejects wrong passwords without creating sessions', () => {
  const authRepository = createAuthRepository();
  authRepository.users.set('user-1', {
    email: 'wrong-password@example.com',
    id: 'user-1',
    isEnabled: true,
    passwordHash: hashPassword('correct-password'),
    role: 'user',
    username: 'wrong-password@example.com',
  });
  const service = createAuthSessionService({ authRepository });

  assert.equal(service.signInWithPassword(createRequest(), 'wrong-password@example.com', 'bad-password'), null);
  assert.equal(authRepository.sessions.size, 0);
});

test('auth session service logs out by cookie and clears the stored session', () => {
  const authRepository = createAuthRepository();
  authRepository.users.set('user-1', {
    email: 'logout@example.com',
    id: 'user-1',
    isEnabled: true,
    passwordHash: hashPassword('correct-password'),
    role: 'user',
    username: 'logout@example.com',
  });
  const service = createAuthSessionService({ authRepository });
  const signIn = service.signInWithPassword(createRequest(), 'logout@example.com', 'correct-password');
  const token = parseCookies(signIn.cookie)[SESSION_COOKIE_NAME];

  const result = service.logoutByRequest(createRequest({ headers: { cookie: signIn.cookie } }));

  assert.equal(result.ok, true);
  assert.ok(result.cookie.includes('Max-Age=0'));
  assert.equal(authRepository.sessions.has(hashSessionToken(token)), false);
});

test('auth session service lists and logs out sessions with audit metadata', () => {
  const authRepository = createAuthRepository();
  authRepository.users.set('user-1', {
    email: 'sessions@example.com',
    id: 'user-1',
    isEnabled: true,
    passwordHash: hashPassword('correct-password'),
    role: 'user',
    username: 'sessions@example.com',
  });
  const service = createAuthSessionService({ authRepository });
  const first = service.signInWithPassword(createRequest(), 'sessions@example.com', 'correct-password');
  const currentSession = Array.from(authRepository.sessions.values())[0];
  service.signInWithPassword(createRequest(), 'sessions@example.com', 'correct-password');

  const req = createRequest({
    authSession: currentSession,
    authUser: { id: 'user-1' },
    headers: { cookie: first.cookie, 'user-agent': 'Session Browser' },
  });
  const list = service.listSessionsForRequest(req);
  assert.equal(list.count, 2);
  assert.equal(list.sessions.some((session) => session.isCurrent), true);

  const logoutOne = service.logoutSession(req, currentSession.id);
  assert.equal(logoutOne.current, true);
  assert.equal(logoutOne.deleted, 1);
  assert.ok(logoutOne.cookie.includes('Max-Age=0'));
  assert.deepEqual(authRepository.auditLogs[0].metadata, { current: true });

  const logoutAll = service.logoutAllSessions(req);
  assert.equal(logoutAll.deleted, 1);
  assert.equal(logoutAll.ok, true);
  assert.deepEqual(authRepository.auditLogs[1].metadata, { deleted: 1 });
});
