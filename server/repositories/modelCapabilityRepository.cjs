const db = require('../db.cjs');

function createModelCapabilityRepository(overrides = {}) {
  return {
    countModelCapabilities: overrides.countModelCapabilities || db.countModelCapabilities,
    createAuditLog: overrides.createAuditLog || db.createAuditLog,
    listModelCapabilities: overrides.listModelCapabilities || db.listModelCapabilities,
    upsertModelCapability: overrides.upsertModelCapability || db.upsertModelCapability,
  };
}

const modelCapabilityRepository = createModelCapabilityRepository();

module.exports = {
  createModelCapabilityRepository,
  modelCapabilityRepository,
};
