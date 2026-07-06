const path = require('path');
const { loadEnv } = require('./env.cjs');

loadEnv();

const { DB_PATH } = require('./dataPaths.cjs');
const { LocalAssetStorage, OUTPUT_DIR } = require('./assetStorage.cjs');
const { createPublicAsset } = require('./services/assetService.cjs');
const {
  deploymentMode,
  resolveKeyEncryptionSecret,
} = require('./security.cjs');
const { createCredentialService } = require('./services/credentialService.cjs');
const { joinUrl, proxyRequest } = require('./services/proxyService.cjs');
const { resolveRequestConfig } = require('./services/requestConfigService.cjs');
const { createSecretService } = require('./services/secretService.cjs');
const { createWorkbenchWorkerRuntime } = require('./workerRuntime.cjs');

const DEPLOYMENT_MODE = deploymentMode();
const SECRETS_PATH = path.join(__dirname, 'secrets.json');
const KEY_ENCRYPTION_SECRET = resolveKeyEncryptionSecret(process.env, DEPLOYMENT_MODE);
const REQUEST_CONFIG = resolveRequestConfig(process.env, DEPLOYMENT_MODE);
const assetStorage = new LocalAssetStorage(OUTPUT_DIR);
const publicAsset = createPublicAsset(DEPLOYMENT_MODE, false);
const credentialService = createCredentialService({
  keyEncryptionSecret: KEY_ENCRYPTION_SECRET,
  deploymentMode: DEPLOYMENT_MODE,
  allowDirectCredentials: REQUEST_CONFIG.allowDirectCredentials,
});
const secretService = createSecretService({
  deploymentMode: DEPLOYMENT_MODE,
  env: process.env,
  secretsPath: SECRETS_PATH,
});
const runtime = createWorkbenchWorkerRuntime({
  assetStorage,
  generationQueueConcurrency: REQUEST_CONFIG.taskQueues.generationConcurrency,
  joinUrl,
  proxyRequest,
  publicAsset,
  readSecrets: secretService.readSecrets,
  resolveApiCredentials: credentialService.resolveApiCredentials,
  resolveDirectCredentials: credentialService.resolveDirectCredentials,
  taskQueuePollIntervalMs: REQUEST_CONFIG.taskQueues.pollIntervalMs,
  textQueueConcurrency: REQUEST_CONFIG.taskQueues.textConcurrency,
  uploadLimits: {
    maxUserAssetBytes: REQUEST_CONFIG.uploadLimits.maxUserAssetBytes,
  },
});

runtime.start();

console.log('\n  AI Workbench Worker');
console.log('  HTTP server: disabled');
console.log(`  SQLite DB: ${DB_PATH}`);
console.log(`  Assets will be saved to ${OUTPUT_DIR}`);
console.log(`  Text queue concurrency: ${REQUEST_CONFIG.taskQueues.textConcurrency}`);
console.log(`  Generation queue concurrency: ${REQUEST_CONFIG.taskQueues.generationConcurrency}`);
console.log(`  Queue poll interval: ${REQUEST_CONFIG.taskQueues.pollIntervalMs}ms`);
console.log('');

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  ${signal} received. Stopping AI Workbench worker...`);
  await runtime.stop();
  console.log('  AI Workbench worker stopped.');
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    console.error('Worker shutdown failed:', error);
    process.exit(1);
  });
});
process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    console.error('Worker shutdown failed:', error);
    process.exit(1);
  });
});
