const assert = require('node:assert/strict');
const test = require('node:test');

const {
  bootstrapAdminUser,
  normalizeBootstrapAdmin,
} = require('./services/bootstrapService.cjs');

test('normalizeBootstrapAdmin returns null when bootstrap admin is not configured', () => {
  assert.equal(normalizeBootstrapAdmin({}), null);
  assert.equal(normalizeBootstrapAdmin({
    WORKBENCH_ADMIN_EMAIL: '',
    WORKBENCH_ADMIN_PASSWORD: '',
  }), null);
});

test('normalizeBootstrapAdmin requires email or username and password together', () => {
  assert.throws(
    () => normalizeBootstrapAdmin({ WORKBENCH_ADMIN_EMAIL: 'admin@example.com' }),
    /Both WORKBENCH_ADMIN_EMAIL and WORKBENCH_ADMIN_PASSWORD/
  );

  assert.throws(
    () => normalizeBootstrapAdmin({ WORKBENCH_ADMIN_PASSWORD: 'secret-password' }),
    /Both WORKBENCH_ADMIN_EMAIL and WORKBENCH_ADMIN_PASSWORD/
  );
});

test('normalizeBootstrapAdmin lowercases email and falls back to username', () => {
  assert.deepEqual(normalizeBootstrapAdmin({
    WORKBENCH_ADMIN_EMAIL: ' Admin@Example.COM ',
    WORKBENCH_ADMIN_USERNAME: ' RootAdmin ',
    WORKBENCH_ADMIN_PASSWORD: ' secret-password ',
  }), {
    email: 'admin@example.com',
    username: 'RootAdmin',
    password: 'secret-password',
  });

  assert.deepEqual(normalizeBootstrapAdmin({
    WORKBENCH_ADMIN_USERNAME: 'AdminUser',
    WORKBENCH_ADMIN_PASSWORD: 'secret-password',
  }), {
    email: 'adminuser',
    username: 'AdminUser',
    password: 'secret-password',
  });
});

test('bootstrapAdminUser creates an admin with injected dependencies', () => {
  const calls = [];
  const result = bootstrapAdminUser({
    env: {
      WORKBENCH_ADMIN_EMAIL: 'admin@example.com',
      WORKBENCH_ADMIN_USERNAME: 'admin',
      WORKBENCH_ADMIN_PASSWORD: 'secret-password',
    },
    hashPassword: (password) => `hashed:${password}`,
    upsertBootstrapUser: (user) => {
      calls.push(user);
      return { id: 'admin-user', ...user };
    },
  });

  assert.equal(result.bootstrapped, true);
  assert.equal(result.email, 'admin@example.com');
  assert.equal(result.user.id, 'admin-user');
  assert.deepEqual(calls, [{
    email: 'admin@example.com',
    username: 'admin',
    name: 'admin',
    role: 'admin',
    passwordHash: 'hashed:secret-password',
  }]);
});

test('bootstrapAdminUser skips database writes when not configured', () => {
  const result = bootstrapAdminUser({
    env: {},
    hashPassword: () => 'unused',
    upsertBootstrapUser: () => {
      throw new Error('should not be called');
    },
  });

  assert.deepEqual(result, {
    bootstrapped: false,
    reason: 'not_configured',
  });
});

test('bootstrapAdminUser validates required dependencies only when configured', () => {
  assert.throws(
    () => bootstrapAdminUser({
      env: {
        WORKBENCH_ADMIN_EMAIL: 'admin@example.com',
        WORKBENCH_ADMIN_PASSWORD: 'secret-password',
      },
      upsertBootstrapUser: () => ({}),
    }),
    /hashPassword dependency/
  );

  assert.throws(
    () => bootstrapAdminUser({
      env: {
        WORKBENCH_ADMIN_EMAIL: 'admin@example.com',
        WORKBENCH_ADMIN_PASSWORD: 'secret-password',
      },
      hashPassword: () => 'hash',
    }),
    /upsertBootstrapUser dependency/
  );
});
