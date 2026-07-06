const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-auth-routes-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const {
  createAuditLog,
  createSession,
  createUser,
  db,
  deleteSessionByTokenHash,
  getSessionByTokenHash,
  listAuditLogs,
  listSessionsForUser,
} = require('./db.cjs');
const {
  SESSION_COOKIE_NAME,
  hashPassword,
  hashSessionToken,
  parseCookies,
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
    allowPublicRegistration: false,
    deleteSessionByTokenHash,
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
    ...overrides,
  });
  return app;
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

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('auth login creates a session cookie and returns a public user', () => {
  const user = createUser({
    email: 'login-success@example.com',
    username: 'login-success@example.com',
    name: 'Login Success',
    passwordHash: hashPassword('correct-password'),
  });
  const app = registerRoutes();
  const loginRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/auth/login');

  const res = createMockRes();
  runRoute(loginRoute, {
    body: { email: 'login-success@example.com', password: 'correct-password' },
    headers: { 'user-agent': 'Login Browser' },
    socket: { remoteAddress: '198.51.100.50' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.id, user.id);
  assert.equal(res.body.user.email, user.email);
  assert.equal(res.body.user.passwordHash, undefined);
  assert.match(res.headers['set-cookie'], new RegExp(`${SESSION_COOKIE_NAME}=`));

  const token = parseCookies(res.headers['set-cookie'])[SESSION_COOKIE_NAME];
  const session = getSessionByTokenHash(hashSessionToken(token));
  assert.equal(session.userId, user.id);
  assert.equal(session.ipAddress, '198.51.100.50');
  assert.equal(session.userAgent, 'Login Browser');
});

test('auth login rejects missing credentials, wrong passwords, and disabled users', () => {
  createUser({
    email: 'login-wrong-password@example.com',
    username: 'login-wrong-password@example.com',
    name: 'Login Wrong Password',
    passwordHash: hashPassword('right-password'),
  });
  createUser({
    email: 'login-disabled@example.com',
    username: 'login-disabled@example.com',
    name: 'Login Disabled',
    passwordHash: hashPassword('disabled-password'),
    isEnabled: false,
  });
  const app = registerRoutes();
  const loginRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/auth/login');

  const missingRes = createMockRes();
  runRoute(loginRoute, {
    body: { email: 'login-wrong-password@example.com' },
    headers: { 'user-agent': 'Login Browser' },
    socket: { remoteAddress: '198.51.100.51' },
  }, missingRes);
  assert.equal(missingRes.statusCode, 400);

  const wrongPasswordRes = createMockRes();
  runRoute(loginRoute, {
    body: { email: 'login-wrong-password@example.com', password: 'wrong-password' },
    headers: { 'user-agent': 'Login Browser' },
    socket: { remoteAddress: '198.51.100.52' },
  }, wrongPasswordRes);
  assert.equal(wrongPasswordRes.statusCode, 401);

  const disabledRes = createMockRes();
  runRoute(loginRoute, {
    body: { email: 'login-disabled@example.com', password: 'disabled-password' },
    headers: { 'user-agent': 'Login Browser' },
    socket: { remoteAddress: '198.51.100.53' },
  }, disabledRes);
  assert.equal(disabledRes.statusCode, 401);
});

test('auth logout deletes the current session and clears the session cookie', () => {
  const user = createUser({
    email: 'logout-current@example.com',
    username: 'logout-current@example.com',
    name: 'Logout Current',
    passwordHash: hashPassword('logout-password'),
  });
  const app = registerRoutes();
  const loginRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/auth/login');
  const logoutRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/auth/logout');

  const loginRes = createMockRes();
  runRoute(loginRoute, {
    body: { email: user.email, password: 'logout-password' },
    headers: { 'user-agent': 'Logout Browser' },
    socket: { remoteAddress: '198.51.100.54' },
  }, loginRes);

  const token = parseCookies(loginRes.headers['set-cookie'])[SESSION_COOKIE_NAME];
  assert.ok(getSessionByTokenHash(hashSessionToken(token)));

  const logoutRes = createMockRes();
  runRoute(logoutRoute, {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      'user-agent': 'Logout Browser',
    },
    socket: { remoteAddress: '198.51.100.54' },
  }, logoutRes);

  assert.equal(logoutRes.statusCode, 200);
  assert.equal(logoutRes.body.ok, true);
  assert.equal(getSessionByTokenHash(hashSessionToken(token)), null);
  assert.match(logoutRes.headers['set-cookie'], /Max-Age=0/);
});

test('auth session routes list sessions and logout all devices', () => {
  const user = createUser({
    email: 'session-owner@example.com',
    username: 'session-owner@example.com',
    name: 'Session Owner',
    passwordHash: 'test',
  });
  const first = createSession({
    userId: user.id,
    tokenHash: 'hash-1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ipAddress: '203.0.113.1',
    userAgent: 'Browser One',
  });
  createSession({
    userId: user.id,
    tokenHash: 'hash-2',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ipAddress: '203.0.113.2',
    userAgent: 'Browser Two',
  });

  const app = registerRoutes();
  const listRoute = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/auth/sessions');
  const logoutRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/auth/sessions/logout-all');

  const listRes = createMockRes();
  runRoute(listRoute, {
    authUser: user,
    authSession: first,
    headers: { 'user-agent': 'Browser One' },
    socket: { remoteAddress: '203.0.113.1' },
  }, listRes);

  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.count, 2);
  assert.equal(listRes.body.sessions.some((session) => session.isCurrent), true);

  const logoutRes = createMockRes();
  runRoute(logoutRoute, {
    authUser: user,
    authSession: first,
    headers: { 'user-agent': 'Browser One' },
    socket: { remoteAddress: '203.0.113.1' },
  }, logoutRes);

  assert.equal(logoutRes.statusCode, 200);
  assert.equal(logoutRes.body.deleted, 2);
  assert.equal(listSessionsForUser(user.id).length, 0);
  assert.equal(listAuditLogs().some((log) => log.action === 'session.logout_all'), true);
  assert.match(logoutRes.headers['set-cookie'], /Max-Age=0/);
});

