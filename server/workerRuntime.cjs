const { createGenerationWorker: defaultCreateGenerationWorker } = require('./workers/generationWorker.cjs');
const { createTextWorker: defaultCreateTextWorker } = require('./workers/textWorker.cjs');

function createWorkbenchWorkerRuntime({
  assetStorage,
  createGenerationWorker = defaultCreateGenerationWorker,
  createTextWorker = defaultCreateTextWorker,
  generationQueueConcurrency = 2,
  joinUrl,
  proxyRequest,
  publicAsset,
  readSecrets,
  resolveApiCredentials,
  resolveDirectCredentials,
  taskQueuePollIntervalMs = 1000,
  textQueueConcurrency = 2,
  uploadLimits = {},
}) {
  const textWorker = createTextWorker({
    autoStart: false,
    joinUrl,
    proxyRequest,
    readSecrets,
    resolveApiCredentials,
    resolveDirectCredentials,
    taskQueuePollIntervalMs,
    textQueueConcurrency,
  });
  const generationWorker = createGenerationWorker({
    assetStorage,
    autoStart: false,
    generationQueueConcurrency,
    joinUrl,
    proxyRequest,
    publicAsset,
    readSecrets,
    resolveApiCredentials,
    taskQueuePollIntervalMs,
    uploadLimits,
  });
  let started = false;
  let stopping = null;

  function start() {
    if (started) return;
    started = true;
    stopping = null;
    textWorker.startTextQueue();
    generationWorker.startGenerationQueue();
  }

  async function stop() {
    if (!started) return stopping || Promise.resolve();
    if (stopping) return stopping;
    stopping = Promise.all([
      textWorker.stopTextQueue(),
      generationWorker.stopGenerationQueue(),
    ]).then(() => {
      started = false;
      stopping = null;
    });
    return stopping;
  }

  function getQueueHealth() {
    return [
      textWorker.getTextQueueStats(),
      generationWorker.getGenerationQueueStats(),
    ];
  }

  return {
    getQueueHealth,
    start,
    stop,
  };
}

module.exports = {
  createWorkbenchWorkerRuntime,
};
