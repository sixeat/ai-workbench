const db = require('../db.cjs');

// 工作流运行的数据访问边界。与其它 repository 一致：只做数据访问，
// 不依赖 routes / services / workers（由 backendModuleBoundary.test.cjs 守护）。
function createWorkflowRunRepository(overrides = {}) {
  return {
    countWorkflowRuns: overrides.countWorkflowRuns || db.countWorkflowRuns,
    createWorkflowRun: overrides.createWorkflowRun || db.createWorkflowRun,
    createWorkflowRunNode: overrides.createWorkflowRunNode || db.createWorkflowRunNode,
    getWorkflowRun: overrides.getWorkflowRun || db.getWorkflowRun,
    getWorkflowRunByIdempotencyKey: overrides.getWorkflowRunByIdempotencyKey || db.getWorkflowRunByIdempotencyKey,
    getWorkflowRunForUser: overrides.getWorkflowRunForUser || db.getWorkflowRunForUser,
    getTaskByWorkflowRunNode: overrides.getTaskByWorkflowRunNode || db.getTaskByWorkflowRunNode,
    getWorkflowRunNode: overrides.getWorkflowRunNode || db.getWorkflowRunNode,
    linkWorkflowRunNodeTask: overrides.linkWorkflowRunNodeTask || db.linkWorkflowRunNodeTask,
    listActiveWorkflowRuns: overrides.listActiveWorkflowRuns || db.listActiveWorkflowRuns,
    listWorkflowRunNodes: overrides.listWorkflowRunNodes || db.listWorkflowRunNodes,
    listWorkflowRuns: overrides.listWorkflowRuns || db.listWorkflowRuns,
    updateWorkflowRun: overrides.updateWorkflowRun || db.updateWorkflowRun,
    updateWorkflowRunNode: overrides.updateWorkflowRunNode || db.updateWorkflowRunNode,
  };
}

const workflowRunRepository = createWorkflowRunRepository();

module.exports = {
  createWorkflowRunRepository,
  workflowRunRepository,
};
