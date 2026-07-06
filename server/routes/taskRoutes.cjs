const { sendSafeError } = require('../httpErrors.cjs');

function registerTaskRoutes(app, context) {
  const { getRequestUserId, taskService } = context;
  const retryTask = context.retryTask || context.retryGenerationTask;

  app.get('/api/tasks', (req, res) => {
    const userId = getRequestUserId(req);
    res.json(taskService.listUserTasks(userId, {
      limit: req.query?.limit,
      offset: req.query?.offset,
      includeLogs: req.query?.includeLogs,
    }));
  });

  app.get('/api/tasks/:taskId', (req, res) => {
    const userId = getRequestUserId(req);
    const task = taskService.getUserTask(req.params.taskId, userId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ task });
  });

  app.post('/api/tasks/:taskId/cancel', (req, res) => {
    const userId = getRequestUserId(req);
    const task = taskService.cancelTask(req.params.taskId, userId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ task });
  });

  app.post('/api/tasks/:taskId/retry', async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const task = taskService.getUserTask(req.params.taskId, userId);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      if (task.status !== 'failed') return res.status(400).json({ error: 'Only failed tasks can be retried.' });
      if (!retryTask) return res.status(501).json({ error: 'Task retry is not available.' });

      const result = await retryTask({ req, userId, task });
      res.status(result.status).json(result.data);
    } catch (error) {
      console.error('/api/tasks/:taskId/retry error:', error.message);
      sendSafeError(res, error, { message: 'Task retry failed.' });
    }
  });
}

module.exports = {
  registerTaskRoutes,
};
