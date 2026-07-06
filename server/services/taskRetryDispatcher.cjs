function taskKind(task) {
  return String(task?.nodeType || task?.kind || '').trim().toLowerCase();
}

function unsupportedRetry(kind) {
  return {
    status: 400,
    data: {
      error: `Retry is not supported for ${kind || 'this task'} tasks.`,
    },
  };
}

function unavailableRetry(kind) {
  return {
    status: 501,
    data: {
      error: `${kind || 'Task'} retry is not available.`,
    },
  };
}

function createTaskRetryDispatcher({ retryTextTask, retryGenerationTask } = {}) {
  return async function retryTask({ req, userId, task }) {
    const kind = taskKind(task);
    if (kind === 'text') {
      if (!retryTextTask) return unavailableRetry('Text');
      return retryTextTask({ req, userId, task });
    }
    if (kind === 'image' || kind === 'video') {
      if (!retryGenerationTask) return unavailableRetry('Generation');
      return retryGenerationTask({ req, userId, task });
    }
    return unsupportedRetry(kind);
  };
}

module.exports = {
  createTaskRetryDispatcher,
  taskKind,
};
