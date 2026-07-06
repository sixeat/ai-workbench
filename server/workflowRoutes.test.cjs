const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-workflow-routes-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const {
  createUser,
  db,
  getWorkflowForUser,
  listAuditLogs,
  listWorkflowVersions,
} = require('./db.cjs');
const {
  WORKFLOW_PAYLOAD_LIMITS,
  registerWorkflowRoutes,
} = require('./routes/workflowRoutes.cjs');

function createFakeApp() {
  const routes = [];
  return {
    routes,
    get(pathname, handler) {
      routes.push({ method: 'GET', pathname, handler });
    },
    post(pathname, handler) {
      routes.push({ method: 'POST', pathname, handler });
    },
    put(pathname, handler) {
      routes.push({ method: 'PUT', pathname, handler });
    },
    delete(pathname, handler) {
      routes.push({ method: 'DELETE', pathname, handler });
    },
  };
}

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function workflowAuditReq(req = {}) {
  return {
    headers: { 'user-agent': 'Workflow Route Audit Browser/1.0' },
    socket: { remoteAddress: '203.0.113.45' },
    ...req,
  };
}

function registerRoutesFor(userId) {
  const app = createFakeApp();
  registerWorkflowRoutes(app, {
    getRequestUserId: () => userId,
  });
  return app;
}

function route(app, method, pathname) {
  return app.routes.find((item) => item.method === method && item.pathname === pathname);
}

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('workflow saves create version snapshots and can restore an older version', () => {
  const user = createUser({
    email: 'workflow-owner@example.com',
    username: 'workflow-owner@example.com',
    name: 'Workflow Owner',
    passwordHash: 'test',
  });
  const app = registerRoutesFor(user.id);
  const createRoute = route(app, 'POST', '/api/workflows');
  const updateRoute = route(app, 'PUT', '/api/workflows/:workflowId');
  const versionsRoute = route(app, 'GET', '/api/workflows/:workflowId/versions');
  const restoreRoute = route(app, 'POST', '/api/workflows/:workflowId/versions/:versionId/restore');

  const createRes = createMockRes();
  createRoute.handler({
    body: {
      id: 'story-workflow',
      name: 'Story Flow',
      nodes: [{ id: 'node-a', type: 'textInput' }],
      edges: [],
      nodeCount: 1,
    },
  }, createRes);

  assert.equal(createRes.statusCode, 201);
  assert.equal(createRes.body.workflow.id, 'story-workflow');

  const updateRes = createMockRes();
  updateRoute.handler({
    params: { workflowId: 'story-workflow' },
    body: {
      name: 'Story Flow v2',
      nodes: [
        { id: 'node-a', type: 'textInput' },
        { id: 'node-b', type: 'imageGen' },
      ],
      edges: [{ id: 'edge-a-b', source: 'node-a', target: 'node-b' }],
      nodeCount: 2,
    },
  }, updateRes);

  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.workflow.nodeCount, 2);

  const versionsRes = createMockRes();
  versionsRoute.handler({
    params: { workflowId: 'story-workflow' },
    query: {},
  }, versionsRes);

  assert.equal(versionsRes.statusCode, 200);
  assert.equal(versionsRes.body.count, 2);
  assert.deepEqual(versionsRes.body.versions.map((version) => version.versionNumber), [2, 1]);

  const firstVersion = versionsRes.body.versions.find((version) => version.versionNumber === 1);
  const restoreRes = createMockRes();
  restoreRoute.handler({
    params: {
      workflowId: 'story-workflow',
      versionId: firstVersion.id,
    },
  }, restoreRes);

  assert.equal(restoreRes.statusCode, 200);
  assert.equal(restoreRes.body.workflow.nodeCount, 1);
  assert.equal(restoreRes.body.workflow.metadata.restoredFromVersionNumber, 1);
  assert.equal(getWorkflowForUser('story-workflow', user.id).nodes.length, 1);

  const afterRestoreVersions = createMockRes();
  versionsRoute.handler({
    params: { workflowId: 'story-workflow' },
    query: {},
  }, afterRestoreVersions);
  assert.equal(afterRestoreVersions.body.count, 3);
  assert.equal(afterRestoreVersions.body.versions[0].source, 'restore');
});

