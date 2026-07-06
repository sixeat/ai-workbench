const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SERVER_ROOT = __dirname;
const PROJECT_ROOT = path.join(__dirname, '..');

function readServerFile(fileName) {
  return fs.readFileSync(path.join(SERVER_ROOT, fileName), 'utf8');
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
}

test('api process entry disables in-process workers', () => {
  const apiEntry = readServerFile('api.cjs');

  assert.match(apiEntry, /WORKBENCH_START_WORKERS\s*=\s*['"]false['"]/);
  assert.doesNotMatch(apiEntry, /workerRuntime|workers\//);
});

test('worker process entry does not depend on HTTP app or routes', () => {
  const workerEntry = readServerFile('worker.cjs');

  assert.doesNotMatch(workerEntry, /require\(['"]express['"]\)/);
  assert.doesNotMatch(workerEntry, /require\(['"]\.\/(?:app|index|db)\.cjs['"]\)/);
  assert.doesNotMatch(workerEntry, /require\(['"]\.\/routes\//);
});

test('worker runtime composes workers without depending on HTTP routes', () => {
  const workerRuntime = readServerFile('workerRuntime.cjs');

  assert.doesNotMatch(workerRuntime, /require\(['"]\.\/routes\//);
  assert.doesNotMatch(workerRuntime, /require\(['"]\.\/(?:app|index)\.cjs['"]\)/);
  assert.doesNotMatch(workerRuntime, /require\(['"]express['"]\)/);
});

test('package scripts expose separate api worker and combined start commands', () => {
  const scripts = readPackageJson().scripts;

  assert.equal(scripts['start:api'], 'node server/api.cjs');
  assert.equal(scripts['start:asset-service'], 'node server/assetService.cjs');
  assert.equal(scripts['start:auth-service'], 'node server/authService.cjs');
  assert.equal(scripts['start:model-service'], 'node server/modelService.cjs');
  assert.equal(scripts['start:worker'], 'node server/worker.cjs');
  assert.equal(scripts['start:worker-service'], 'node server/workerService.cjs');
  assert.equal(scripts['start:workflow-service'], 'node server/workflowService.cjs');
  assert.equal(scripts['start:all'], 'node server/index.cjs');
});