test('auth session route logs out a single owned session only', () => {
  const owner = createUser({
    email: 'session-single-owner@example.com',
    username: 'session-single-owner@example.com',
    name: 'Session Single Owner',
    passwordHash: 'test',
  });
  const other = createUser({
    email: 'session-single-other@example.com',
    username: 'session-single-other@example.com',
    name: 'Session Single Other',
    passwordHash: 'test',
  });
  const current = createSession({
    userId: owner.id,
    tokenHash: 'single-current-hash',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ipAddress: '203.0.113.3',
    userAgent: 'Current Browser',
  });
  const remote = createSession({
    userId: owner.id,
    tokenHash: 'single-remote-hash',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ipAddress: '203.0.113.4',
    userAgent: 'Remote Browser',
  });
  const otherSession = createSession({
    userId: other.id,
    tokenHash: 'single-other-hash',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ipAddress: '203.0.113.5',
    userAgent: 'Other Browser',
  });

  const app = registerRoutes();
  const logoutOneRoute = app.routes.find((item) => item.method === 'DELETE' && item.pathname === '/api/auth/sessions/:sessionId');

  const deniedRes = createMockRes();
  runRoute(logoutOneRoute, {
    authUser: owner,
    authSession: current,
    params: { sessionId: otherSession.id },
    headers: { 'user-agent': 'Current Browser' },
    socket: { remoteAddress: '203.0.113.3' },
  }, deniedRes);
  assert.equal(deniedRes.statusCode, 404);
  assert.equal(listSessionsForUser(other.id).length, 1);

  const remoteLogoutRes = createMockRes();
  runRoute(logoutOneRoute, {
    authUser: owner,
    authSession: current,
    params: { sessionId: remote.id },
    headers: { 'user-agent': 'Current Browser' },
    socket: { remoteAddress: '203.0.113.3' },
  }, remoteLogoutRes);
  assert.equal(remoteLogoutRes.statusCode, 200);
  assert.equal(remoteLogoutRes.body.current, false);
  assert.equal(remoteLogoutRes.headers['set-cookie'], undefined);
  const ownerSessionsAfterRemoteLogout = listSessionsForUser(owner.id);
  assert.equal(ownerSessionsAfterRemoteLogout.length, 1);
  assert.equal(ownerSessionsAfterRemoteLogout[0].id, current.id);

  const currentLogoutRes = createMockRes();
  runRoute(logoutOneRoute, {
    authUser: owner,
    authSession: current,
    params: { sessionId: current.id },
    headers: { 'user-agent': 'Current Browser' },
    socket: { remoteAddress: '203.0.113.3' },
  }, currentLogoutRes);
  assert.equal(currentLogoutRes.statusCode, 200);
  assert.equal(currentLogoutRes.body.current, true);
  assert.match(currentLogoutRes.headers['set-cookie'], /Max-Age=0/);
  assert.equal(listSessionsForUser(owner.id).length, 0);
  assert.equal(listAuditLogs().filter((log) => log.action === 'session.logout_one' && log.actorUserId === owner.id).length, 2);
});

