const db = require('../db.cjs');

function createWorkflowRepository(overrides = {}) {
  return {
    countWorkflowVersions: overrides.countWorkflowVersions || db.countWorkflowVersions,
    countWorkflows: overrides.countWorkflows || db.countWorkflows,
    createAuditLog: overrides.createAuditLog || db.createAuditLog,
    deleteWorkflow: overrides.deleteWorkflow || db.deleteWorkflow,
    getWorkflowForUser: overrides.getWorkflowForUser || db.getWorkflowForUser,
    getWorkflowVersionForUser: overrides.getWorkflowVersionForUser || db.getWorkflowVersionForUser,
    listWorkflowVersions: overrides.listWorkflowVersions || db.listWorkflowVersions,
    listWorkflows: overrides.listWorkflows || db.listWorkflows,
    restoreWorkflowVersion: overrides.restoreWorkflowVersion || db.restoreWorkflowVersion,
    upsertWorkflow: overrides.upsertWorkflow || db.upsertWorkflow,
  };
}

const workflowRepository = createWorkflowRepository();

module.exports = {
  createWorkflowRepository,
  workflowRepository,
};
