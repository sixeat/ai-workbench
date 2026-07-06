const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-credential-service-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const { db } = require('./db.cjs');
const { createCredentialService } = require('./services/credentialService.cjs');

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('direct credentials do not send server key to a user supplied baseUrl', () => {
  const service = createCredentialService({
    keyEncryptionSecret: '0123456789abcdef0123456789abcdef',
  });

  assert.deepEqual(
    service.resolveDirectCredentials(
      { baseUrl: 'https://attacker.example' },
      { baseUrl: 'https://trusted.example', apiKey: 'server-secret' }
    ),
    { baseUrl: 'https://attacker.example', apiKey: '' }
  );

  assert.deepEqual(
    service.resolveDirectCredentials(
      {},
      { baseUrl: 'https://trusted.example', apiKey: 'server-secret' }
    ),
    { baseUrl: 'https://trusted.example', apiKey: 'server-secret' }
  );
});

test('server mode rejects direct request credentials by default', async () => {
  const service = createCredentialService({
    keyEncryptionSecret: '0123456789abcdef0123456789abcdef',
    deploymentMode: 'server',
  });

  await assert.rejects(
    () => service.resolveApiCredentials({
      userId: 'local-user',
      body: { baseUrl: 'https://example.test', apiKey: 'direct-key' },
      secrets: {},
    }),
    /Direct API credentials are disabled/
  );

  assert.throws(
    () => service.resolveDirectCredentials(
      { baseUrl: 'https://example.test' },
      { baseUrl: 'https://trusted.example', apiKey: 'server-secret' }
    ),
    /Direct API credentials are disabled/
  );
});

test('server mode can explicitly allow direct request credentials for migration', async () => {
  const service = createCredentialService({
    keyEncryptionSecret: '0123456789abcdef0123456789abcdef',
    deploymentMode: 'server',
    allowDirectCredentials: true,
  });

  assert.deepEqual(
    await service.resolveApiCredentials({
      userId: 'local-user',
      body: { baseUrl: 'https://example.test', apiKey: 'direct-key' },
      secrets: {},
    }),
    {
      baseUrl: 'https://example.test',
      apiKey: 'direct-key',
      providerId: 'openai-compatible',
      keyScope: 'user',
    }
  );
});
