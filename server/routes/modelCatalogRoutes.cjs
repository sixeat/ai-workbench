const { sendSafeError } = require('../httpErrors.cjs');
const { createModelCatalogService } = require('../services/modelCatalogService.cjs');

function sendResponse(res, result) {
  res.status(result.status).json(result.data);
}

function registerModelCatalogRoutes(app, context = {}) {
  const service = createModelCatalogService(context);

  app.get('/api/model-catalog', (req, res) => {
    sendResponse(res, service.listCatalog(req));
  });

  app.get('/api/api-keys/:apiKeyId/models', (req, res) => {
    sendResponse(res, service.listKeyModels(req));
  });

  app.post('/api/api-keys/:apiKeyId/models/discover', async (req, res) => {
    try {
      sendResponse(res, await service.discoverKeyModels(req));
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to discover API key models.' });
    }
  });

  app.patch('/api/api-keys/:apiKeyId/models/:apiKeyModelId', (req, res) => {
    sendResponse(res, service.updateKeyModel(req));
  });
}

module.exports = {
  registerModelCatalogRoutes,
};
