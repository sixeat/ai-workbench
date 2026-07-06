const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createRequestUserIdResolver,
  createRequireAdmin,
} = require('./services/requestIdentityService.cjs');

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
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

test('createRequireAdmin accepts an authenticated admin user', () => {
  const requireAdmin = createRequireAdmin({
    isAdminAuthorized: () => {
      throw new Error('admin token should not be checked');
    },
  });
  const res = createMockRes();

  assert.equal(requireAdmin({ authUser: { id: 'admin-1', role: 'admin' } }, res), true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
});

test('createRequireAdmin accepts an admin token fallback', () => {
  const requireAdmin = createRequireAdmin({
    adminToken: 'admin-token',
    deploymentMode: 'server',
    isAdminAuthorized: (_req, token, mode) => token === 'admin-token' && mode === 'server',
  });
  const res = createMockRes();

  assert.equal(requireAdmin({ headers: {} }, res), true);
  assert.equal(res.statusCode, 200);
});

test('createRequireAdmin rejects non-admin requests with a safe error', () => {
  const requireAdmin = createRequireAdmin({
    isAdminAuthorized: () => false,
  });
  const res = createMockRes();

  assert.equal(requireAdmin({ authUser: { id: 'user-1', role: 'user' } }, res), false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Admin token is required.' });
});

test('createRequestUserIdResolver prefers authenticated user ids', () => {
  const getRequestUserId = createRequestUserIdResolver({
    defaultUserId: 'local-user',
    resolveUserId: () => {
      throw new Error('fallback resolver should not be called');
    },
  });

  assert.equal(getRequestUserId({ authUser: { id: 'signed-in-user' } }), 'signed-in-user');
});

test('createRequestUserIdResolver delegates anonymous requests to the configured resolver', () => {
  const calls = [];
  const getRequestUserId = createRequestUserIdResolver({
    defaultUserId: 'local-user',
    resolveUserId: (req, defaultUserId, options) => {
      calls.push({ req, defaultUserId, options });
      return options.trustClientUserId ? req.headers['x-user-id'] : defaultUserId;
    },
    trustClientUserId: false,
  });

  assert.equal(getRequestUserId({ headers: { 'x-user-id': 'attacker' } }), 'local-user');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].defaultUserId, 'local-user');
  assert.deepEqual(calls[0].options, { trustClientUserId: false });
});

test('createRequestUserIdResolver can explicitly trust client user ids for local migration paths', () => {
  const getRequestUserId = createRequestUserIdResolver({
    defaultUserId: 'local-user',
    resolveUserId: (req, defaultUserId, options) => (
      options.trustClientUserId ? req.headers['x-user-id'] : defaultUserId
    ),
    trustClientUserId: true,
  });

  assert.equal(getRequestUserId({ headers: { 'x-user-id': 'trusted-local-user' } }), 'trusted-local-user');
});
