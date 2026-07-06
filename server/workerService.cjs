const { loadEnv } = require('./env.cjs');

loadEnv();

const { createWorkerServiceApp } = require('./workerServiceApp.cjs');

const runtime = createWorkerServiceApp();
const { app, config } = runtime;

function printStartup() {
  console.log(`\n  AI Workbench Worker Service\n  Listening on http://${config.host}:${config.port}\n`);
  console.log('  Endpoints:');
  console.log('    POST /api/images   - image task enqueue');
  console.log('    POST /api/videos   - video task enqueue');
  console.log('    GET  /api/videos/:taskId - upstream video task lookup');
  console.log('    GET  /api/tasks    - task history');
  console.log('    GET  /api/health   - worker-service health');
  console.log(`  SQLite DB: ${config.dbPath}`);
  console.log(`  Assets will be saved to ${config.outputDir}`);
  console.log(`  Queue workers: ${config.startWorkers ? 'enabled' : 'disabled'}`);
  console.log('');
}

const server = app.listen(config.port, config.host, printStartup);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  ${signal} received. Stopping AI Workbench worker service...`);
  server.close(async (error) => {
    if (error) {
      console.error('Worker service HTTP server close failed:', error);
      process.exit(1);
      return;
    }
    try {
      await runtime.stop();
      console.log('  AI Workbench worker service stopped.');
      process.exit(0);
    } catch (stopError) {
      console.error('Worker service shutdown failed:', stopError);
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
