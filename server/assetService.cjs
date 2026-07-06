const { loadEnv } = require('./env.cjs');

loadEnv();

const { createAssetServiceApp } = require('./assetServiceApp.cjs');

const runtime = createAssetServiceApp();
const { app, config } = runtime;

function printStartup() {
  console.log(`\n  AI Workbench Asset Service\n  Listening on http://${config.host}:${config.port}\n`);
  console.log('  Endpoints:');
  console.log('    GET  /api/assets');
  console.log('    POST /api/assets/upload');
  console.log('    GET  /api/assets/:assetId');
  console.log('    GET  /api/images/:imageId');
  console.log('    GET  /api/asset-collections');
  console.log('    GET  /api/asset-collection-templates');
  console.log('    GET  /api/health');
  console.log(`  SQLite DB: ${config.dbPath}`);
  console.log(`  Assets are served from ${config.outputDir}`);
  console.log('');
}

const server = app.listen(config.port, config.host, printStartup);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  ${signal} received. Stopping AI Workbench asset service...`);
  server.close(async (error) => {
    if (error) {
      console.error('Asset service HTTP server close failed:', error);
      process.exit(1);
      return;
    }
    try {
      await runtime.stop();
      console.log('  AI Workbench asset service stopped.');
      process.exit(0);
    } catch (stopError) {
      console.error('Asset service shutdown failed:', stopError);
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