test('admin user creation writes an audit log visible to admins', () => {
  const admin = createUser({
    email: 'audit-admin@example.com',
    username: 'audit-admin@example.com',
    name: 'Audit Admin',
    role: 'admin',
    passwordHash: 'test',
  });
  const app = registerRoutes();
  const createUserRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/admin/users');
  const auditRoute = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/admin/audit-logs');

  const createRes = createMockRes();
  runRoute(createUserRoute, {
    authUser: admin,
    body: {
      email: 'created-user@example.com',
      password: 'password123',
      name: 'Created User',
      role: 'user',
    },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.9' },
  }, createRes);

  assert.equal(createRes.statusCode, 201);
  assert.equal(listAuditLogs().some((log) =>
    log.action === 'admin.user.create' &&
    log.targetId === createRes.body.user.id &&
    log.actorUserId === admin.id
  ), true);

  const auditRes = createMockRes();
  runRoute(auditRoute, {
    authUser: admin,
    query: { limit: 20 },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.9' },
  }, auditRes);

  assert.equal(auditRes.statusCode, 200);
  assert.equal(auditRes.body.logs.some((log) => log.action === 'admin.user.create'), true);
});

test('admin audit logs route supports pagination and server-side filters', () => {
  const admin = createUser({
    email: 'audit-filter-admin@example.com',
    username: 'audit-filter-admin@example.com',
    name: 'Audit Filter Admin',
    role: 'admin',
    passwordHash: 'test',
  });
  const otherAdmin = createUser({
    email: 'audit-filter-other@example.com',
    username: 'audit-filter-other@example.com',
    name: 'Audit Filter Other',
    role: 'admin',
    passwordHash: 'test',
  });
  createAuditLog({
    actorUserId: admin.id,
    action: 'audit.pagination.alpha',
    targetType: 'user',
    targetId: 'audit-target-a',
    ipAddress: '198.51.100.10',
    userAgent: 'Audit Test Browser',
    metadata: { providerId: 'openai-compatible' },
    createdAt: '2026-01-01T00:00:01.000Z',
  });
  createAuditLog({
    actorUserId: admin.id,
    action: 'audit.pagination.alpha',
    targetType: 'user',
    targetId: 'audit-target-b',
    ipAddress: '198.51.100.11',
    userAgent: 'Audit Test Browser',
    metadata: { providerId: 'seedance', model: 'doubao-seedance-test' },
    createdAt: '2026-01-01T00:00:02.000Z',
  });
  createAuditLog({
    actorUserId: otherAdmin.id,
    action: 'audit.pagination.beta',
    targetType: 'api_key',
    targetId: 'audit-target-c',
    ipAddress: '198.51.100.12',
    userAgent: 'Audit Test Browser',
    metadata: { providerId: 'bailian' },
    createdAt: '2026-01-01T00:00:03.000Z',
  });

  const app = registerRoutes();
  const auditRoute = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/admin/audit-logs');

  const firstPageRes = createMockRes();
  runRoute(auditRoute, {
    authUser: admin,
    query: {
      action: 'audit.pagination.alpha',
      targetType: 'user',
      actorUserId: admin.id,
      limit: 1,
      offset: 0,
    },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.11' },
  }, firstPageRes);

  assert.equal(firstPageRes.statusCode, 200);
  assert.equal(firstPageRes.body.count, 1);
  assert.equal(firstPageRes.body.total, 2);
  assert.equal(firstPageRes.body.logs[0].targetId, 'audit-target-b');

  const secondPageRes = createMockRes();
  runRoute(auditRoute, {
    authUser: admin,
    query: {
      action: 'audit.pagination.alpha',
      targetType: 'user',
      actorUserId: admin.id,
      limit: 1,
      offset: 1,
    },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.11' },
  }, secondPageRes);

  assert.equal(secondPageRes.body.logs[0].targetId, 'audit-target-a');

  const searchRes = createMockRes();
  runRoute(auditRoute, {
    authUser: admin,
    query: {
      search: 'seedance',
      limit: 10,
    },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.11' },
  }, searchRes);

  assert.equal(searchRes.statusCode, 200);
  assert.equal(searchRes.body.total, 1);
  assert.equal(searchRes.body.logs[0].targetId, 'audit-target-b');
});

