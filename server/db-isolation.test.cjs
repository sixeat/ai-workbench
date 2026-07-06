const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-db-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const {
  createAssetCollection,
  createTask,
  createUser,
  db,
  getAssetCollectionForUser,
  getAssetForUser,
  getTaskForUser,
  getWorkflowForUser,
  insertAsset,
  listAssetCollections,
  listAssets,
  listTasks,
  listWorkflows,
  upsertWorkflow,
} = require('./db.cjs');

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('tasks, assets, and collections are isolated by user id', () => {
  const alice = createUser({
    email: 'alice@example.com',
    username: 'alice@example.com',
    name: 'Alice',
    passwordHash: 'test',
  });
  const bob = createUser({
    email: 'bob@example.com',
    username: 'bob@example.com',
    name: 'Bob',
    passwordHash: 'test',
  });

  const aliceTask = createTask({
    userId: alice.id,
    nodeType: 'image-generation',
    status: 'succeeded',
    input: { prompt: 'alice' },
  });

  const aliceAsset = insertAsset({
    id: 'asset-alice',
    userId: alice.id,
    type: 'image',
    url: '/api/assets/asset-alice',
    fileName: 'alice.png',
  });

  const aliceCollection = createAssetCollection({
    userId: alice.id,
    name: 'Alice collection',
  });

  const aliceWorkflow = upsertWorkflow({
    userId: alice.id,
    name: 'Alice workflow',
    nodes: [{ id: 'node-1' }],
    edges: [],
  });

  assert.equal(getTaskForUser(aliceTask.id, alice.id)?.id, aliceTask.id);
  assert.equal(getTaskForUser(aliceTask.id, bob.id), null);
  assert.deepEqual(listTasks(bob.id), []);

  assert.equal(getAssetForUser(aliceAsset.id, alice.id)?.id, aliceAsset.id);
  assert.equal(getAssetForUser(aliceAsset.id, bob.id), null);
  assert.deepEqual(listAssets(bob.id), []);

  assert.equal(getAssetCollectionForUser(aliceCollection.id, alice.id)?.id, aliceCollection.id);
  assert.equal(getAssetCollectionForUser(aliceCollection.id, bob.id), null);
  assert.deepEqual(listAssetCollections(bob.id), []);

  assert.equal(getWorkflowForUser(aliceWorkflow.id, alice.id)?.id, aliceWorkflow.id);
  assert.equal(getWorkflowForUser(aliceWorkflow.id, bob.id), null);
  assert.deepEqual(listWorkflows(bob.id), []);
});
