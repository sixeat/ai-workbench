const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WORKFLOW_PAYLOAD_LIMITS,
  createWorkflowService,
  listQuery,
  workflowPayload,
} = require('./services/workflowService.cjs');

function createInMemoryWorkflowRepository() {
  const workflows = new Map();
  const versions = new Map();
  const auditLogs = [];
  let nextVersionId = 1;

  function workflowVersions(workflowId, userId) {
    return (versions.get(workflowId) || []).filter((version) => version.userId === userId);
  }

  function createVersion(workflow, source) {
    const existingVersions = versions.get(workflow.id) || [];
    const version = {
      ...workflow,
      id: `version-${nextVersionId++}`,
      source,
      versionNumber: existingVersions.length + 1,
      workflowId: workflow.id,
    };
    versions.set(workflow.id, [...existingVersions, version]);
    return version;
  }

  return {
    auditLogs,
    versions,
    workflows,
    createAuditLog(log) {
      const saved = {
        id: `audit-${auditLogs.length + 1}`,
        createdAt: new Date().toISOString(),
        ...log,
      };
      auditLogs.push(saved);
      return saved;
    },
    countWorkflowVersions(workflowId, userId) {
      return workflowVersions(workflowId, userId).length;
    },
    countWorkflows(userId, query = {}) {
      return this.listWorkflows(userId, { ...query, limit: 10_000, offset: 0 }).length;
    },
    deleteWorkflow(id, userId) {
      const existing = workflows.get(id);
      if (!existing || existing.userId !== userId) return false;
      workflows.delete(id);
      return true;
    },
    getWorkflowForUser(id, userId) {
      const workflow = workflows.get(id);
      return workflow?.userId === userId ? workflow : null;
    },
    getWorkflowVersionForUser(workflowId, versionId, userId) {
      return workflowVersions(workflowId, userId).find((version) => version.id === versionId) || null;
    },
    listWorkflowVersions(workflowId, userId, options = {}) {
      const limit = Number(options.limit || 50);
      const offset = Number(options.offset || 0);
      return workflowVersions(workflowId, userId)
        .sort((a, b) => b.versionNumber - a.versionNumber)
        .slice(offset, offset + limit);
    },
    listWorkflows(userId, options = {}) {
      const limit = Number(options.limit || 100);
      const offset = Number(options.offset || 0);
      const search = String(options.search || '').toLowerCase();
      return Array.from(workflows.values())
        .filter((workflow) => workflow.userId === userId)
        .filter((workflow) => !search || workflow.name.toLowerCase().includes(search))
        .slice(offset, offset + limit);
    },
    restoreWorkflowVersion(workflowId, versionId, userId) {
      const version = this.getWorkflowVersionForUser(workflowId, versionId, userId);
      if (!version) return null;
      return this.upsertWorkflow({
        ...version,
        id: workflowId,
        metadata: {
          ...version.metadata,
          restoredFromVersionId: version.id,
          restoredFromVersionNumber: version.versionNumber,
        },
        userId,
        versionSource: 'restore',
      });
    },
    upsertWorkflow(workflow) {
      const existing = workflows.get(workflow.id);
      if (existing && existing.userId !== workflow.userId) return null;
      const saved = {
        description: '',
        edges: [],
        metadata: {},
        nodes: [],
        ...existing,
        ...workflow,
        nodeCount: Number.isInteger(workflow.nodeCount)
          ? workflow.nodeCount
          : Array.isArray(workflow.nodes) ? workflow.nodes.length : 0,
      };
      workflows.set(saved.id, saved);
      createVersion(saved, workflow.versionSource || (existing ? 'save' : 'create'));
      return saved;
    },
  };
}

test('workflow service query clamps pagination and preserves search alias', () => {
  assert.deepEqual(listQuery({ limit: 999, offset: -5, q: 'scene' }, 100, 200), {
    limit: 200,
    offset: 0,
    search: 'scene',
  });
});

test('workflow payload normalizes safe fields and derives node count', () => {
  const payload = workflowPayload({
    createdAt: '2026-01-01T00:00:00.000Z',
    id: ' workflow-1 ',
    name: '  Demo Flow  ',
    nodeCount: 999,
    nodes: [{ id: 'a' }, { id: 'b' }],
  }, 'user-1');

  assert.equal(payload.id, 'workflow-1');
  assert.equal(payload.name, 'Demo Flow');
  assert.equal(payload.nodeCount, 2);
  assert.equal(payload.createdAt, '2026-01-01T00:00:00.000Z');
});

test('workflow payload rejects invalid arrays and oversized metadata before writing', () => {
  assert.throws(
    () => workflowPayload({ nodes: 'bad' }, 'user-1'),
    /nodes must be an array/
  );
  assert.throws(
    () => workflowPayload({
      edges: Array.from({ length: WORKFLOW_PAYLOAD_LIMITS.maxEdges + 1 }, () => ({})),
    }, 'user-1'),
    /edges can include at most/
  );
  assert.throws(
    () => workflowPayload({ metadata: ['bad'] }, 'user-1'),
    /metadata must be an object/
  );
});

test('workflow service creates, lists, updates, and deletes workflows', () => {
  const repository = createInMemoryWorkflowRepository();
  const service = createWorkflowService({ workflowRepository: repository });

  const created = service.createWorkflow('user-1', {
    id: 'workflow-1',
    name: 'Scene Flow',
    nodes: [{ id: 'node-1' }],
  });
  const updated = service.updateWorkflow('user-1', 'workflow-1', {
    name: 'Scene Flow v2',
    nodes: [{ id: 'node-1' }, { id: 'node-2' }],
  });
  const listed = service.listWorkflows('user-1', { search: 'scene' });
  const deleted = service.deleteWorkflow('user-1', 'workflow-1');

  assert.equal(created.status, 201);
  assert.equal(updated.status, 200);
  assert.equal(updated.data.workflow.nodeCount, 2);
  assert.equal(listed.data.total, 1);
  assert.equal(deleted.status, 200);
  assert.equal(repository.getWorkflowForUser('workflow-1', 'user-1'), null);
});

