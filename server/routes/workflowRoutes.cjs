const { randomUUID } = require('crypto');
const {
  countWorkflowVersions,
  countWorkflows,
  deleteWorkflow,
  getWorkflowForUser,
  getWorkflowVersionForUser,
  listWorkflows,
  listWorkflowVersions,
  restoreWorkflowVersion,
  upsertWorkflow,
} = require('../db.cjs');
const { sendSafeError } = require('../httpErrors.cjs');

const WORKFLOW_PAYLOAD_LIMITS = {
  maxIdLength: 160,
  maxNameLength: 160,
  maxDescriptionLength: 4000,
  maxNodes: 500,
  maxEdges: 1000,
  maxMetadataBytes: 64 * 1024,
};

function publicError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function normalizeStringField(value, fallback, fieldName, maxLength, { trim = false } = {}) {
  const raw = value === undefined || value === null ? fallback : value;
  const text = trim ? String(raw || '').trim() : String(raw || '');
  const normalized = text || fallback;
  if (normalized.length > maxLength) {
    throw publicError(400, `${fieldName} can include at most ${maxLength} characters.`);
  }
  return normalized;
}

function normalizeWorkflowId(body, id) {
  const source = id || body.id;
  if (source === undefined || source === null || source === '') return randomUUID();
  const workflowId = String(source).trim();
  if (!workflowId) return randomUUID();
  if (workflowId.length > WORKFLOW_PAYLOAD_LIMITS.maxIdLength) {
    throw publicError(400, `id can include at most ${WORKFLOW_PAYLOAD_LIMITS.maxIdLength} characters.`);
  }
  return workflowId;
}

function normalizeWorkflowArray(body, fieldName, maxItems) {
  const value = body[fieldName];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw publicError(400, `${fieldName} must be an array.`);
  }
  if (value.length > maxItems) {
    throw publicError(413, `${fieldName} can include at most ${maxItems} items.`);
  }
  return value;
}

function normalizeMetadata(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw publicError(400, 'metadata must be an object.');
  }

  const size = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (size > WORKFLOW_PAYLOAD_LIMITS.maxMetadataBytes) {
    throw publicError(413, `metadata can include at most ${WORKFLOW_PAYLOAD_LIMITS.maxMetadataBytes} bytes.`);
  }
  return value;
}