test('workflow versions are isolated by user id', () => {
  const owner = createUser({
    email: 'workflow-version-owner@example.com',
    username: 'workflow-version-owner@example.com',
    name: 'Workflow Version Owner',
    passwordHash: 'test',
  });
  const other = createUser({
    email: 'workflow-version-other@example.com',
    username: 'workflow-version-other@example.com',
    name: 'Workflow Version Other',
    passwordHash: 'test',
  });
  const ownerApp = registerRoutesFor(owner.id);
  const otherApp = registerRoutesFor(other.id);

  route(ownerApp, 'POST', '/api/workflows').handler({
    body: {
      id: 'private-workflow',
      name: 'Private Flow',
      nodes: [{ id: 'private-node' }],
      edges: [],
    },
  }, createMockRes());

  const ownerVersionsRes = createMockRes();
  route(ownerApp, 'GET', '/api/workflows/:workflowId/versions').handler({
    params: { workflowId: 'private-workflow' },
    query: {},
  }, ownerVersionsRes);
  const ownerVersion = ownerVersionsRes.body.versions[0];
  assert.ok(ownerVersion);

  const res = createMockRes();
  route(otherApp, 'GET', '/api/workflows/:workflowId/versions').handler({
    params: { workflowId: 'private-workflow' },
    query: {},
  }, res);

  assert.equal(res.statusCode, 404);

  const versionDetailRes = createMockRes();
  route(otherApp, 'GET', '/api/workflows/:workflowId/versions/:versionId').handler({
    params: {
      workflowId: 'private-workflow',
      versionId: ownerVersion.id,
    },
  }, versionDetailRes);
  assert.equal(versionDetailRes.statusCode, 404);

  const restoreRes = createMockRes();
  route(otherApp, 'POST', '/api/workflows/:workflowId/versions/:versionId/restore').handler({
    params: {
      workflowId: 'private-workflow',
      versionId: ownerVersion.id,
    },
  }, restoreRes);
  assert.equal(restoreRes.statusCode, 404);
  assert.equal(getWorkflowForUser('private-workflow', owner.id).nodes[0].id, 'private-node');
});

test('workflow version list route supports pagination and totals', () => {
  const owner = createUser({
    email: 'workflow-version-page-owner@example.com',
    username: 'workflow-version-page-owner@example.com',
    name: 'Workflow Version Page Owner',
    passwordHash: 'test',
  });
  const other = createUser({
    email: 'workflow-version-page-other@example.com',
    username: 'workflow-version-page-other@example.com',
    name: 'Workflow Version Page Other',
    passwordHash: 'test',
  });
  const ownerApp = registerRoutesFor(owner.id);
  const otherApp = registerRoutesFor(other.id);
  const createRoute = route(ownerApp, 'POST', '/api/workflows');
  const updateRoute = route(ownerApp, 'PUT', '/api/workflows/:workflowId');
  const versionsRoute = route(ownerApp, 'GET', '/api/workflows/:workflowId/versions');
  const otherVersionsRoute = route(otherApp, 'GET', '/api/workflows/:workflowId/versions');

  createRoute.handler({
    body: {
      id: 'version-page-workflow',
      name: 'Version Page Flow',
      nodes: [{ id: 'node-a' }],
      edges: [],
    },
  }, createMockRes());

  for (const index of [2, 3, 4]) {
    const res = createMockRes();
    updateRoute.handler({
      params: { workflowId: 'version-page-workflow' },
      body: {
        name: `Version Page Flow v${index}`,
        nodes: Array.from({ length: index }, (_item, nodeIndex) => ({ id: `node-${nodeIndex + 1}` })),
        edges: [],
      },
    }, res);
    assert.equal(res.statusCode, 200);
  }

  const firstPageRes = createMockRes();
  versionsRoute.handler({
    params: { workflowId: 'version-page-workflow' },
    query: { limit: 2, offset: 0 },
  }, firstPageRes);

  assert.equal(firstPageRes.statusCode, 200);
  assert.equal(firstPageRes.body.count, 2);
  assert.equal(firstPageRes.body.total, 4);
  assert.equal(firstPageRes.body.limit, 2);
  assert.equal(firstPageRes.body.offset, 0);
  assert.deepEqual(firstPageRes.body.versions.map((version) => version.versionNumber), [4, 3]);

  const secondPageRes = createMockRes();
  versionsRoute.handler({
    params: { workflowId: 'version-page-workflow' },
    query: { limit: 2, offset: 2 },
  }, secondPageRes);

  assert.equal(secondPageRes.statusCode, 200);
  assert.equal(secondPageRes.body.count, 2);
  assert.equal(secondPageRes.body.total, 4);
  assert.equal(secondPageRes.body.offset, 2);
  assert.deepEqual(secondPageRes.body.versions.map((version) => version.versionNumber), [2, 1]);

  const deniedRes = createMockRes();
  otherVersionsRoute.handler({
    params: { workflowId: 'version-page-workflow' },
    query: { limit: 2, offset: 0 },
  }, deniedRes);
  assert.equal(deniedRes.statusCode, 404);
});

