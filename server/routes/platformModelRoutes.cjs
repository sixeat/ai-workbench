const { createPlatformModelService } = require('../services/platformModelService.cjs');

function sendResponse(res, response) {
  res.status(response.status).json(response.data);
}

function registerPlatformModelRoutes(app, context = {}) {
  const {
    platformModelRepository,
    requireAdmin,
  } = context;
  const service = createPlatformModelService({
    repository: platformModelRepository,
  });

  app.get('/api/platform-models', (req, res) => {
    sendResponse(res, service.listPublicPlatformModels(req));
  });

  app.get('/api/admin/platform-models', (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendResponse(res, service.listAdminPlatformModels(req));
  });

  app.post('/api/admin/platform-models', (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendResponse(res, service.savePlatformModel(req));
  });

  app.post('/api/admin/platform-models/bulk-from-key', (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendResponse(res, service.createPlatformModelsFromKey(req));
  });

  app.patch('/api/admin/platform-models/:platformModelId', (req, res) => {
    if (!requireAdmin(req, res)) return;
    req.body = { ...(req.body || {}), id: req.params.platformModelId };
    sendResponse(res, service.savePlatformModel(req));
  });

  app.delete('/api/admin/platform-models/:platformModelId', (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendResponse(res, service.deletePlatformModel(req));
  });

  app.post('/api/admin/platform-models/:platformModelId/routes', (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendResponse(res, service.savePlatformModelRoute(req));
  });

  app.patch('/api/admin/platform-models/:platformModelId/routes/:routeId', (req, res) => {
    if (!requireAdmin(req, res)) return;
    req.body = { ...(req.body || {}), id: req.params.routeId };
    sendResponse(res, service.savePlatformModelRoute(req));
  });

  app.delete('/api/admin/platform-models/:platformModelId/routes/:routeId', (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendResponse(res, service.deletePlatformModelRoute(req));
  });
}

module.exports = {
  registerPlatformModelRoutes,
};
