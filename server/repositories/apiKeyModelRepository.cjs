const db = require('../db.cjs');

function createApiKeyModelRepository(overrides = {}) {
  return {
    countApiKeyModels: overrides.countApiKeyModels || db.countApiKeyModels,
    createAuditLog: overrides.createAuditLog || db.createAuditLog,
    getApiKey: overrides.getApiKey || db.getApiKey,
    getApiKeyForUser: overrides.getApiKeyForUser || db.getApiKeyForUser,
    getApiKeyModel: overrides.getApiKeyModel || db.getApiKeyModel,
    getApiKeyModelByKeyAndName: overrides.getApiKeyModelByKeyAndName || db.getApiKeyModelByKeyAndName,
    getApiKeyModelForUser: overrides.getApiKeyModelForUser || db.getApiKeyModelForUser,
    listApiKeyModels: overrides.listApiKeyModels || db.listApiKeyModels,
    listUserApiKeyModels: overrides.listUserApiKeyModels || db.listUserApiKeyModels,
    markApiKeyModelsMissing: overrides.markApiKeyModelsMissing || db.markApiKeyModelsMissing,
    upsertApiKeyModel: overrides.upsertApiKeyModel || db.upsertApiKeyModel,
  };
}

const apiKeyModelRepository = createApiKeyModelRepository();

module.exports = {
  apiKeyModelRepository,
  createApiKeyModelRepository,
};
