const { randomUUID } = require('crypto');
const { workflowRepository: defaultWorkflowRepository } = require('../repositories/workflowRepository.cjs');

const WORKFLOW_PAYLOAD_LIMITS = {
  maxDescriptionLength: 4000,
  maxEdges: 1000,
  maxIdLength: 160,
  maxMetadataBytes: 64 * 1024,
  maxNameLength: 160,
  maxNodes: 500,
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

function listQuery(queryParams = {}, defaultLimit = 100, maxLimit = 200) {
  return {
    limit: Math.min(maxLimit, Math.max(1, Number(queryParams.limit || defaultLimit) || defaultLimit)),
    offset: Math.max(0, Number(queryParams.offset || 0) || 0),
    search: queryParams.search || queryParams.q,
  };
}

function workflowPayload(body, userId, id) {
  const nodes = normalizeWorkflowArray(body, 'nodes', WORKFLOW_PAYLOAD_LIMITS.maxNodes);
  const edges = normalizeWorkflowArray(body, 'edges', WORKFLOW_PAYLOAD_LIMITS.maxEdges);
  return {
    createdAt: normalizeCreatedAt(body.createdAt),
    description: normalizeStringField(
      body.description,
      '',
      'description',
      WORKFLOW_PAYLOAD_LIMITS.maxDescriptionLength
    ),
    edges,
    id: normalizeWorkflowId(body, id),
    metadata: normalizeMetadata(body.metadata),
    name: normalizeStringField(
      body.name,
      'Untitled workflow',
      'name',
      WORKFLOW_PAYLOAD_LIMITS.maxNameLength,
      { trim: true }
    ),
    nodeCount: nodes.length,
    nodes,
    updatedAt: new Date().toISOString(),
    userId,
  };
}

function response(status, data) {
  return { data, status };
}

function auditContext(userId, context = {}) {
  return {
    actorUserId: context.actorUserId || userId,
    ipAddress: context.ipAddress || null,
    userAgent: context.userAgent || null,
  };
}

function workflowAuditMetadata(workflow, extra = {}) {
  return {
    name: workflow?.name || '',
    nodeCount: Number(workflow?.nodeCount || 0),
    ...extra,
  };
}

function writeWorkflowAuditLog(workflowRepository, userId, action, targetId, metadata = {}, context = {}) {
  if (typeof workflowRepository.createAuditLog !== 'function') return null;
  const requestContext = auditContext(userId, context);
  return workflowRepository.createAuditLog({
    action,
    actorUserId: requestContext.actorUserId,
    ipAddress: requestContext.ipAddress,
    metadata,
    targetId,
    targetType: 'workflow',
    userAgent: requestContext.userAgent,
  });
}

function workflowNotFound() {
  return response(404, { error: 'Workflow not found' });
}

function workflowVersionNotFound() {
  return response(404, { error: 'Workflow version not found' });
}

function createWorkflowService(options = {}) {
  const {
    createId = randomUUID,
    workflowRepository = defaultWorkflowRepository,
  } = options;

  function listWorkflows(userId, queryParams = {}) {
    const query = listQuery(queryParams, 100, 200);
    const workflows = workflowRepository.listWorkflows(userId, query);
    return response(200, {
      count: workflows.length,
      limit: query.limit,
      offset: query.offset,
      total: workflowRepository.countWorkflows(userId, query),
      workflows,
    });
  }

  function createWorkflow(userId, body = {}, context = {}) {
    const workflow = workflowRepository.upsertWorkflow(workflowPayload(body, userId));
    if (!workflow) return response(409, { error: 'Workflow id is already used' });
    writeWorkflowAuditLog(
      workflowRepository,
      userId,
      'workflow.create',
      workflow.id,
      workflowAuditMetadata(workflow),
      context
    );
    return response(201, { workflow });
  }

  function listWorkflowVersions(userId, workflowId, queryParams = {}) {
    const workflow = workflowRepository.getWorkflowForUser(workflowId, userId);
    if (!workflow) return workflowNotFound();

    const { limit, offset } = listQuery(queryParams, 50, 100);
    const versions = workflowRepository.listWorkflowVersions(workflowId, userId, { limit, offset });
    return response(200, {
      count: versions.length,
      limit,
      offset,
      total: workflowRepository.countWorkflowVersions(workflowId, userId),
      versions,
    });
  }

  function getWorkflowVersion(userId, workflowId, versionId) {
    const version = workflowRepository.getWorkflowVersionForUser(workflowId, versionId, userId);
    if (!version) return workflowVersionNotFound();
    return response(200, { version });
  }

  function restoreWorkflowVersion(userId, workflowId, versionId, context = {}) {
    const workflow = workflowRepository.restoreWorkflowVersion(workflowId, versionId, userId);
    if (!workflow) return workflowVersionNotFound();
    writeWorkflowAuditLog(
      workflowRepository,
      userId,
      'workflow.version_restore',
      workflow.id,
      workflowAuditMetadata(workflow, {
        versionId,
        versionNumber: workflow.metadata?.restoredFromVersionNumber || null,
      }),
      context
    );
    return response(200, { workflow });
  }

  function duplicateWorkflowVersion(userId, workflowId, versionId, context = {}) {
    const version = workflowRepository.getWorkflowVersionForUser(workflowId, versionId, userId);
    if (!version) return workflowVersionNotFound();

    const workflow = workflowRepository.upsertWorkflow({
      description: version.description,
      edges: version.edges,
      id: createId(),
      metadata: {
        ...version.metadata,
        copiedFromVersionId: version.id,
        copiedFromVersionNumber: version.versionNumber,
        copiedFromWorkflowId: workflowId,
      },
      name: `${version.name} v${version.versionNumber} Copy`,
      nodeCount: version.nodeCount,
      nodes: version.nodes,
      userId,
      versionSource: 'duplicate-version',
    });

    writeWorkflowAuditLog(
      workflowRepository,
      userId,
      'workflow.version_duplicate',
      workflow.id,
      workflowAuditMetadata(workflow, {
        copiedFromVersionId: version.id,
        copiedFromVersionNumber: version.versionNumber,
        copiedFromWorkflowId: workflowId,
      }),
      context
    );
    return response(201, { workflow });
  }

  function getWorkflow(userId, workflowId) {
    const workflow = workflowRepository.getWorkflowForUser(workflowId, userId);
    if (!workflow) return workflowNotFound();
    return response(200, { workflow });
  }

  function updateWorkflow(userId, workflowId, body = {}, context = {}) {
    const existing = workflowRepository.getWorkflowForUser(workflowId, userId);
    const workflow = workflowRepository.upsertWorkflow(workflowPayload(body, userId, workflowId));
    if (!workflow) return workflowNotFound();
    writeWorkflowAuditLog(
      workflowRepository,
      userId,
      existing ? 'workflow.update' : 'workflow.create',
      workflow.id,
      workflowAuditMetadata(workflow, {
        previousNodeCount: existing?.nodeCount ?? null,
      }),
      context
    );
    return response(200, { workflow });
  }

  function duplicateWorkflow(userId, workflowId, context = {}) {
    const original = workflowRepository.getWorkflowForUser(workflowId, userId);
    if (!original) return workflowNotFound();

    const workflow = workflowRepository.upsertWorkflow({
      ...original,
      createdAt: undefined,
      id: createId(),
      metadata: {
        ...original.metadata,
        copiedFromWorkflowId: original.id,
      },
      name: `${original.name} Copy`,
      updatedAt: new Date().toISOString(),
      userId,
      versionSource: 'duplicate',
    });
    writeWorkflowAuditLog(
      workflowRepository,
      userId,
      'workflow.duplicate',
      workflow.id,
      workflowAuditMetadata(workflow, {
        copiedFromWorkflowId: original.id,
      }),
      context
    );
    return response(201, { workflow });
  }

  function deleteWorkflow(userId, workflowId, context = {}) {
    const existing = workflowRepository.getWorkflowForUser(workflowId, userId);
    const deleted = workflowRepository.deleteWorkflow(workflowId, userId);
    if (!deleted) return workflowNotFound();
    writeWorkflowAuditLog(
      workflowRepository,
      userId,
      'workflow.delete',
      workflowId,
      workflowAuditMetadata(existing),
      context
    );
    return response(200, { ok: true });
  }

  return {
    createWorkflow,
    deleteWorkflow,
    duplicateWorkflow,
    duplicateWorkflowVersion,
    getWorkflow,
    getWorkflowVersion,
    listWorkflowVersions,
    listWorkflows,
    restoreWorkflowVersion,
    updateWorkflow,
  };
}

module.exports = {
  WORKFLOW_PAYLOAD_LIMITS,
  createWorkflowService,
  listQuery,
  normalizeMetadata,
  normalizeWorkflowArray,
  normalizeWorkflowId,
  workflowPayload,
};
