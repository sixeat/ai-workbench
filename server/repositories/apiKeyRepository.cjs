const db = require('../db.cjs');

const DEFAULT_SERVER_KEY_OWNER_USER_ID = db.DEFAULT_USER_ID;

function createApiKeyRepository(overrides = {}) {
  return {
    countApiKeys: overrides.countApiKeys || db.countApiKeys,
    createAuditLog: overrides.createAuditLog || db.createAuditLog,
    deleteApiKey: overrides.deleteApiKey || db.deleteApiKey,
    getApiKey: overrides.getApiKey || db.getApiKey,
    getApiKeyForUser: overrides.getApiKeyForUser || db.getApiKeyForUser,
    listApiKeys: overrides.listApiKeys || db.listApiKeys,
    upsertApiKey: overrides.upsertApiKey || db.upsertApiKey,
  };
}

const apiKeyRepository = createApiKeyRepository();

module.exports = {
  DEFAULT_SERVER_KEY_OWNER_USER_ID,
  apiKeyRepository,
  createApiKeyRepository,
};
