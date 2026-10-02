const { sendSafeError } = require('../httpErrors.cjs');

// 工作流运行的服务端入口。
//
// 这是"关掉浏览器也能跑完整条流水线"的对外接口：提交一次运行，
// 由 workflowRunWorker 在后台推进，前端只需要轮询结果。
//
// 与其它路由一致：只做参数校验与响应，业务逻辑在 workflowRunService 里。
function registerWorkflowRunRoutes(app, context) {
  const {
    getRequestUserId,
    workflowRunService,
  } = context;

  if (!workflowRunService) throw new Error('workflowRunService is required for workflow run routes.');

  function queryOptions(query = {}) {
    return {
      limit: query.limit,
      offset: query.offset,
      status: query.status,
      workflowId: query.workflowId,
    };
  }

  app.get('/api/workflow-runs', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      res.json(workflowRunService.listRuns({ userId, ...queryOptions(req.query || {}) }));
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to list workflow runs.' });
    }
  });

  app.post('/api/workflow-runs', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const body = req.body || {};
      const { created, run } = workflowRunService.createRun({
        idempotencyKey: body.idempotencyKey,
        trigger: 'api',
        userId,
        workflowId: body.workflowId,
        workflowVersionId: body.workflowVersionId,
      });
      // 重复提交同一个幂等键时返回已有运行，用 200 与首次创建（201）区分
      res.status(created ? 201 : 200).json({ created, run });
    } catch (error) {
      console.error('/api/workflow-runs error:', error.message);
      sendSafeError(res, error, { message: 'Unable to create workflow run.' });
    }
  });

  app.get('/api/workflow-runs/:runId', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      res.json(workflowRunService.getRun({ runId: req.params.runId, userId }));
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to load workflow run.' });
    }
  });

  app.get('/api/workflow-runs/:runId/plan', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const { plan, run } = workflowRunService.planRun({ runId: req.params.runId, userId });
      res.json({ plan, runId: run.id, status: run.status });
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to load workflow run plan.' });
    }
  });

  app.post('/api/workflow-runs/:runId/cancel', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const result = workflowRunService.cancelRun({ runId: req.params.runId, userId });
      res.json({ nodes: result.nodes, run: result.run });
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to cancel workflow run.' });
    }
  });

  app.post('/api/workflow-runs/:runId/retry', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const result = workflowRunService.retryFailedNodes({ runId: req.params.runId, userId });
      res.json(result);
    } catch (error) {
      console.error('/api/workflow-runs/:runId/retry error:', error.message);
      sendSafeError(res, error, { message: 'Unable to retry workflow run.' });
    }
  });
}

module.exports = {
  registerWorkflowRunRoutes,
};