test('workflow list route supports pagination, search, and user isolation', () => {
  const owner = createUser({
    email: 'workflow-list-owner@example.com',
    username: 'workflow-list-owner@example.com',
    name: 'Workflow List Owner',
    passwordHash: 'test',
  });
  const other = createUser({
    email: 'workflow-list-other@example.com',
    username: 'workflow-list-other@example.com',
    name: 'Workflow List Other',
    passwordHash: 'test',
  });
  const ownerApp = registerRoutesFor(owner.id);
  const otherApp = registerRoutesFor(other.id);
  const ownerCreateRoute = route(ownerApp, 'POST', '/api/workflows');
  const otherCreateRoute = route(otherApp, 'POST', '/api/workflows');
  const ownerListRoute = route(ownerApp, 'GET', '/api/workflows');
  const otherListRoute = route(otherApp, 'GET', '/api/workflows');

  for (const workflow of [
    { id: 'workflow-list-character', name: 'Character Rig Template' },
    { id: 'workflow-list-scene', name: 'Scene Layout Template' },
    { id: 'workflow-list-product', name: 'Product Ad Template' },
  ]) {
    const res = createMockRes();
    ownerCreateRoute.handler({
      body: {
        ...workflow,
        description: 'Reusable workflow template',
        nodes: [{ id: `${workflow.id}-node` }],
        edges: [],
      },
    }, res);
    assert.equal(res.statusCode, 201);
  }

  otherCreateRoute.handler({
    body: {
      id: 'workflow-list-other-scene',
      name: 'Scene Template From Other User',
      nodes: [],
      edges: [],
    },
  }, createMockRes());

  const firstPageRes = createMockRes();
  ownerListRoute.handler({
    query: { limit: 2, offset: 0 },
  }, firstPageRes);
  assert.equal(firstPageRes.statusCode, 200);
  assert.equal(firstPageRes.body.count, 2);
  assert.equal(firstPageRes.body.total, 3);
  assert.equal(firstPageRes.body.limit, 2);
  assert.equal(firstPageRes.body.offset, 0);
  assert.equal(firstPageRes.body.workflows.some((workflow) => workflow.id === 'workflow-list-other-scene'), false);

  const secondPageRes = createMockRes();
  ownerListRoute.handler({
    query: { limit: 2, offset: 2 },
  }, secondPageRes);
  assert.equal(secondPageRes.body.count, 1);
  assert.equal(secondPageRes.body.total, 3);
  assert.equal(secondPageRes.body.offset, 2);

  const ownerSearchRes = createMockRes();
  ownerListRoute.handler({
    query: { search: 'scene', limit: 10, offset: 0 },
  }, ownerSearchRes);
  assert.equal(ownerSearchRes.body.count, 1);
  assert.equal(ownerSearchRes.body.total, 1);
  assert.equal(ownerSearchRes.body.workflows[0].id, 'workflow-list-scene');

  const otherSearchRes = createMockRes();
  otherListRoute.handler({
    query: { search: 'scene', limit: 10, offset: 0 },
  }, otherSearchRes);
  assert.equal(otherSearchRes.body.count, 1);
  assert.equal(otherSearchRes.body.total, 1);
  assert.equal(otherSearchRes.body.workflows[0].id, 'workflow-list-other-scene');
});

