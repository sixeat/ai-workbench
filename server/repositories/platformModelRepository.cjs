const db = require('../db.cjs');

function createPlatformModelRepository(overrides = {}) {
  return {
    countPlatformModels: overrides.countPlatformModels || db.countPlatformModels,
    createAuditLog: overrides.createAuditLog || db.createAuditLog,
    deletePlatformModel: overrides.deletePlatformModel || db.deletePlatformModel,
    deletePlatformModelRoute: overrides.deletePlatformModelRoute || db.deletePlatformModelRoute,
    getApiKey: overrides.getApiKey || db.getApiKey,
    getPlatformModel: overrides.getPlatformModel || db.getPlatformModel,
    getPlatformModelRoute: overrides.getPlatformModelRoute || db.getPlatformModelRoute,
    listPlatformModelRoutes: overrides.listPlatformModelRoutes || db.listPlatformModelRoutes,
    listPlatformModels: overrides.listPlatformModels || db.listPlatformModels,
    upsertPlatformModel: overrides.upsertPlatformModel || db.upsertPlatformModel,
    upsertPlatformModelRoute: overrides.upsertPlatformModelRoute || db.upsertPlatformModelRoute,
  };
}

const platformModelRepository = createPlatformModelRepository();

module.exports = {
  createPlatformModelRepository,
  platformModelRepository,
};
