const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-internal-service-guard-test-'));
process.env.WORKBENCH_DATA_DIR = path.join(tempDir, 'data');
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'data', 'test.sqlite');
process.env.IMAGE_OUTPUT_DIR = path.join(tempDir, 'outputs');
process.env.WORKBENCH_DEPLOYMENT_MODE = 'server';
process.env.WORKBENCH_KEY_SECRET = 'internal-service-guard-secret-0123456789';
process.env.WORKBENCH_REQUIRE_LOGIN = 'true';

const { db } = require('./db.cjs');
const {
  assertInternalServiceHostAllowed,
  isLoopbackHostname,
  isWildcardBindHost,
} = require('./services/internalServiceExposureGuard.cjs');
const { createAssetServiceApp } = require('./assetServiceApp.cjs');
const { createAuthServiceApp } = require('./authServiceApp.cjs');
const { createModelServiceApp } = require('./modelServiceApp.cjs');
const { createWorkerServiceApp } = require('./workerServiceApp.cjs');
const { createWorkflowServiceApp } = require('./workflowServiceApp.cjs');

function serverEnv(extra = {}) {
  return {
    WORKBENCH_DEPLOYMENT_MODE: 'server',
    WORKBENCH_KEY_SECRET: 'internal-service-guard-secret-0123456789',
    WORKBENCH_REQUIRE_LOGIN: 'true',
    ...extra,
  };
}

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('internal service host guard recognizes loopback and wildcard hosts', () => {
  assert.equal(isLoopbackHostname('127.0.0.1'), true);
  assert.equal(isLoopbackHostname('127.10.20.30'), true);
  assert.equal(isLoopbackHostname('localhost'), true);
  assert.equal(isLoopbackHostname('[::1]'), true);
  assert.equal(isLoopbackHostname('10.0.0.5'), false);

  assert.equal(isWildcardBindHost('0.0.0.0'), true);
  assert.equal(isWildcardBindHost('[::]'), true);
  assert.equal(isWildcardBindHost('127.0.0.1'), false);
});

test('internal service host guard blocks public binding in server mode', () => {
  assert.throws(
    () => assertInternalServiceHostAllowed({
      envName: 'WORKBENCH_WORKER_SERVICE_HOST',
      host: '0.0.0.0',
      mode: 'server',
    }),
    /must not bind/
  );
});

test('internal service host guard requires a token for non-loopback hosts', () => {
  assert.throws(
    () => assertInternalServiceHostAllowed({
      env: {},
      envName: 'WORKBENCH_MODEL_SERVICE_HOST',
      host: '10.0.0.20',
      mode: 'server',
    }),
    /WORKBENCH_INTERNAL_SERVICE_TOKEN/
  );

  assert.doesNotThrow(() => assertInternalServiceHostAllowed({
    env: { WORKBENCH_INTERNAL_SERVICE_TOKEN: 'internal-token' },
    envName: 'WORKBENCH_MODEL_SERVICE_HOST',
    host: '10.0.0.20',
    mode: 'server',
  }));
});

test('internal service apps reject wildcard hosts at runtime', () => {
  const cases = [
    ['WORKBENCH_AUTH_SERVICE_HOST', (env) => createAuthServiceApp({ env })],
    ['WORKBENCH_WORKER_SERVICE_HOST', (env) => createWorkerServiceApp({ env, startWorkers: false })],
    ['WORKBENCH_ASSET_SERVICE_HOST', (env) => createAssetServiceApp({ env })],
    ['WORKBENCH_MODEL_SERVICE_HOST', (env) => createModelServiceApp({ env, startWorkers: false })],
    ['WORKBENCH_WORKFLOW_SERVICE_HOST', (env) => createWorkflowServiceApp({ env })],
  ];

  for (const [envName, createApp] of cases) {
    assert.throws(
      () => createApp(serverEnv({ [envName]: '0.0.0.0' })),
      new RegExp(`${envName} must not bind`)
    );
  }
});