test('workflow CRUD and duplication stay isolated by user id', () => {
  const owner = createUser({
    email: 'workflow-crud-owner@example.com',
    username: 'workflow-crud-owner@example.com',
    name: 'Workflow CRUD Owner',
    passwordHash: 'test',
  });
  const other = createUser({
    email: 'workflow-crud-other@example.com',
    username: 'workflow-crud-other@example.com',
    name: 'Workflow CRUD Other',
    passwordHash: 'test',
  });
  const ownerApp = registerRoutesFor(owner.id);
  const otherApp = registerRoutesFor(other.id);

  const createRes = createMockRes();
  route(ownerApp, 'POST', '/api/workflows').handler({
    body: {
      id: 'crud-private-workflow',
      name: 'Private Template',
      nodes: [{ id: 'node-a', type: 'textInput' }],
      edges: [],
      metadata: { category: 'template' },
      nodeCount: 1,
    },
  }, createRes);
  assert.equal(createRes.statusCode, 201);

  const otherListRes = createMockRes();
  route(otherApp, 'GET', '/api/workflows').handler({ query: {} }, otherListRes);
  assert.equal(otherListRes.statusCode, 200);
  assert.deepEqual(otherListRes.body.workflows.map((workflow) => workflow.id), []);

  const otherGetRes = createMockRes();
  route(otherApp, 'GET', '/api/workflows/:workflowId').handler({
    params: { workflowId: 'crud-private-workflow' },
  }, otherGetRes);
  assert.equal(otherGetRes.statusCode, 404);

  const otherUpdateRes = createMockRes();
  route(otherApp, 'PUT', '/api/workflows/:workflowId').handler({
    params: { workflowId: 'crud-private-workflow' },
    body: {
      name: 'Hijacked Template',
      nodes: [{ id: 'evil-node' }],
      edges: [],
    },
  }, otherUpdateRes);
  assert.equal(otherUpdateRes.statusCode, 404);
  assert.equal(getWorkflowForUser('crud-private-workflow', owner.id).name, 'Private Template');

  const otherDuplicateRes = createMockRes();
  route(otherApp, 'POST', '/api/workflows/:workflowId/duplicate').handler({
    params: { workflowId: 'crud-private-workflow' },
  }, otherDuplicateRes);
  assert.equal(otherDuplicateRes.statusCode, 404);

  const otherDeleteRes = createMockRes();
  route(otherApp, 'DELETE', '/api/workflows/:workflowId').handler({
    params: { workflowId: 'crud-private-workflow' },
  }, otherDeleteRes);
  assert.equal(otherDeleteRes.statusCode, 404);
  assert.ok(getWorkflowForUser('crud-private-workflow', owner.id));

  const conflictingCreateRes = createMockRes();
  route(otherApp, 'POST', '/api/workflows').handler({
    body: {
      id: 'crud-private-workflow',
      name: 'Conflicting Template',
      nodes: [],
      edges: [],
    },
  }, conflictingCreateRes);
  assert.equal(conflictingCreateRes.statusCode, 409);
  assert.equal(getWorkflowForUser('crud-private-workflow', owner.id).name, 'Private Template');
  assert.equal(getWorkflowForUser('crud-private-workflow', other.id), null);

  const ownerDuplicateRes = createMockRes();
  route(ownerApp, 'POST', '/api/workflows/:workflowId/duplicate').handler({
    params: { workflowId: 'crud-private-workflow' },
  }, ownerDuplicateRes);
  assert.equal(ownerDuplicateRes.statusCode, 201);
  assert.notEqual(ownerDuplicateRes.body.workflow.id, 'crud-private-workflow');
  assert.equal(ownerDuplicateRes.body.workflow.name, 'Private Template Copy');
  assert.equal(ownerDuplicateRes.body.workflow.metadata.category, 'template');
  assert.equal(ownerDuplicateRes.body.workflow.metadata.copiedFromWorkflowId, 'crud-private-workflow');
  assert.equal(getWorkflowForUser(ownerDuplicateRes.body.workflow.id, other.id), null);

  const ownerDeleteRes = createMockRes();
  route(ownerApp, 'DELETE', '/api/workflows/:workflowId').handler({
    params: { workflowId: 'crud-private-workflow' },
  }, ownerDeleteRes);
  assert.equal(ownerDeleteRes.statusCode, 200);
  assert.equal(getWorkflowForUser('crud-private-workflow', owner.id), null);
});

