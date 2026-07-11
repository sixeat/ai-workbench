const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-credit-service-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const {
  countTasks,
  createTask,
  createUser,
  db,
  getTask,
  listAuditLogs,
  upsertApiKey,
  upsertApiKeyModel,
  upsertPlatformModel,
  upsertPlatformModelRoute,
} = require('./db.cjs');
const { creditRepository } = require('./repositories/creditRepository.cjs');
const { createCreditService } = require('./services/creditService.cjs');

const creditService = createCreditService();

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function testUser(email) {
  return createUser({
    email,
    name: email,
    passwordHash: 'test',
    username: email,
  });
}

function createBillableTask(user, nodeType, body = {}) {
  return creditService.createBillableTask({
    body,
    createTask: (taskBody) => createTask({
      creditCost: taskBody.creditCost,
      creditKeyScope: taskBody.creditKeyScope,
      creditStatus: taskBody.creditStatus,
      input: taskBody,
      model: taskBody.model,
      nodeType,
      providerId: taskBody.providerId || 'openai-compatible',
      status: 'queued',
      userId: user.id,
    }),
    nodeType,
    userId: user.id,
  }).task;
}

test('server-key text task debits credits before enqueue', () => {
  const user = testUser('credit-text@example.com');
  creditRepository.adjustAccount({ amount: 5, userId: user.id });

  const task = createBillableTask(user, 'text', {
    messages: [{ role: 'user', content: 'hello' }],
    model: 'gpt-test',
  });

  assert.equal(task.creditCost, 1);
  assert.equal(task.creditStatus, 'charged');
  assert.equal(task.creditKeyScope, 'server_key');
  assert.equal(creditRepository.getAccount(user.id).balance, 4);
});

test('insufficient credits rejects task creation with 402 and rolls back task insert', () => {
  const user = testUser('credit-insufficient@example.com');

  assert.throws(
    () => createBillableTask(user, 'image', {
      model: 'image-test',
      prompt: 'hello',
    }),
    (error) => error.status === 402 && error.code === 'INSUFFICIENT_CREDITS'
  );

  assert.equal(countTasks(user.id), 0);
  assert.equal(creditRepository.getAccount(user.id).balance, 0);
});

test('image task charges by image count', () => {
  const user = testUser('credit-image@example.com');
  creditRepository.adjustAccount({ amount: 50, userId: user.id });

  const task = createBillableTask(user, 'image', {
    model: 'image-test',
    n: 3,
    prompt: 'three images',
  });

  assert.equal(task.creditCost, 30);
  assert.equal(creditRepository.getAccount(user.id).balance, 20);
});

test('video task charges by duration seconds', () => {
  const user = testUser('credit-video@example.com');
  creditRepository.adjustAccount({ amount: 300, userId: user.id });

  const task = createBillableTask(user, 'video', {
    duration: 11,
    model: 'video-test',
    prompt: 'eleven seconds',
  });

  assert.equal(task.creditCost, 220);
  assert.equal(creditRepository.getAccount(user.id).balance, 80);
});

test('user-owned saved key does not consume credits in the first version', () => {
  const user = testUser('credit-user-key@example.com');
  const key = upsertApiKey({
    baseUrl: 'https://api.example.com',
    encryptedKey: 'fake-encrypted-key',
    keyScope: 'user',
    name: 'User key',
    ownerUserId: user.id,
    providerId: 'openai-compatible',
  });

  const task = createBillableTask(user, 'image', {
    apiKeyId: key.id,
    model: 'image-test',
    prompt: 'free with user key',
  });

  assert.equal(task.creditCost, 0);
  assert.equal(task.creditStatus, 'free');
  assert.equal(task.creditKeyScope, 'user_key');
  assert.equal(creditRepository.getAccount(user.id).balance, 0);
});

test('user-owned model instance remains free and resolves by stable model ID', () => {
  const user = testUser('credit-user-model@example.com');
  const key = upsertApiKey({
    baseUrl: 'https://api.example.com',
    encryptedKey: 'fake-encrypted-key',
    keyScope: 'user',
    name: 'User key model',
    ownerUserId: user.id,
    providerId: 'openai-compatible',
  });
  const model = upsertApiKeyModel({
    apiKeyId: key.id,
    upstreamModel: 'gpt-image-2',
    modelProviderId: 'openai-compatible',
    adapterId: 'openai-image',
    displayName: 'GPT Image 2',
    capabilities: { imageGeneration: true, image: { maxImages: 1 } },
    capabilitySource: 'matched-rules',
    discoveryStatus: 'active',
    isEnabled: true,
  });

  const task = createBillableTask(user, 'image', {
    apiKeyModelId: model.id,
    model: 'client-model-is-ignored',
    prompt: 'free with a stable model ID',
  });

  assert.equal(task.creditCost, 0);
  assert.equal(task.creditStatus, 'free');
  assert.equal(task.creditKeyScope, 'user_key');
});

