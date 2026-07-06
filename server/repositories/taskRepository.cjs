const db = require('../db.cjs');

function createTaskRepository(overrides = {}) {
  return {
    addTaskLog: overrides.addTaskLog || db.addTaskLog,
    claimQueuedTask: overrides.claimQueuedTask || db.claimQueuedTask,
    countAllTasks: overrides.countAllTasks || db.countAllTasks,
    countQueuedTasks: overrides.countQueuedTasks || db.countQueuedTasks,
    countTasks: overrides.countTasks || db.countTasks,
    createTask: overrides.createTask || db.createTask,
    getTask: overrides.getTask || db.getTask,
    getTaskForUser: overrides.getTaskForUser || db.getTaskForUser,
    linkTaskAsset: overrides.linkTaskAsset || db.linkTaskAsset,
    listQueuedTasks: overrides.listQueuedTasks || db.listQueuedTasks,
    listTaskAssets: overrides.listTaskAssets || db.listTaskAssets,
    listTaskLogs: overrides.listTaskLogs || db.listTaskLogs,
    listTasks: overrides.listTasks || db.listTasks,
    markRunningTasksInterrupted: overrides.markRunningTasksInterrupted || db.markRunningTasksInterrupted,
    updateTask: overrides.updateTask || db.updateTask,
  };
}

const taskRepository = createTaskRepository();

module.exports = {
  createTaskRepository,
  taskRepository,
};
