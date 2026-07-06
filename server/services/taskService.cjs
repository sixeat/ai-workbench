const {
  addTaskLog,
  countTasks,
  getTaskForUser,
  listTasks,
  listTaskAssets,
  listTaskLogs,
  updateTask,
} = require('../db.cjs');

function createTaskService({ publicAsset }) {
  function publicTask(task, options = {}) {
    if (!task) return null;
    const result = {
      ...task,
      assets: listTaskAssets(task.id, task.userId).map(publicAsset),
    };
    if (options.includeLogs) result.logs = listTaskLogs(task.id);
    return result;
  }

  function parseIncludeLogs(value) {
    return value === true || value === 'true' || value === '1';
  }

  function normalizeListOptions(options = 100) {
    if (typeof options === 'number') {
      return {
        limit: Math.max(1, Math.min(500, Number(options || 100) || 100)),
        offset: 0,
        includeLogs: false,
      };
    }

    return {
      limit: Math.max(1, Math.min(500, Number(options.limit || 100) || 100)),
      offset: Math.max(0, Math.min(100_000, Number(options.offset || 0) || 0)),
      includeLogs: parseIncludeLogs(options.includeLogs),
    };
  }

  function listUserTasks(userId, options = 100) {
    const query = normalizeListOptions(options);
    const total = countTasks(userId);
    return {
      tasks: listTasks(userId, query).map((task) => publicTask(task, { includeLogs: query.includeLogs })),
      count: total,
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  function getUserTask(taskId, userId) {
    const task = getTaskForUser(taskId, userId);
    return task ? publicTask(task, { includeLogs: true }) : null;
  }

  function cancelTask(taskId, userId) {
    const task = getTaskForUser(taskId, userId);
    if (!task) return null;
    if (task.status === 'queued' || task.status === 'running') {
      addTaskLog(task.id, {
        level: 'warn',
        event: 'cancel_requested',
        message: task.status === 'running'
          ? 'Running task was marked as cancelled. The active upstream request may finish in the background.'
          : 'Queued task was cancelled before execution.',
      });
      return publicTask(updateTask(task.id, {
        status: 'cancelled',
        error: task.status === 'running'
          ? { message: 'Cancellation requested while task was running.' }
          : null,
      }), { includeLogs: true });
    }
    return publicTask(task, { includeLogs: true });
  }

  return {
    cancelTask,
    getUserTask,
    listUserTasks,
    publicTask,
  };
}

module.exports = {
  createTaskService,
};