test('platform capability validation happens before credit debit', () => {
  const user = testUser('credit-platform-contract@example.com');
  creditRepository.adjustAccount({ amount: 100, userId: user.id });
  const key = upsertApiKey({
    baseUrl: 'https://api.example.com',
    encryptedKey: 'fake-encrypted-key',
    keyScope: 'server',
    name: 'Server image key',
    ownerUserId: user.id,
    providerId: 'openai-compatible',
  });
  const apiKeyModel = upsertApiKeyModel({
    apiKeyId: key.id,
    upstreamModel: 'gpt-image-2',
    modelProviderId: 'openai-compatible',
    adapterId: 'openai-image',
    displayName: 'GPT Image 2',
    capabilities: { imageGeneration: true, image: { maxImages: 4 } },
    capabilitySource: 'matched-rules',
    discoveryStatus: 'active',
    isEnabled: true,
  });
  const platformModel = upsertPlatformModel({
    displayName: 'Platform Image',
    capability: 'imageGeneration',
    model: 'platform-image',
    capabilities: { imageGeneration: true, image: { maxImages: 1 } },
    isEnabled: true,
  });
  upsertPlatformModelRoute({
    platformModelId: platformModel.id,
    apiKeyId: key.id,
    apiKeyModelId: apiKeyModel.id,
    providerId: 'openai-compatible',
    upstreamModel: 'gpt-image-2',
    isEnabled: true,
  });

  assert.throws(
    () => createBillableTask(user, 'image', {
      platformModelId: platformModel.id,
      prompt: 'too many images',
      n: 2,
    }),
    /at most 1 image/
  );
  assert.equal(creditRepository.getAccount(user.id).balance, 100);
});

test('refund restores charged credits only once', () => {
  const user = testUser('credit-refund@example.com');
  creditRepository.adjustAccount({ amount: 20, userId: user.id });
  const task = createBillableTask(user, 'image', {
    model: 'image-test',
    prompt: 'refund me',
  });

  assert.equal(creditRepository.getAccount(user.id).balance, 10);
  const first = creditService.refundTask(task, { reason: 'failed' });
  const second = creditService.refundTask(task, { reason: 'failed' });

  assert.equal(first.refunded, true);
  assert.equal(second.refunded, false);
  assert.equal(creditRepository.getAccount(user.id).balance, 20);
  assert.equal(getTask(task.id).creditStatus, 'refunded');
  assert.equal(creditRepository.listTransactions({ taskId: task.id, type: 'refund' }).length, 1);
});

test('admin adjustment updates balance and writes audit log', () => {
  const admin = testUser('credit-admin@example.com');
  const user = testUser('credit-adjust@example.com');

  const result = creditService.adjustCredits({
    authUser: admin,
    headers: { 'user-agent': 'node-test' },
    ip: '127.0.0.1',
  }, {
    amount: 99,
    reason: 'welcome credits',
    userId: user.id,
  });

  assert.equal(result.account.balance, 99);
  assert.equal(result.transaction.type, 'admin_adjustment');
  assert.equal(result.transaction.actorUserId, admin.id);
  const auditLog = listAuditLogs({ action: 'credits.adjust', targetId: user.id })[0];
  assert.equal(auditLog.action, 'credits.adjust');
  assert.equal(auditLog.targetId, user.id);
});

test('second charge cannot overdraw the account under repeated requests', () => {
  const user = testUser('credit-overdraft@example.com');
  creditRepository.adjustAccount({ amount: 10, userId: user.id });

  const first = createBillableTask(user, 'image', {
    model: 'image-test',
    prompt: 'first',
  });
  assert.equal(first.creditCost, 10);

  assert.throws(
    () => createBillableTask(user, 'image', {
      model: 'image-test',
      prompt: 'second',
    }),
    (error) => error.status === 402
  );

  assert.equal(creditRepository.getAccount(user.id).balance, 0);
  assert.equal(countTasks(user.id), 1);
});
