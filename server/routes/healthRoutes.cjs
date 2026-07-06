function buildPublicHealth(context) {
  return {
    status: 'ok',
    time: context.now().toISOString(),
    deploymentMode: context.deploymentMode,
    serveStatic: context.serveStatic,
  };
}

function buildAdminHealth(context) {
  const queues = typeof context.getQueueHealth === 'function' ? context.getQueueHealth() : [];
  return {
    ...buildPublicHealth(context),
    host: context.host,
    outputDir: context.outputDir,
    dbPath: context.dbPath,
    defaultUserId: context.defaultUserId,
    assets: context.countAllAssets(),
    tasks: context.countAllTasks(),
    users: context.countAllUsers(),
    enabledUsers: context.countEnabledUsers(),
    localUserAssets: context.countAssets(context.defaultUserId),
    localUserTasks: context.countTasks(context.defaultUserId),
    queues,
  };
}

function registerHealthRoutes(app, context) {
  const routeContext = {
    now: () => new Date(),
    ...context,
  };

  app.get('/api/health', (_req, res) => {
    res.json(buildPublicHealth(routeContext));
  });

  app.get('/api/admin/health', (req, res) => {
    if (!routeContext.requireAdmin(req, res)) return;
    res.json(buildAdminHealth(routeContext));
  });
}

module.exports = {
  buildAdminHealth,
  buildPublicHealth,
  registerHealthRoutes,
};
