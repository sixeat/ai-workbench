const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ecosystem = require('../ecosystem.config.cjs');

function appByName(name) {
  return ecosystem.apps.find((app) => app.name === name);
}

test('pm2 ecosystem starts gateway api and five internal service processes', () => {
  assert.deepEqual(ecosystem.apps.map((app) => app.name), [
    'ai-workbench-api',
    'ai-workbench-auth-service',
    'ai-workbench-worker-service',
    'ai-workbench-asset-service',
    'ai-workbench-model-service',
    'ai-workbench-workflow-service',
  ]);

  assert.equal(appByName('ai-workbench-api').script, 'server/api.cjs');
  assert.equal(appByName('ai-workbench-auth-service').script, 'server/authService.cjs');
  assert.equal(appByName('ai-workbench-worker-service').script, 'server/workerService.cjs');
  assert.equal(appByName('ai-workbench-asset-service').script, 'server/assetService.cjs');
  assert.equal(appByName('ai-workbench-model-service').script, 'server/modelService.cjs');
  assert.equal(appByName('ai-workbench-workflow-service').script, 'server/workflowService.cjs');
  assert.equal(ecosystem.apps.every((app) => app.cwd === path.join(__dirname, '..')), true);
  assert.equal(ecosystem.apps.every((app) => app.exec_mode === 'fork'), true);
});

test('pm2 gateway process forwards to internal service origins only', () => {
  const apiEnv = appByName('ai-workbench-api').env;

  assert.equal(apiEnv.WORKBENCH_DEPLOYMENT_MODE, 'server');
  assert.equal(apiEnv.WORKBENCH_SERVE_STATIC, 'false');
  assert.equal(apiEnv.WORKBENCH_START_WORKERS, 'false');
  assert.equal(apiEnv.PROXY_HOST, '0.0.0.0');
  assert.equal(apiEnv.PROXY_PORT, '3000');
  assert.equal(apiEnv.WORKBENCH_GATEWAY_AUTH_URL, 'http://127.0.0.1:3004');
  assert.equal(apiEnv.WORKBENCH_GATEWAY_WORKER_URL, 'http://127.0.0.1:3001');
  assert.equal(apiEnv.WORKBENCH_GATEWAY_ASSET_URL, 'http://127.0.0.1:3002');
  assert.equal(apiEnv.WORKBENCH_GATEWAY_MODEL_URL, 'http://127.0.0.1:3003');
  assert.equal(apiEnv.WORKBENCH_GATEWAY_WORKFLOW_URL, 'http://127.0.0.1:3005');
});

test('pm2 internal services bind to localhost and do not embed secrets', () => {
  const internalServices = ecosystem.apps.filter((app) => app.name !== 'ai-workbench-api');
  const serialized = JSON.stringify(ecosystem);

  assert.equal(appByName('ai-workbench-auth-service').env.WORKBENCH_AUTH_SERVICE_HOST, '127.0.0.1');
  assert.equal(appByName('ai-workbench-worker-service').env.WORKBENCH_WORKER_SERVICE_HOST, '127.0.0.1');
  assert.equal(appByName('ai-workbench-asset-service').env.WORKBENCH_ASSET_SERVICE_HOST, '127.0.0.1');
  assert.equal(appByName('ai-workbench-model-service').env.WORKBENCH_MODEL_SERVICE_HOST, '127.0.0.1');
  assert.equal(appByName('ai-workbench-workflow-service').env.WORKBENCH_WORKFLOW_SERVICE_HOST, '127.0.0.1');
  assert.equal(appByName('ai-workbench-worker-service').env.WORKBENCH_WORKER_SERVICE_START_QUEUE, 'true');
  assert.equal(appByName('ai-workbench-model-service').env.WORKBENCH_MODEL_SERVICE_START_QUEUE, 'false');
  assert.equal(internalServices.every((app) => app.env.WORKBENCH_DEPLOYMENT_MODE === 'server'), true);

  assert.equal(serialized.includes('WORKBENCH_KEY_SECRET'), false);
  assert.equal(serialized.includes('WORKBENCH_SERVER_API_KEY'), false);
  assert.equal(serialized.includes('WORKBENCH_SMTP_PASS'), false);
  assert.equal(serialized.includes('WORKBENCH_INTERNAL_SERVICE_TOKEN'), false);
});
