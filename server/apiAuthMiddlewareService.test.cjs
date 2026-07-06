const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createApiAuthMiddleware,
  shouldSkipApiAuth,
} = require('./services/apiAuthMiddlewareService.cjs');

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

function runMiddleware(middleware, req) {
  const res = createMockRes();
  let nextCalls = 0;
  middleware(req, res, () => {
    nextCalls += 1;
  });
  return { nextCalls, res };
}

test('shouldSkipApiAuth only skips health and auth routes', () => {
  assert.equal(shouldSkipApiAuth('/health'), true);
  assert.equal(shouldSkipApiAuth('/auth/me'), true);
  assert.equal(shouldSkipApiAuth('/auth/register/request'), true);
  assert.equal(shouldSkipApiAuth('/tasks'), false);
  assert.equal(shouldSkipApiAuth('/admin/health'), false);
});

test('api auth middleware skips public auth entry points', () => {
  const middleware = createApiAuthMiddleware({
    isAuthorized: () => {
      throw new Error('token should not be checked');
    },
    requireLogin: true,
  });

  assert.equal(runMiddleware(middleware, { path: '/health' }).nextCalls, 1);
  assert.equal(runMiddleware(middleware, { path: '/auth/login' }).nextCalls, 1);
});

test('api auth middleware accepts authenticated users when login is required', () => {
  const middleware = createApiAuthMiddleware({
    isAuthorized: () => false,
    requireLogin: true,
  });

  const result = runMiddleware(middleware, {
    authUser: { id: 'user-1' },
    path: '/tasks',
  });

  assert.equal(result.nextCalls, 1);
  assert.equal(result.res.statusCode, 200);
});

test('api auth middleware rejects anonymous users when login is required', () => {
  const middleware = createApiAuthMiddleware({
    isAuthorized: () => true,
    requireLogin: true,
  });

  const result = runMiddleware(middleware, { path: '/tasks' });

  assert.equal(result.nextCalls, 0);
  assert.equal(result.res.statusCode, 401);
  assert.deepEqual(result.res.body, { error: 'Login is required.' });
});

test('api auth middleware accepts access token only when login is disabled', () => {
  const middleware = createApiAuthMiddleware({
    accessToken: 'shared-secret',
    isAuthorized: (_req, accessToken) => accessToken === 'shared-secret',
    requireLogin: false,
  });

  const result = runMiddleware(middleware, { path: '/tasks' });

  assert.equal(result.nextCalls, 1);
  assert.equal(result.res.statusCode, 200);
});

test('api auth middleware rejects missing access token when login is disabled', () => {
  const middleware = createApiAuthMiddleware({
    accessToken: 'shared-secret',
    isAuthorized: () => false,
    requireLogin: false,
  });

  const result = runMiddleware(middleware, { path: '/tasks' });

  assert.equal(result.nextCalls, 0);
  assert.equal(result.res.statusCode, 401);
  assert.deepEqual(result.res.body, { error: 'Access token is required.' });
});