test('workflow mutating routes write safe audit logs with request context', () => {
  const owner = createUser({
    email: 'workflow-route-audit-owner@example.com',
    username: 'workflow-route-audit-owner@example.com',
    name: 'Workflow Route Audit Owner',
    passwordHash: 'test',
  });
  const app = registerRoutesFor(owner.id);

  const createRes = createMockRes();
  route(app, 'POST', '/api/workflows').handler(workflowAuditReq({
    body: {
      id: 'route-audit-workflow',
      name: 'Route Audit Flow',
      nodes: [{ id: 'node-a', type: 'textInput' }],
      edges: [],
    },
  }), createRes);
  assert.equal(createRes.statusCode, 201);

  const updateRes = createMockRes();
  route(app, 'PUT', '/api/workflows/:workflowId').handler(workflowAuditReq({
    params: { workflowId: 'route-audit-workflow' },
    body: {
      name: 'Route Audit Flow v2',
      nodes: [
        { id: 'node-a', type: 'textInput' },
        { id: 'node-b', type: 'preview' },
      ],
      edges: [{ id: 'edge-a-b', source: 'node-a', target: 'node-b' }],
    },
  }), updateRes);
  assert.equal(updateRes.statusCode, 200);

  const versions = listWorkflowVersions('route-audit-workflow', owner.id);
  const firstVersion = versions.find((version) => version.versionNumber === 1);
  assert.ok(firstVersion);

  const restoreRes = createMockRes();
  route(app, 'POST', '/api/workflows/:workflowId/versions/:versionId/restore').handler(workflowAuditReq({
    params: {
      workflowId: 'route-audit-workflow',
      versionId: firstVersion.id,
    },
  }), restoreRes);
  assert.equal(restoreRes.statusCode, 200);

  const duplicateVersionRes = createMockRes();
  route(app, 'POST', '/api/workflows/:workflowId/versions/:versionId/duplicate').handler(workflowAuditReq({
    params: {
      workflowId: 'route-audit-workflow',
      versionId: firstVersion.id,
    },
  }), duplicateVersionRes);
  assert.equal(duplicateVersionRes.statusCode, 201);

  const duplicateRes = createMockRes();
  route(app, 'POST', '/api/workflows/:workflowId/duplicate').handler(workflowAuditReq({
    params: { workflowId: 'route-audit-workflow' },
  }), duplicateRes);
  assert.equal(duplicateRes.statusCode, 201);

  const deleteRes = createMockRes();
  route(app, 'DELETE', '/api/workflows/:workflowId').handler(workflowAuditReq({
    params: { workflowId: 'route-audit-workflow' },
  }), deleteRes);
  assert.equal(deleteRes.statusCode, 200);

  const auditLogs = listAuditLogs({
    actorUserId: owner.id,
    limit: 20,
    targetType: 'workflow',
  });
  const auditActions = auditLogs.map((log) => log.action).sort();

  assert.deepEqual(auditActions, [
    'workflow.create',
    'workflow.delete',
    'workflow.duplicate',
    'workflow.update',
    'workflow.version_duplicate',
    'workflow.version_restore',
  ].sort());
  assert.equal(auditLogs.every((log) => log.actorUserId === owner.id), true);
  assert.equal(auditLogs.every((log) => log.ipAddress === '203.0.113.45'), true);
  assert.equal(auditLogs.every((log) => log.userAgent === 'Workflow Route Audit Browser/1.0'), true);
  assert.equal(JSON.stringify(auditLogs).includes('"nodes"'), false);
  assert.equal(JSON.stringify(auditLogs).includes('"edges"'), false);

  const logsByAction = new Map(auditLogs.map((log) => [log.action, log]));
  assert.equal(logsByAction.get('workflow.create').metadata.nodeCount, 1);
  assert.equal(logsByAction.get('workflow.update').metadata.previousNodeCount, 1);
  assert.equal(logsByAction.get('workflow.version_restore').metadata.versionNumber, 1);
  assert.equal(logsByAction.get('workflow.version_duplicate').metadata.copiedFromVersionId, firstVersion.id);
  assert.equal(logsByAction.get('workflow.delete').targetId, 'route-audit-workflow');
});

