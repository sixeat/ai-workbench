const { taskRepository: defaultTaskRepository } = require('../repositories/taskRepository.cjs');
const { collectTaskRelationshipIds } = require('./taskRelationshipService.cjs');

function elapsedTaskMs(task) {
  const startedAt = new Date(task?.updatedAt || task?.createdAt || '').getTime();
  return Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : 0;
}

function taskRelationshipData(task) {
  const upstreamTaskIds = collectTaskRelationshipIds(task?.input || {}, task?.output || {});
  return upstreamTaskIds.length > 0 ? { upstreamTaskIds } : {};
}

function cancellationLogData(task) {
  return {
    status: task.status,
    nodeType: task.nodeType,
    providerId: task.providerId,
    model: task.model,
    durationMs: elapsedTaskMs(task),
    ...taskRelationshipData(task),
  };
}

function createTaskService({ creditService = null, publicAsset, taskRepository = defaultTaskRepository }) {
  function publicTask(task, options = {}) {
    if (!task) return null;
    const result = {
      ...task,
      assets: taskRepository.listTaskAssets(task.id, task.userId).map(publicAsset),
    };
    if (options.includeLogs) result.logs = taskRepository.listTaskLogs(task.id);
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
    const total = taskRepository.countTasks(userId);
    return {
      tasks: taskRepository.listTasks(userId, query).map((task) => publicTask(task, { includeLogs: query.includeLogs })),
      count: total,
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  function getUserTask(taskId, userId) {
    const task = taskRepository.getTaskForUser(taskId, userId);
    return task ? publicTask(task, { includeLogs: true }) : null;
  }

  function cancelTask(taskId, userId) {
    const task = taskRepository.getTaskForUser(taskId, userId);
    if (!task) return null;
    if (task.status === 'queued' || task.status === 'running') {
      taskRepository.addTaskLog(task.id, {
        level: 'warn',
        event: 'cancel_requested',
        message: task.status === 'running'
          ? 'Running task was marked as cancelled. The active upstream request may finish in the background.'
          : 'Queued task was cancelled before execution.',
        data: cancellationLogData(task),
      });
      const updatedTask = taskRepository.updateTask(task.id, {
        status: 'cancelled',
        error: task.status === 'running'
          ? { message: 'Cancellation requested while task was running.' }
          : null,
      });
      let nextTask = updatedTask;
      if (creditService?.refundTask) {
        creditService.refundTask(updatedTask, {
          description: 'Task credits refunded after cancellation.',
          metadata: {
            nodeType: updatedTask.nodeType,
            previousStatus: task.status,
            providerId: updatedTask.providerId,
          },
          reason: 'cancelled',
        });
        nextTask = taskRepository.getTask(updatedTask.id) || updatedTask;
      }
      return publicTask(nextTask, { includeLogs: true });
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
