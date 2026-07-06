const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-app-factory-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');
process.env.WORKBENCH_DEPLOYMENT_MODE = 'local';
process.env.WORKBENCH_REQUIRE_LOGIN = 'false';

const {
  createTask,
  createUser,
  db,
  getTask,
} = require('./db.cjs');
const { createWorkbenchApp } = require('./app.cjs');

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('app factory builds the HTTP app without listening or consuming queued tasks', async () => {
  const user = createUser({
    email: 'app-factory@example.com',
    username: 'app-factory@example.com',
    name: 'App Factory',
    passwordHash: 'test',
  });
  const queuedTask = createTask({
    userId: user.id,
    nodeType: 'text',
    providerId: 'openai-compatible',
    model: 'gpt-test',
    status: 'queued',
    input: {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'do not run from app factory' }],
      requestKind: 'chat',
    },
  });
  const runtime = createWorkbenchApp({
    env: {
      ...process.env,
      WORKBENCH_DEPLOYMENT_MODE: 'local',
      WORKBENCH_REQUIRE_LOGIN: 'false',
      WORKBENCH_START_WORKERS: 'false',
    },
  });

  try {
    assert.equal(typeof runtime.app.handle, 'function');
    assert.equal(runtime.config.host, '127.0.0.1');
    assert.equal(runtime.config.startWorkers, false);
    assert.equal(runtime.handlers.modelProxyHandlers.getTextQueueStats().scheduled, false);
    assert.equal(runtime.handlers.generationHandlers.getGenerationQueueStats().scheduled, false);

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(getTask(queuedTask.id).status, 'queued');
  } finally {
    await runtime.stop();
  }
});

test('app factory can force local worker startup from options', async () => {
  const runtime = createWorkbenchApp({
    env: {
      ...process.env,
      WORKBENCH_DEPLOYMENT_MODE: 'local',
      WORKBENCH_REQUIRE_LOGIN: 'false',
      WORKBENCH_START_WORKERS: 'false',
    },
    startWorkers: true,
  });

  try {
    assert.equal(runtime.config.startWorkers, true);
    assert.equal(runtime.handlers.modelProxyHandlers.getTextQueueStats().stopped, false);
    assert.equal(runtime.handlers.generationHandlers.getGenerationQueueStats().stopped, false);
  } finally {
    await runtime.stop();
  }
});
