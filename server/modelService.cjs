const { loadEnv } = require('./env.cjs');

loadEnv();

const { createModelServiceApp } = require('./modelServiceApp.cjs');

const runtime = createModelServiceApp();
const { app, config } = runtime;

function printStartup() {
  console.log(`\n  AI Workbench Model Service\n  Listening on http://${config.host}:${config.port}\n`);
  console.log('  Endpoints:');
  console.log('    POST /api/models');
  console.log('    GET  /api/providers');
  console.log('    GET  /api/model-capabilities');
  console.log('    GET  /api/model-capabilities/resolve');
  console.log('    GET  /api/model-capability-presets');
  console.log('    POST /api/model-capabilities');
  console.log('    GET  /api/api-keys');
  console.log('    POST /api/api-keys');
  console.log('    POST /api/api-keys/:apiKeyId/test');
  console.log('    POST /api/api-keys/:apiKeyId/models/discover');
  console.log('    GET  /api/model-catalog');
  console.log('    GET  /api/platform-models');
  console.log('    GET  /api/admin/platform-models');
  console.log('    POST /api/chat');
  console.log('    POST /api/claude');
  console.log('    POST /api/proxy');
  console.log('    GET  /api/health');
  console.log(`  SQLite DB: ${config.dbPath}`);
  console.log(`  Text queue workers: ${config.startWorkers ? 'enabled' : 'disabled'}`);
  console.log('');
}

const server = app.listen(config.port, config.host, printStartup);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  ${signal} received. Stopping AI Workbench model service...`);
  server.close(async (error) => {
    if (error) {
      console.error('Model service HTTP server close failed:', error);
      process.exit(1);
      return;
    }
    try {
      await runtime.stop();
      console.log('  AI Workbench model service stopped.');
      process.exit(0);
    } catch (stopError) {
      console.error('Model service shutdown failed:', stopError);
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
