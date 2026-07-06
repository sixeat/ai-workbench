const { sendSafeError } = require('../httpErrors.cjs');
const {
  WORKFLOW_PAYLOAD_LIMITS,
  createWorkflowService,
} = require('../services/workflowService.cjs');

function sendResponse(res, response) {
  res.status(response.status).json(response.data);
}

function logUnexpectedWorkflowError(route, error) {
  const status = Number(error?.status || 500);
  if (status >= 500) {
    console.error(`${route} error:`, error.message);
  }
}

function requestIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function auditContext(req, userId) {
  return {
    actorUserId: req.authUser?.id || userId,
    ipAddress: requestIp(req),
    userAgent: String(req.headers?.['user-agent'] || '').slice(0, 500),
  };
}

function registerWorkflowRoutes(app, context) {
  const {
    getRequestUserId,
    workflowRepository,
  } = context;
  const workflowService = createWorkflowService({ workflowRepository });

  app.get('/api/workflows', (req, res) => {
    const userId = getRequestUserId(req);
    sendResponse(res, workflowService.listWorkflows(userId, req.query || {}));
  });

  app.post('/api/workflows', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      sendResponse(res, workflowService.createWorkflow(userId, req.body || {}, auditContext(req, userId)));
    } catch (error) {
      logUnexpectedWorkflowError('/api/workflows', error);
      sendSafeError(res, error, { message: 'Unable to save workflow.' });
    }
  });

  app.get('/api/workflows/:workflowId/versions', (req, res) => {
    const userId = getRequestUserId(req);
    sendResponse(res, workflowService.listWorkflowVersions(userId, req.params.workflowId, req.query || {}));
  });

  app.get('/api/workflows/:workflowId/versions/:versionId', (req, res) => {
    const userId = getRequestUserId(req);
    sendResponse(res, workflowService.getWorkflowVersion(userId, req.params.workflowId, req.params.versionId));
  });

  app.post('/api/workflows/:workflowId/versions/:versionId/restore', (req, res) => {
    const userId = getRequestUserId(req);
    sendResponse(res, workflowService.restoreWorkflowVersion(
      userId,
      req.params.workflowId,
      req.params.versionId,
      auditContext(req, userId)
    ));
  });

  app.post('/api/workflows/:workflowId/versions/:versionId/duplicate', (req, res) => {
    const userId = getRequestUserId(req);
    sendResponse(res, workflowService.duplicateWorkflowVersion(
      userId,
      req.params.workflowId,
      req.params.versionId,
      auditContext(req, userId)
    ));
  });

  app.get('/api/workflows/:workflowId', (req, res) => {
    const userId = getRequestUserId(req);
    sendResponse(res, workflowService.getWorkflow(userId, req.params.workflowId));
  });

  app.put('/api/workflows/:workflowId', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      sendResponse(res, workflowService.updateWorkflow(
        userId,
        req.params.workflowId,
        req.body || {},
        auditContext(req, userId)
      ));
    } catch (error) {
      logUnexpectedWorkflowError('/api/workflows/:workflowId', error);
      sendSafeError(res, error, { message: 'Unable to save workflow.' });
    }
  });

  app.post('/api/workflows/:workflowId/duplicate', (req, res) => {
    const userId = getRequestUserId(req);
    sendResponse(res, workflowService.duplicateWorkflow(userId, req.params.workflowId, auditContext(req, userId)));
  });

  app.delete('/api/workflows/:workflowId', (req, res) => {
    const userId = getRequestUserId(req);
    sendResponse(res, workflowService.deleteWorkflow(userId, req.params.workflowId, auditContext(req, userId)));
  });
}

module.exports = {
  WORKFLOW_PAYLOAD_LIMITS,
  registerWorkflowRoutes,
};
