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
    workflowRunsEnabled = true,
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
      // 功能开关关着时，推进运行的 worker 根本没启动，创建出来的运行会永远停在
      // queued、节点停在 pending，而且不报任何错。这里直接拒绝并给出可操作的文案。
      //
      // 刻意不用 sendSafeError：它对 5xx 会用路由的通用文案盖掉具体原因
      // （见 httpErrors.cjs 的 exposedMessage 判断），而这条错误的价值全在文案里。
      //
      // 只按「功能开关」判断，不看本进程有没有跑 worker——分进程部署下 API 进程
      // 本来就是 WORKBENCH_START_WORKERS=false，由另一个进程消费。
      if (!workflowRunsEnabled) {
        res.status(503).json({
          error: 'Server-side workflow runs are disabled on this server. '
            + 'Set WORKBENCH_SERVER_SIDE_RUNS=true to enable them.',
        });
        return;
      }
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