function normalizeCreatedAt(value) {
  if (typeof value !== 'string') return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

function logUnexpectedWorkflowError(route, error) {
  const status = Number(error?.status || 500);
  if (status >= 500) {
    console.error(`${route} error:`, error.message);
  }
}

function workflowPayload(body, userId, id) {
  const nodes = normalizeWorkflowArray(body, 'nodes', WORKFLOW_PAYLOAD_LIMITS.maxNodes);
  const edges = normalizeWorkflowArray(body, 'edges', WORKFLOW_PAYLOAD_LIMITS.maxEdges);
  return {
    id: normalizeWorkflowId(body, id),
    userId,
    name: normalizeStringField(
      body.name,
      'Untitled workflow',
      'name',
      WORKFLOW_PAYLOAD_LIMITS.maxNameLength,
      { trim: true }
    ),
    description: normalizeStringField(
      body.description,
      '',
      'description',
      WORKFLOW_PAYLOAD_LIMITS.maxDescriptionLength
    ),
    nodes,
    edges,
    metadata: normalizeMetadata(body.metadata),
    nodeCount: nodes.length,
    createdAt: normalizeCreatedAt(body.createdAt),
    updatedAt: new Date().toISOString(),
  };
}

function registerWorkflowRoutes(app, context) {
  const { getRequestUserId } = context;

  app.get('/api/workflows', (req, res) => {
    const userId = getRequestUserId(req);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100) || 100));
    const offset = Math.max(0, Number(req.query.offset || 0) || 0);
    const query = {
      limit,
      offset,
      search: req.query.search || req.query.q,
    };
    const workflows = listWorkflows(userId, query);
    res.json({
      workflows,
      count: workflows.length,
      total: countWorkflows(userId, query),
      limit,
      offset,
    });
  });

  app.post('/api/workflows', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const workflow = upsertWorkflow(workflowPayload(req.body || {}, userId));
      if (!workflow) return res.status(409).json({ error: 'Workflow id is already used' });
      res.status(201).json({ workflow });
    } catch (error) {
      logUnexpectedWorkflowError('/api/workflows', error);
      sendSafeError(res, error, { message: 'Unable to save workflow.' });
    }
  });

  app.get('/api/workflows/:workflowId/versions', (req, res) => {
    const userId = getRequestUserId(req);
    const workflow = getWorkflowForUser(req.params.workflowId, userId);
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50) || 50));
    const offset = Math.max(0, Number(req.query.offset || 0) || 0);
    const versions = listWorkflowVersions(req.params.workflowId, userId, { limit, offset });
    res.json({
      versions,
      count: versions.length,
      total: countWorkflowVersions(req.params.workflowId, userId),
      limit,
      offset,
    });
  });

  app.get('/api/workflows/:workflowId/versions/:versionId', (req, res) => {
    const userId = getRequestUserId(req);
    const version = getWorkflowVersionForUser(req.params.workflowId, req.params.versionId, userId);
    if (!version) return res.status(404).json({ error: 'Workflow version not found' });
    res.json({ version });
  });

  app.post('/api/workflows/:workflowId/versions/:versionId/restore', (req, res) => {
    const userId = getRequestUserId(req);
    const workflow = restoreWorkflowVersion(req.params.workflowId, req.params.versionId, userId);
    if (!workflow) return res.status(404).json({ error: 'Workflow version not found' });
    res.json({ workflow });
  });

  app.post('/api/workflows/:workflowId/versions/:versionId/duplicate', (req, res) => {
    const userId = getRequestUserId(req);
    const version = getWorkflowVersionForUser(req.params.workflowId, req.params.versionId, userId);
    if (!version) return res.status(404).json({ error: 'Workflow version not found' });

    const workflow = upsertWorkflow({
      id: randomUUID(),
      userId,
      name: `${version.name} v${version.versionNumber} Copy`,
      description: version.description,
      nodes: version.nodes,
      edges: version.edges,
      metadata: {
        ...version.metadata,
        copiedFromWorkflowId: req.params.workflowId,
        copiedFromVersionId: version.id,
        copiedFromVersionNumber: version.versionNumber,
      },
      nodeCount: version.nodeCount,
      versionSource: 'duplicate-version',
    });

    res.status(201).json({ workflow });
  });

  app.get('/api/workflows/:workflowId', (req, res) => {
    const userId = getRequestUserId(req);
    const workflow = getWorkflowForUser(req.params.workflowId, userId);
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    res.json({ workflow });
  });

  app.put('/api/workflows/:workflowId', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const workflow = upsertWorkflow(workflowPayload(req.body || {}, userId, req.params.workflowId));
      if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
      res.json({ workflow });
    } catch (error) {
      logUnexpectedWorkflowError('/api/workflows/:workflowId', error);
      sendSafeError(res, error, { message: 'Unable to save workflow.' });
    }
  });

  app.post('/api/workflows/:workflowId/duplicate', (req, res) => {
    const userId = getRequestUserId(req);
    const original = getWorkflowForUser(req.params.workflowId, userId);
    if (!original) return res.status(404).json({ error: 'Workflow not found' });

    const workflow = upsertWorkflow({
      ...original,
      id: randomUUID(),
      userId,
      name: `${original.name} Copy`,
      metadata: {
        ...original.metadata,
        copiedFromWorkflowId: original.id,
      },
      createdAt: undefined,
      updatedAt: new Date().toISOString(),
      versionSource: 'duplicate',
    });
    res.status(201).json({ workflow });
  });

  app.delete('/api/workflows/:workflowId', (req, res) => {
    const userId = getRequestUserId(req);
    const deleted = deleteWorkflow(req.params.workflowId, userId);
    if (!deleted) return res.status(404).json({ error: 'Workflow not found' });
    res.json({ ok: true });
  });
}

module.exports = {
  WORKFLOW_PAYLOAD_LIMITS,
  registerWorkflowRoutes,
};