test('workflow version can be duplicated into a new workflow with user isolation', () => {
  const owner = createUser({
    email: 'workflow-copy-owner@example.com',
    username: 'workflow-copy-owner@example.com',
    name: 'Workflow Copy Owner',
    passwordHash: 'test',
  });
  const other = createUser({
    email: 'workflow-copy-other@example.com',
    username: 'workflow-copy-other@example.com',
    name: 'Workflow Copy Other',
    passwordHash: 'test',
  });
  const ownerApp = registerRoutesFor(owner.id);
  const otherApp = registerRoutesFor(other.id);
  const createRoute = route(ownerApp, 'POST', '/api/workflows');
  const updateRoute = route(ownerApp, 'PUT', '/api/workflows/:workflowId');
  const versionsRoute = route(ownerApp, 'GET', '/api/workflows/:workflowId/versions');
  const duplicateVersionRoute = route(ownerApp, 'POST', '/api/workflows/:workflowId/versions/:versionId/duplicate');
  const otherDuplicateVersionRoute = route(otherApp, 'POST', '/api/workflows/:workflowId/versions/:versionId/duplicate');

  createRoute.handler({
    body: {
      id: 'version-copy-source',
      name: 'Reusable Flow',
      nodes: [{ id: 'node-a', type: 'textInput' }],
      edges: [],
      metadata: { theme: 'story' },
      nodeCount: 1,
    },
  }, createMockRes());

  updateRoute.handler({
    params: { workflowId: 'version-copy-source' },
    body: {
      name: 'Reusable Flow v2',
      nodes: [
        { id: 'node-a', type: 'textInput' },
        { id: 'node-b', type: 'preview' },
      ],
      edges: [{ id: 'edge-a-b', source: 'node-a', target: 'node-b' }],
      metadata: { theme: 'story', revision: 2 },
      nodeCount: 2,
    },
  }, createMockRes());

  const versionsRes = createMockRes();
  versionsRoute.handler({
    params: { workflowId: 'version-copy-source' },
    query: {},
  }, versionsRes);
  const firstVersion = versionsRes.body.versions.find((version) => version.versionNumber === 1);
  assert.ok(firstVersion);

  const deniedRes = createMockRes();
  otherDuplicateVersionRoute.handler({
    params: {
      workflowId: 'version-copy-source',
      versionId: firstVersion.id,
    },
  }, deniedRes);
  assert.equal(deniedRes.statusCode, 404);

  const duplicateRes = createMockRes();
  duplicateVersionRoute.handler({
    params: {
      workflowId: 'version-copy-source',
      versionId: firstVersion.id,
    },
  }, duplicateRes);

  assert.equal(duplicateRes.statusCode, 201);
  assert.notEqual(duplicateRes.body.workflow.id, 'version-copy-source');
  assert.equal(duplicateRes.body.workflow.name, 'Reusable Flow v1 Copy');
  assert.equal(duplicateRes.body.workflow.nodeCount, 1);
  assert.equal(duplicateRes.body.workflow.nodes.length, 1);
  assert.equal(duplicateRes.body.workflow.edges.length, 0);
  assert.equal(duplicateRes.body.workflow.metadata.theme, 'story');
  assert.equal(duplicateRes.body.workflow.metadata.copiedFromWorkflowId, 'version-copy-source');
  assert.equal(duplicateRes.body.workflow.metadata.copiedFromVersionId, firstVersion.id);
  assert.equal(duplicateRes.body.workflow.metadata.copiedFromVersionNumber, 1);

  const savedCopy = getWorkflowForUser(duplicateRes.body.workflow.id, owner.id);
  assert.equal(savedCopy.nodes.length, 1);
  assert.equal(getWorkflowForUser(duplicateRes.body.workflow.id, other.id), null);

  const copyVersions = listWorkflowVersions(duplicateRes.body.workflow.id, owner.id);
  assert.equal(copyVersions.length, 1);
  assert.equal(copyVersions[0].source, 'duplicate-version');
});

