const { loadEnv } = require('./env.cjs');

loadEnv();

const { createWorkflowServiceApp } = require('./workflowServiceApp.cjs');

const runtime = createWorkflowServiceApp();
const { app, config } = runtime;

function printStartup() {
  console.log(`\n  AI Workbench Workflow Service\n  Listening on http://${config.host}:${config.port}\n`);
  console.log('  Endpoints:');
  console.log('    GET    /api/workflows');
  console.log('    POST   /api/workflows');
  console.log('    GET    /api/workflows/:workflowId');
  console.log('    PUT    /api/workflows/:workflowId');
  console.log('    DELETE /api/workflows/:workflowId');
  console.log('    POST   /api/workflows/:workflowId/duplicate');
  console.log('    GET    /api/workflows/:workflowId/versions');
  console.log('    GET    /api/workflows/:workflowId/versions/:versionId');
  console.log('    POST   /api/workflows/:workflowId/versions/:versionId/restore');
  console.log('    POST   /api/workflows/:workflowId/versions/:versionId/duplicate');
  console.log('    GET    /api/health');
  console.log(`  SQLite DB: ${config.dbPath}`);
  console.log('');
}

const server = app.listen(config.port, config.host, printStartup);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  ${signal} received. Stopping AI Workbench workflow service...`);
  server.close(async (error) => {
    if (error) {
      console.error('Workflow service HTTP server close failed:', error);
      process.exit(1);
      return;
    }
    try {
      await runtime.stop();
      console.log('  AI Workbench workflow service stopped.');
      process.exit(0);
    } catch (stopError) {
      console.error('Workflow service shutdown failed:', stopError);
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
