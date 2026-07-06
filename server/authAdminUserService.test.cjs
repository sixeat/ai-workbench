const assert = require('node:assert/strict');
const test = require('node:test');

const { verifyPassword } = require('./auth.cjs');
const { createAuthAdminUserService } = require('./services/authAdminUserService.cjs');

function createAuthRepository() {
  const auditLogs = [];
  const users = new Map();

  function matchUser(user, query = {}) {
    if (query.role && user.role !== query.role) return false;
    if (query.status === 'enabled' && !user.isEnabled) return false;
    if (query.status === 'disabled' && user.isEnabled) return false;
    if (query.search) {
      const needle = String(query.search).toLowerCase();
      return [user.email, user.name, user.username].some((value) => String(value || '').toLowerCase().includes(needle));
    }
    return true;
  }

  return {
    auditLogs,
    users,
    countAuditLogs(query = {}) {
      return this.listAuditLogs({ ...query, limit: 10_000, offset: 0 }).length;
    },
    countUsers(query = {}) {
      return Array.from(users.values()).filter((user) => matchUser(user, query)).length;
    },
    createAuditLog(log) {
      const next = {
        ...log,
        id: `audit-${auditLogs.length + 1}`,
      };
      auditLogs.push(next);
      return next;
    },
    createUser(input) {
      const user = {
        ...input,
        createdAt: '2026-07-06T00:00:00.000Z',
        id: `user-${users.size + 1}`,
        isEnabled: input.isEnabled ?? true,
        updatedAt: '2026-07-06T00:00:00.000Z',
      };
      users.set(user.id, user);
      return user;
    },
    getUser(id) {
      return users.get(id) || null;
    },
    getUserByEmail(email) {
      const normalized = String(email || '').trim().toLowerCase();
      return Array.from(users.values()).find((user) => user.email === normalized) || null;
    },
    listAuditLogs(query = {}) {
      const limit = Number(query.limit || 100);
      const offset = Number(query.offset || 0);
      return auditLogs
        .filter((log) => !query.action || log.action === query.action)
        .slice(offset, offset + limit);
    },
    listUsers(query = {}) {
      const limit = Number(query.limit || 100);
      const offset = Number(query.offset || 0);
      return Array.from(users.values())
        .filter((user) => matchUser(user, query))
        .slice(offset, offset + limit);
    },
    updateUserPassword(id, passwordHash) {
      const user = users.get(id);
      if (!user) return null;
      user.passwordHash = passwordHash;
      user.updatedAt = '2026-07-06T00:01:00.000Z';
      return user;
    },
    updateUserStatus(id, isEnabled) {
      const user = users.get(id);
      if (!user) return null;
      user.isEnabled = Boolean(isEnabled);
      user.updatedAt = '2026-07-06T00:02:00.000Z';
      return user;
    },
  };
}

function createRequest(authUser = { id: 'admin-1' }) {
  return {
    authUser,
    headers: { 'user-agent': 'Admin Browser' },
    socket: { remoteAddress: '198.51.100.70' },
  };
}

test('auth admin user service creates users and writes audit metadata', () => {
  const authRepository = createAuthRepository();
  const service = createAuthAdminUserService({ authRepository });

  const user = service.createUser(createRequest(), {
    email: ' CreatedUser@Example.com ',
    name: 'Created User',
    password: 'created-password-123',
    role: 'admin',
  });

  assert.equal(user.email, 'createduser@example.com');
  assert.equal(user.role, 'admin');
  assert.equal(user.isEnabled, true);
  assert.equal(Object.hasOwn(user, 'passwordHash'), false);

  const stored = authRepository.getUser(user.id);
  assert.equal(verifyPassword('created-password-123', stored.passwordHash), true);
  assert.deepEqual(authRepository.auditLogs[0].metadata, {
    email: 'createduser@example.com',
    role: 'admin',
  });
});

test('auth admin user service updates password and status with audit logs', () => {
  const authRepository = createAuthRepository();
  const service = createAuthAdminUserService({ authRepository });
  const user = authRepository.createUser({
    email: 'target@example.com',
    name: 'Target User',
    passwordHash: 'old-hash',
    role: 'user',
    username: 'target@example.com',
  });

  service.updateUserPassword(createRequest(), user.id, 'new-password-456');
  assert.equal(verifyPassword('new-password-456', authRepository.getUser(user.id).passwordHash), true);

  const disabled = service.updateUserStatus(createRequest(), user.id, false);
  assert.equal(disabled.isEnabled, false);
  assert.equal(authRepository.auditLogs[0].action, 'admin.user.password_update');
  assert.equal(authRepository.auditLogs[1].action, 'admin.user.status_update');
  assert.deepEqual(authRepository.auditLogs[1].metadata, {
    email: 'target@example.com',
    isEnabled: false,
    previousIsEnabled: true,
  });
});

test('auth admin user service blocks self-disable and supports list pagination', () => {
  const authRepository = createAuthRepository();
  const admin = authRepository.createUser({
    email: 'admin@example.com',
    name: 'Admin',
    passwordHash: 'hash',
    role: 'admin',
    username: 'admin@example.com',
  });
  authRepository.createUser({
    email: 'viewer@example.com',
    name: 'Viewer',
    passwordHash: 'hash',
    role: 'user',
    username: 'viewer@example.com',
  });
  const service = createAuthAdminUserService({ authRepository });

  assert.throws(
    () => service.updateUserStatus(createRequest({ id: admin.id }), admin.id, false),
    /disable your own account/
  );

  const users = service.listUsers({ limit: 1, offset: 0, role: 'user' });
  assert.equal(users.count, 1);
  assert.equal(users.total, 1);
  assert.equal(users.users[0].email, 'viewer@example.com');

  const logs = service.listAuditLogs({ limit: 10, action: 'admin.user.status_update' });
  assert.equal(logs.count, 0);
  assert.equal(logs.total, 0);
});