test('workflow save rejects oversized node and edge lists before writing', () => {
  const owner = createUser({
    email: 'workflow-limit-owner@example.com',
    username: 'workflow-limit-owner@example.com',
    name: 'Workflow Limit Owner',
    passwordHash: 'test',
  });
  const app = registerRoutesFor(owner.id);
  const createRoute = route(app, 'POST', '/api/workflows');

  const tooManyNodesRes = createMockRes();
  createRoute.handler({
    body: {
      id: 'workflow-too-many-nodes',
      name: 'Too Many Nodes',
      nodes: Array.from({ length: WORKFLOW_PAYLOAD_LIMITS.maxNodes + 1 }, (_item, index) => ({ id: `node-${index}` })),
      edges: [],
    },
  }, tooManyNodesRes);

  assert.equal(tooManyNodesRes.statusCode, 413);
  assert.match(tooManyNodesRes.body.error, /nodes can include at most/i);
  assert.equal(getWorkflowForUser('workflow-too-many-nodes', owner.id), null);

  const tooManyEdgesRes = createMockRes();
  createRoute.handler({
    body: {
      id: 'workflow-too-many-edges',
      name: 'Too Many Edges',
      nodes: [],
      edges: Array.from({ length: WORKFLOW_PAYLOAD_LIMITS.maxEdges + 1 }, (_item, index) => ({
        id: `edge-${index}`,
        source: 'node-a',
        target: 'node-b',
      })),
    },
  }, tooManyEdgesRes);

  assert.equal(tooManyEdgesRes.statusCode, 413);
  assert.match(tooManyEdgesRes.body.error, /edges can include at most/i);
  assert.equal(getWorkflowForUser('workflow-too-many-edges', owner.id), null);
});

test('workflow save validates metadata shape and size', () => {
  const owner = createUser({
    email: 'workflow-metadata-owner@example.com',
    username: 'workflow-metadata-owner@example.com',
    name: 'Workflow Metadata Owner',
    passwordHash: 'test',
  });
  const app = registerRoutesFor(owner.id);
  const createRoute = route(app, 'POST', '/api/workflows');

  const invalidShapeRes = createMockRes();
  createRoute.handler({
    body: {
      id: 'workflow-array-metadata',
      name: 'Array Metadata',
      nodes: [],
      edges: [],
      metadata: ['not', 'an', 'object'],
    },
  }, invalidShapeRes);

  assert.equal(invalidShapeRes.statusCode, 400);
  assert.match(invalidShapeRes.body.error, /metadata must be an object/i);
  assert.equal(getWorkflowForUser('workflow-array-metadata', owner.id), null);

  const oversizedRes = createMockRes();
  createRoute.handler({
    body: {
      id: 'workflow-oversized-metadata',
      name: 'Oversized Metadata',
      nodes: [],
      edges: [],
      metadata: {
        notes: 'x'.repeat(WORKFLOW_PAYLOAD_LIMITS.maxMetadataBytes + 1),
      },
    },
  }, oversizedRes);

  assert.equal(oversizedRes.statusCode, 413);
  assert.match(oversizedRes.body.error, /metadata can include at most/i);
  assert.equal(getWorkflowForUser('workflow-oversized-metadata', owner.id), null);
});

test('workflow save derives nodeCount from nodes instead of trusting client input', () => {
  const owner = createUser({
    email: 'workflow-node-count-owner@example.com',
    username: 'workflow-node-count-owner@example.com',
    name: 'Workflow Node Count Owner',
    passwordHash: 'test',
  });
  const app = registerRoutesFor(owner.id);
  const createRoute = route(app, 'POST', '/api/workflows');
  const res = createMockRes();

  createRoute.handler({
    body: {
      id: 'workflow-derived-node-count',
      name: 'Derived Node Count',
      nodes: [
        { id: 'node-a' },
        { id: 'node-b' },
      ],
      edges: [],
      nodeCount: 999999,
    },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.workflow.nodeCount, 2);
  assert.equal(getWorkflowForUser('workflow-derived-node-count', owner.id).nodeCount, 2);
});
