const assert = require('node:assert/strict');
const test = require('node:test');

const { registerWorkflowRoutes } = require('./routes/workflowRoutes.cjs');

function createFakeApp() {
  const routes = [];
  return {
    routes,
    delete(pathname, handler) {
      routes.push({ method: 'DELETE', pathname, handler });
    },
    get(pathname, handler) {
      routes.push({ method: 'GET', pathname, handler });
    },
    post(pathname, handler) {
      routes.push({ method: 'POST', pathname, handler });
    },
    put(pathname, handler) {
      routes.push({ method: 'PUT', pathname, handler });
    },
  };
}

function createMockRes() {
  return {
    body: null,
    statusCode: 200,
    json(body) {
      this.body = body;
      return this;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
  };
}

function createInMemoryWorkflowRepository() {
  const workflows = new Map();
  const versions = new Map();
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
    versions,
    workflows,
    countWorkflowVersions(workflowId, userId) {
      return workflowVersions(workflowId, userId).length;
    },
    countWorkflows(userId) {
      return Array.from(workflows.values()).filter((workflow) => workflow.userId === userId).length;
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
      return Array.from(workflows.values())
        .filter((workflow) => workflow.userId === userId)
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

function route(app, method, pathname) {
  return app.routes.find((item) => item.method === method && item.pathname === pathname);
}

function registerRoutesFor({ repository, userId = 'user-1' }) {
  const app = createFakeApp();
  registerWorkflowRoutes(app, {
    getRequestUserId: () => userId,
    workflowRepository: repository,
  });
  return app;
}

test('workflow routes can create, list, duplicate, and delete through an injected repository', () => {
  const repository = createInMemoryWorkflowRepository();
  const app = registerRoutesFor({ repository });

  const createRes = createMockRes();
  route(app, 'POST', '/api/workflows').handler({
    body: {
      id: 'workflow-1',
      name: 'Injected Workflow',
      nodes: [{ id: 'node-1' }, { id: 'node-2' }],
    },
  }, createRes);

  assert.equal(createRes.statusCode, 201);
  assert.equal(createRes.body.workflow.nodeCount, 2);

  const listRes = createMockRes();
  route(app, 'GET', '/api/workflows').handler({ query: { limit: 10 } }, listRes);

  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.count, 1);
  assert.equal(listRes.body.total, 1);

  const duplicateRes = createMockRes();
  route(app, 'POST', '/api/workflows/:workflowId/duplicate').handler({
    params: { workflowId: 'workflow-1' },
  }, duplicateRes);

  assert.equal(duplicateRes.statusCode, 201);
  assert.notEqual(duplicateRes.body.workflow.id, 'workflow-1');
  assert.equal(duplicateRes.body.workflow.metadata.copiedFromWorkflowId, 'workflow-1');

  const deleteRes = createMockRes();
  route(app, 'DELETE', '/api/workflows/:workflowId').handler({
    params: { workflowId: 'workflow-1' },
  }, deleteRes);

  assert.equal(deleteRes.statusCode, 200);
  assert.equal(deleteRes.body.ok, true);
  assert.equal(repository.getWorkflowForUser('workflow-1', 'user-1'), null);
});

test('workflow version routes use the injected repository for restore', () => {
  const repository = createInMemoryWorkflowRepository();
  const app = registerRoutesFor({ repository });

  route(app, 'POST', '/api/workflows').handler({
    body: {
      id: 'workflow-versions',
      name: 'Versioned Workflow',
      nodes: [{ id: 'node-1' }],
    },
  }, createMockRes());
  route(app, 'PUT', '/api/workflows/:workflowId').handler({
    body: {
      name: 'Versioned Workflow v2',
      nodes: [{ id: 'node-1' }, { id: 'node-2' }],
    },
    params: { workflowId: 'workflow-versions' },
  }, createMockRes());

  const versionsRes = createMockRes();
  route(app, 'GET', '/api/workflows/:workflowId/versions').handler({
    params: { workflowId: 'workflow-versions' },
    query: {},
  }, versionsRes);

  assert.equal(versionsRes.statusCode, 200);
  assert.equal(versionsRes.body.total, 2);

  const firstVersion = versionsRes.body.versions.find((version) => version.versionNumber === 1);
  const restoreRes = createMockRes();
  route(app, 'POST', '/api/workflows/:workflowId/versions/:versionId/restore').handler({
    params: {
      versionId: firstVersion.id,
      workflowId: 'workflow-versions',
    },
  }, restoreRes);

  assert.equal(restoreRes.statusCode, 200);
  assert.equal(restoreRes.body.workflow.nodeCount, 1);
  assert.equal(restoreRes.body.workflow.metadata.restoredFromVersionNumber, 1);
});