test('workflow service keeps workflow ids isolated by user', () => {
  const repository = createInMemoryWorkflowRepository();
  const service = createWorkflowService({ workflowRepository: repository });

  service.createWorkflow('owner', { id: 'shared-id', name: 'Owner Flow' });
  const conflicting = service.createWorkflow('other', { id: 'shared-id', name: 'Other Flow' });
  const otherGet = service.getWorkflow('other', 'shared-id');

  assert.equal(conflicting.status, 409);
  assert.equal(otherGet.status, 404);
  assert.equal(repository.getWorkflowForUser('shared-id', 'owner').name, 'Owner Flow');
});

test('workflow service restores and duplicates workflow versions', () => {
  const repository = createInMemoryWorkflowRepository();
  const service = createWorkflowService({
    createId: () => 'copy-id',
    workflowRepository: repository,
  });

  service.createWorkflow('user-1', {
    id: 'versioned',
    name: 'Versioned Flow',
    nodes: [{ id: 'node-1' }],
    metadata: { theme: 'story' },
  });
  service.updateWorkflow('user-1', 'versioned', {
    name: 'Versioned Flow v2',
    nodes: [{ id: 'node-1' }, { id: 'node-2' }],
    metadata: { theme: 'story', revision: 2 },
  });

  const versions = service.listWorkflowVersions('user-1', 'versioned', {});
  const firstVersion = versions.data.versions.find((version) => version.versionNumber === 1);
  const restored = service.restoreWorkflowVersion('user-1', 'versioned', firstVersion.id);
  const duplicated = service.duplicateWorkflowVersion('user-1', 'versioned', firstVersion.id);

  assert.equal(restored.status, 200);
  assert.equal(restored.data.workflow.nodeCount, 1);
  assert.equal(restored.data.workflow.metadata.restoredFromVersionNumber, 1);
  assert.equal(duplicated.status, 201);
  assert.equal(duplicated.data.workflow.id, 'copy-id');
  assert.equal(duplicated.data.workflow.name, 'Versioned Flow v1 Copy');
  assert.equal(duplicated.data.workflow.metadata.copiedFromVersionNumber, 1);
});

test('workflow service duplicates current workflow metadata safely', () => {
  const repository = createInMemoryWorkflowRepository();
  const service = createWorkflowService({
    createId: () => 'workflow-copy',
    workflowRepository: repository,
  });

  service.createWorkflow('user-1', {
    id: 'source',
    metadata: { category: 'template' },
    name: 'Source Flow',
  });
  const duplicated = service.duplicateWorkflow('user-1', 'source');

  assert.equal(duplicated.status, 201);
  assert.equal(duplicated.data.workflow.id, 'workflow-copy');
  assert.equal(duplicated.data.workflow.name, 'Source Flow Copy');
  assert.deepEqual(duplicated.data.workflow.metadata, {
    category: 'template',
    copiedFromWorkflowId: 'source',
  });
});

test('workflow service writes safe audit logs for mutating operations', () => {
  const repository = createInMemoryWorkflowRepository();
  const service = createWorkflowService({
    createId: (() => {
      let count = 0;
      return () => `audit-copy-${++count}`;
    })(),
    workflowRepository: repository,
  });
  const context = {
    actorUserId: 'user-1',
    ipAddress: '198.51.100.10',
    userAgent: 'Workflow Audit Browser',
  };

  service.createWorkflow('user-1', {
    id: 'audit-flow',
    name: 'Audit Flow',
    nodes: [{ id: 'node-1' }],
  }, context);
  service.updateWorkflow('user-1', 'audit-flow', {
    name: 'Audit Flow v2',
    nodes: [{ id: 'node-1' }, { id: 'node-2' }],
  }, context);

  const versions = service.listWorkflowVersions('user-1', 'audit-flow', {}).data.versions;
  const firstVersion = versions.find((version) => version.versionNumber === 1);
  service.restoreWorkflowVersion('user-1', 'audit-flow', firstVersion.id, context);
  service.duplicateWorkflowVersion('user-1', 'audit-flow', firstVersion.id, context);
  service.duplicateWorkflow('user-1', 'audit-flow', context);
  service.deleteWorkflow('user-1', 'audit-flow', context);

  assert.deepEqual(repository.auditLogs.map((log) => log.action), [
    'workflow.create',
    'workflow.update',
    'workflow.version_restore',
    'workflow.version_duplicate',
    'workflow.duplicate',
    'workflow.delete',
  ]);
  assert.equal(repository.auditLogs.every((log) => log.actorUserId === 'user-1'), true);
  assert.equal(repository.auditLogs.every((log) => log.ipAddress === '198.51.100.10'), true);
  assert.equal(repository.auditLogs.every((log) => log.userAgent === 'Workflow Audit Browser'), true);
  assert.equal(repository.auditLogs.every((log) => log.targetType === 'workflow'), true);
  assert.equal(JSON.stringify(repository.auditLogs).includes('"nodes"'), false);
  assert.equal(repository.auditLogs[1].metadata.previousNodeCount, 1);
  assert.equal(repository.auditLogs[2].metadata.versionNumber, 1);
  assert.equal(repository.auditLogs[3].metadata.copiedFromVersionId, firstVersion.id);
});
