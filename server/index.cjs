const { loadEnv } = require('./env.cjs');

loadEnv();

const { createWorkbenchApp } = require('./app.cjs');

const runtime = createWorkbenchApp();
const {
  app,
  config,
} = runtime;

function printStartup() {
  console.log(`\n  AI Workbench Proxy Server\n  Listening on http://localhost:${config.port}\n`);
  console.log(`  Host: ${config.host}`);
  console.log('  Endpoints:');
  console.log('    POST /api/models   - models');
  console.log('    POST /api/chat     - chat');
  console.log('    POST /api/images   - image generation');
  console.log('    POST /api/claude   - Claude messages');
  console.log('    POST /api/proxy    - generic proxy');
  console.log('    GET  /api/tasks    - task history');
  console.log('    GET  /api/workflows - workflows');
  console.log('    GET  /api/providers - provider templates');
  console.log('    GET  /api/platform-models - published platform models');
  console.log('    GET  /api/assets   - assets');
  console.log('    GET  /api/assets/:id');
  console.log('    GET  /api/model-capabilities');
  console.log('    GET  /api/model-capabilities/resolve');
  console.log('    GET  /api/model-capability-presets');
  console.log('    GET  /api/health');
  console.log('    GET  /api/admin/health');
  console.log(`  SQLite DB: ${config.dbPath}`);
  console.log(`  Assets will be saved to ${config.outputDir}`);
  console.log(`  Static frontend: ${config.serveStatic ? config.distDir : 'disabled'}`);
  console.log(`  Sync generation endpoints: ${config.enableSyncGeneration ? 'enabled' : 'disabled'}`);
  console.log(`  Local workers: ${config.startWorkers ? 'enabled' : 'disabled'}`);
  console.log('');
}

const server = app.listen(config.port, config.host, printStartup);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  ${signal} received. Stopping AI Workbench server...`);
  server.close(async (error) => {
    if (error) {
      console.error('HTTP server close failed:', error);
      process.exit(1);
      return;
    }
    try {
      await runtime.stop();
      console.log('  AI Workbench server stopped.');
      process.exit(0);
    } catch (stopError) {
      console.error('Worker queue shutdown failed:', stopError);
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
