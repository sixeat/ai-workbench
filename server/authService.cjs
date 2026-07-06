const { loadEnv } = require('./env.cjs');

loadEnv();

const { createAuthServiceApp } = require('./authServiceApp.cjs');

const runtime = createAuthServiceApp();
const { app, config } = runtime;

function printStartup() {
  console.log(`\n  AI Workbench Auth Service\n  Listening on http://${config.host}:${config.port}\n`);
  console.log('  Endpoints:');
  console.log('    GET  /api/auth/me');
  console.log('    POST /api/auth/login');
  console.log('    POST /api/auth/logout');
  console.log('    GET  /api/auth/sessions');
  console.log('    POST /api/auth/register/request');
  console.log('    POST /api/auth/register/verify');
  console.log('    POST /api/auth/password-reset/request');
  console.log('    POST /api/auth/password-reset/verify');
  console.log('    GET  /api/admin/users');
  console.log('    GET  /api/admin/audit-logs');
  console.log('    GET  /api/admin/invitations');
  console.log('    GET  /api/health');
  console.log(`  SQLite DB: ${config.dbPath}`);
  console.log('');
}

const server = app.listen(config.port, config.host, printStartup);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  ${signal} received. Stopping AI Workbench auth service...`);
  server.close(async (error) => {
    if (error) {
      console.error('Auth service HTTP server close failed:', error);
      process.exit(1);
      return;
    }
    try {
      await runtime.stop();
      console.log('  AI Workbench auth service stopped.');
      process.exit(0);
    } catch (stopError) {
      console.error('Auth service shutdown failed:', stopError);
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
