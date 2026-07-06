const { createApiKeyManagementService } = require('../services/apiKeyManagementService.cjs');

function sendResponse(res, response) {
  if (!response) return false;
  res.status(response.status).json(response.data);
  return true;
}

function registerApiKeyRoutes(app, context) {
  const {
    encryptSecret,
    getRequestUserId,
    keyBelongsToUser,
    maxUserApiKeys = 20,
    requireAdmin,
    testApiKey,
    apiKeyRepository,
  } = context;

  const apiKeyManagementService = createApiKeyManagementService({
    apiKeyRepository,
    encryptSecret,
    getRequestUserId,
    keyBelongsToUser,
    maxUserApiKeys,
    testApiKey,
  });

  function ensureAdmin(req, res) {
    return requireAdmin(req, res);
  }

  app.get('/api/api-keys', (req, res) => {
    sendResponse(res, apiKeyManagementService.listApiKeys(req));
  });

  app.post('/api/api-keys', (req, res) => {
    sendResponse(res, apiKeyManagementService.createApiKey(req, {
      ensureAdmin: () => ensureAdmin(req, res),
    }));
  });

  app.patch('/api/api-keys/:apiKeyId', (req, res) => {
    sendResponse(res, apiKeyManagementService.updateApiKey(req, {
      ensureAdmin: () => ensureAdmin(req, res),
    }));
  });

  app.delete('/api/api-keys/:apiKeyId', (req, res) => {
    sendResponse(res, apiKeyManagementService.deleteApiKey(req, {
      ensureAdmin: () => ensureAdmin(req, res),
    }));
  });

  app.post('/api/api-keys/:apiKeyId/test', async (req, res) => {
    sendResponse(res, await apiKeyManagementService.testSavedApiKey(req, {
      ensureAdmin: () => ensureAdmin(req, res),
    }));
  });
}

module.exports = {
  registerApiKeyRoutes,
};
