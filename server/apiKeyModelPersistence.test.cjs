const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-api-key-model-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const {
  createUser,
  db,
  getApiKey,
  getApiKeyModelByKeyAndName,
  listApiKeyModels,
  upsertApiKey,
  upsertApiKeyModel,
} = require('./db.cjs');

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('model instance enablement is authoritative and mirrors legacy models_json', () => {
  const user = createUser({
    email: 'model-persistence@example.com',
    name: 'Model persistence',
    passwordHash: 'test',
    username: 'model-persistence',
  });
  const key = upsertApiKey({
    ownerUserId: user.id,
    keyScope: 'user',
    providerId: 'openai-compatible',
    name: 'Personal key',
    models: ['gpt-4.1'],
    isEnabled: true,
  });
  const initial = getApiKeyModelByKeyAndName(key.id, 'gpt-4.1');
  assert.ok(initial);
  assert.equal(initial.isEnabled, true);

  upsertApiKeyModel({
    ...initial,
    adapterId: 'openai-chat',
    capabilities: { chat: true },
    capabilitySource: 'matched-rules',
    discoveryStatus: 'active',
    isEnabled: false,
  });

  assert.equal(getApiKeyModelByKeyAndName(key.id, 'gpt-4.1').isEnabled, false);
  assert.deepEqual(getApiKey(key.id).models, []);

  upsertApiKeyModel({
    ...initial,
    adapterId: 'openai-chat',
    capabilities: { chat: true },
    capabilitySource: 'matched-rules',
    discoveryStatus: 'active',
    isEnabled: true,
  });

  assert.equal(listApiKeyModels(key.id).length, 1);
  assert.deepEqual(getApiKey(key.id).models, ['gpt-4.1']);
});

test('missing models leave the catalog but keep their stable database identity', () => {
  const user = createUser({
    email: 'model-missing@example.com',
    name: 'Missing model',
    passwordHash: 'test',
    username: 'model-missing',
  });
  const key = upsertApiKey({
    ownerUserId: user.id,
    keyScope: 'user',
    providerId: 'openai-compatible',
    name: 'Missing key',
    models: [],
    isEnabled: true,
  });
  const model = upsertApiKeyModel({
    apiKeyId: key.id,
    upstreamModel: 'temporary-model',
    modelProviderId: 'openai-compatible',
    adapterId: 'openai-chat',
    displayName: 'Temporary model',
    capabilities: { chat: true },
    capabilitySource: 'manual',
    discoveryStatus: 'missing',
    isEnabled: true,
  });

  assert.equal(listApiKeyModels(key.id).length, 0);
  assert.equal(getApiKeyModelByKeyAndName(key.id, 'temporary-model').id, model.id);
  assert.deepEqual(getApiKey(key.id).models, []);
});