test('admin user and invitation list routes support pagination metadata', () => {
  const admin = createUser({
    email: 'pagination-admin@example.com',
    username: 'pagination-admin@example.com',
    name: 'Pagination Admin',
    role: 'admin',
    passwordHash: 'test',
  });
  createUser({
    email: 'pagination-user-a@example.com',
    username: 'pagination-user-a@example.com',
    name: 'Pagination User A',
    role: 'user',
    passwordHash: 'test',
  });
  createUser({
    email: 'pagination-user-b@example.com',
    username: 'pagination-user-b@example.com',
    name: 'Pagination User B',
    role: 'user',
    passwordHash: 'test',
  });

  const app = registerRoutes();
  const userListRoute = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/admin/users');
  const createInvitationRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/admin/invitations');
  const invitationListRoute = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/admin/invitations');

  for (const label of ['Invite A', 'Invite B']) {
    const res = createMockRes();
    runRoute(createInvitationRoute, {
      authUser: admin,
      body: { label, role: 'user', maxUses: 1, expiresInDays: 7 },
      headers: { 'user-agent': 'Admin Browser' },
      socket: { remoteAddress: '203.0.113.12' },
    }, res);
    assert.equal(res.statusCode, 201);
  }

  const firstUsersRes = createMockRes();
  runRoute(userListRoute, {
    authUser: admin,
    query: { limit: 1, offset: 0 },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.12' },
  }, firstUsersRes);

  const secondUsersRes = createMockRes();
  runRoute(userListRoute, {
    authUser: admin,
    query: { limit: 1, offset: 1 },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.12' },
  }, secondUsersRes);

  assert.equal(firstUsersRes.statusCode, 200);
  assert.equal(firstUsersRes.body.count, 1);
  assert.equal(firstUsersRes.body.limit, 1);
  assert.equal(firstUsersRes.body.offset, 0);
  assert.ok(firstUsersRes.body.total >= 2);
  assert.notEqual(firstUsersRes.body.users[0].id, secondUsersRes.body.users[0].id);

  const firstInvitationsRes = createMockRes();
  runRoute(invitationListRoute, {
    authUser: admin,
    query: { limit: 1, offset: 0 },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.12' },
  }, firstInvitationsRes);

  const secondInvitationsRes = createMockRes();
  runRoute(invitationListRoute, {
    authUser: admin,
    query: { limit: 1, offset: 1 },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.12' },
  }, secondInvitationsRes);

  assert.equal(firstInvitationsRes.statusCode, 200);
  assert.equal(firstInvitationsRes.body.count, 1);
  assert.equal(firstInvitationsRes.body.limit, 1);
  assert.equal(firstInvitationsRes.body.offset, 0);
  assert.ok(firstInvitationsRes.body.total >= 2);
  assert.notEqual(firstInvitationsRes.body.invitations[0].id, secondInvitationsRes.body.invitations[0].id);
});

test('admin user and invitation list routes support server-side filters', () => {
  const admin = createUser({
    email: 'filter-admin@example.com',
    username: 'filter-admin@example.com',
    name: 'Filter Admin',
    role: 'admin',
    passwordHash: 'test',
  });
  const disabledAdmin = createUser({
    email: 'filter-disabled-admin@example.com',
    username: 'filter-disabled-admin@example.com',
    name: 'Unique Disabled Admin',
    role: 'admin',
    passwordHash: 'test',
    isEnabled: false,
  });
  createUser({
    email: 'filter-enabled-user@example.com',
    username: 'filter-enabled-user@example.com',
    name: 'Unique Enabled User',
    role: 'user',
    passwordHash: 'test',
  });

  const app = registerRoutes();
  const userListRoute = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/admin/users');
  const createInvitationRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/admin/invitations');
  const disableInvitationRoute = app.routes.find((item) => item.method === 'DELETE' && item.pathname === '/api/admin/invitations/:invitationId');
  const invitationListRoute = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/admin/invitations');

  const userFilterRes = createMockRes();
  runRoute(userListRoute, {
    authUser: admin,
    query: {
      search: 'unique disabled',
      role: 'admin',
      status: 'disabled',
      limit: 10,
      offset: 0,
    },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.13' },
  }, userFilterRes);

  assert.equal(userFilterRes.statusCode, 200);
  assert.equal(userFilterRes.body.total, 1);
  assert.equal(userFilterRes.body.users[0].id, disabledAdmin.id);

  const activeInviteRes = createMockRes();
  runRoute(createInvitationRoute, {
    authUser: admin,
    body: { label: 'Unique Active Invite', role: 'user', maxUses: 1, expiresInDays: 7 },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.13' },
  }, activeInviteRes);
  assert.equal(activeInviteRes.statusCode, 201);

  const inactiveInviteRes = createMockRes();
  runRoute(createInvitationRoute, {
    authUser: admin,
    body: { label: 'Unique Disabled Invite', role: 'admin', maxUses: 1, expiresInDays: 7 },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.13' },
  }, inactiveInviteRes);
  assert.equal(inactiveInviteRes.statusCode, 201);

  const disableRes = createMockRes();
  runRoute(disableInvitationRoute, {
    authUser: admin,
    params: { invitationId: inactiveInviteRes.body.invitation.id },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.13' },
  }, disableRes);
  assert.equal(disableRes.statusCode, 200);

  const invitationFilterRes = createMockRes();
  runRoute(invitationListRoute, {
    authUser: admin,
    query: {
      search: 'unique disabled invite',
      role: 'admin',
      status: 'inactive',
      limit: 10,
      offset: 0,
    },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.13' },
  }, invitationFilterRes);

  assert.equal(invitationFilterRes.statusCode, 200);
  assert.equal(invitationFilterRes.body.total, 1);
  assert.equal(invitationFilterRes.body.invitations[0].id, inactiveInviteRes.body.invitation.id);
});

test('admin invitation create and disable write audit logs without raw codes', () => {
  const admin = createUser({
    email: 'audit-invitation-admin@example.com',
    username: 'audit-invitation-admin@example.com',
    name: 'Audit Invitation Admin',
    role: 'admin',
    passwordHash: 'test',
  });
  const app = registerRoutes();
  const createInvitationRoute = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/admin/invitations');
  const disableInvitationRoute = app.routes.find((item) => item.method === 'DELETE' && item.pathname === '/api/admin/invitations/:invitationId');

  const createRes = createMockRes();
  runRoute(createInvitationRoute, {
    authUser: admin,
    body: {
      label: 'Audit Invite',
      role: 'admin',
      maxUses: 3,
      expiresInDays: 14,
    },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.20' },
  }, createRes);

  assert.equal(createRes.statusCode, 201);
  assert.equal(typeof createRes.body.invitation.code, 'string');

  const disableRes = createMockRes();
  runRoute(disableInvitationRoute, {
    authUser: admin,
    params: { invitationId: createRes.body.invitation.id },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.20' },
  }, disableRes);

  assert.equal(disableRes.statusCode, 200);

  const logs = listAuditLogs();
  const createLog = logs.find((log) => log.action === 'admin.invitation.create' && log.targetId === createRes.body.invitation.id);
  const disableLog = logs.find((log) => log.action === 'admin.invitation.disable' && log.targetId === createRes.body.invitation.id);
  const serializedMetadata = JSON.stringify([createLog?.metadata, disableLog?.metadata]);

  assert.equal(createLog.actorUserId, admin.id);
  assert.equal(createLog.targetType, 'invitation');
  assert.equal(createLog.metadata.role, 'admin');
  assert.equal(createLog.metadata.maxUses, 3);
  assert.equal(createLog.metadata.label, 'Audit Invite');
  assert.equal(disableLog.actorUserId, admin.id);
  assert.equal(disableLog.metadata.label, 'Audit Invite');
  assert.equal(serializedMetadata.includes(createRes.body.invitation.code), false);
});

test('admin password and status updates write audit logs', () => {
  const admin = createUser({
    email: 'audit-admin-actions@example.com',
    username: 'audit-admin-actions@example.com',
    name: 'Audit Admin Actions',
    role: 'admin',
    passwordHash: 'test',
  });
  const target = createUser({
    email: 'audit-target@example.com',
    username: 'audit-target@example.com',
    name: 'Audit Target',
    role: 'user',
    passwordHash: 'test',
  });
  const app = registerRoutes();
  const passwordRoute = app.routes.find((item) => item.method === 'PATCH' && item.pathname === '/api/admin/users/:userId/password');
  const statusRoute = app.routes.find((item) => item.method === 'PATCH' && item.pathname === '/api/admin/users/:userId/status');

  const passwordRes = createMockRes();
  runRoute(passwordRoute, {
    authUser: admin,
    params: { userId: target.id },
    body: { password: 'new-password-123' },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.10' },
  }, passwordRes);

  assert.equal(passwordRes.statusCode, 200);

  const statusRes = createMockRes();
  runRoute(statusRoute, {
    authUser: admin,
    params: { userId: target.id },
    body: { isEnabled: false },
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '203.0.113.10' },
  }, statusRes);

  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.body.user.isEnabled, false);

  const logs = listAuditLogs();
  const passwordLog = logs.find((log) => log.action === 'admin.user.password_update' && log.targetId === target.id);
  const statusLog = logs.find((log) => log.action === 'admin.user.status_update' && log.targetId === target.id);

  assert.equal(passwordLog.actorUserId, admin.id);
  assert.equal(passwordLog.metadata.email, target.email);
  assert.equal(JSON.stringify(passwordLog.metadata).includes('new-password-123'), false);
  assert.equal(statusLog.actorUserId, admin.id);
  assert.equal(statusLog.metadata.email, target.email);
  assert.equal(statusLog.metadata.isEnabled, false);
});
