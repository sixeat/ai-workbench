import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configureWorkflowDbAdaptersForTests,
  duplicateWorkflowVersion,
  getAllWorkflows,
  getWorkflowVersionPage,
  listWorkflowPage,
  saveWorkflow,
  type WorkflowProject,
} from './workflowDb';

function makeWorkflow(id: string): WorkflowProject {
  return {
    id,
    name: `Workflow ${id}`,
    description: '',
    nodes: [],
    edges: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodeCount: 0,
  };
}

test('workflow storage prefers the backend API when it is available', async () => {
  const workflow = makeWorkflow('remote');
  let remoteSaveCount = 0;
  let localSaveCount = 0;
  const restoreAdapters = configureWorkflowDbAdaptersForTests({
    remoteApi: {
      list: async () => [workflow],
      save: async () => {
        remoteSaveCount += 1;
      },
    },
    localStore: {
      canUse: () => true,
      save: async () => {
        localSaveCount += 1;
      },
    },
  });

  try {
    assert.deepEqual(await getAllWorkflows(), [workflow]);
    assert.deepEqual(await saveWorkflow(workflow), { storage: 'remote' });
    assert.equal(remoteSaveCount, 1);
    assert.equal(localSaveCount, 0);
  } finally {
    restoreAdapters();
  }
});

test('workflow storage falls back to local storage only for network failures', async () => {
  const workflow = makeWorkflow('local');
  const savedLocally: WorkflowProject[] = [];
  const restoreAdapters = configureWorkflowDbAdaptersForTests({
    remoteApi: {
      list: async () => {
        throw new TypeError('Failed to fetch');
      },
      save: async () => {
        throw new TypeError('Failed to fetch');
      },
    },
    localStore: {
      canUse: () => true,
      list: async () => [workflow],
      save: async (project) => {
        savedLocally.push(project);
      },
    },
  });

  try {
    assert.deepEqual(await getAllWorkflows(), [workflow]);
    const result = await saveWorkflow(workflow);
    assert.equal(result.storage, 'local');
    assert.match(result.fallbackReason || '', /Failed to fetch/);
    assert.deepEqual(savedLocally, [workflow]);
  } finally {
    restoreAdapters();
  }
});

test('workflow storage passes pagination options to the backend API', async () => {
  const workflow = makeWorkflow('remote-page');
  const calls: Array<{ limit?: number; offset?: number; search?: string }> = [];
  const restoreAdapters = configureWorkflowDbAdaptersForTests({
    remoteApi: {
      list: async (options) => {
        calls.push(options || {});
        return {
          workflows: [workflow],
          count: 1,
          total: 3,
          limit: options?.limit || 100,
          offset: options?.offset || 0,
        };
      },
    },
  });

  try {
    const page = await listWorkflowPage({ limit: 1, offset: 2, search: 'story' });
    assert.deepEqual(calls, [{ limit: 1, offset: 2, search: 'story' }]);
    assert.deepEqual(page.workflows, [workflow]);
    assert.equal(page.count, 1);
    assert.equal(page.total, 3);
    assert.equal(page.limit, 1);
    assert.equal(page.offset, 2);
    assert.equal(page.storage, 'remote');
  } finally {
    restoreAdapters();
  }
});

test('workflow storage fallback paginates and searches local workflows', async () => {
  const alpha = { ...makeWorkflow('alpha'), name: 'Alpha Story Flow' };
  const beta = { ...makeWorkflow('beta'), name: 'Beta Product Flow' };
  const gamma = { ...makeWorkflow('gamma'), name: 'Gamma Story Flow' };
  const restoreAdapters = configureWorkflowDbAdaptersForTests({
    remoteApi: {
      list: async () => {
        throw new TypeError('Failed to fetch');
      },
    },
    localStore: {
      canUse: () => true,
      list: async () => [alpha, beta, gamma],
    },
  });

  try {
    const firstPage = await listWorkflowPage({ limit: 1, offset: 0, search: 'story' });
    const secondPage = await listWorkflowPage({ limit: 1, offset: 1, search: 'story' });

    assert.deepEqual(firstPage.workflows.map((workflow) => workflow.id), ['alpha']);
    assert.equal(firstPage.total, 2);
    assert.equal(firstPage.storage, 'local');
    assert.deepEqual(secondPage.workflows.map((workflow) => workflow.id), ['gamma']);
    assert.equal(secondPage.total, 2);
  } finally {
    restoreAdapters();
  }
});

test('workflow storage does not fall back to local storage for auth failures', async () => {
  const workflow = makeWorkflow('auth-error');
  let localSaveCount = 0;
  const restoreAdapters = configureWorkflowDbAdaptersForTests({
    remoteApi: {
      save: async () => {
        throw new Error('Login is required.');
      },
    },
    localStore: {
      canUse: () => true,
      save: async () => {
        localSaveCount += 1;
      },
    },
  });

  try {
    await assert.rejects(() => saveWorkflow(workflow), /Login is required/);
    assert.equal(localSaveCount, 0);
  } finally {
    restoreAdapters();
  }
});

test('workflow version duplication delegates to the backend API', async () => {
  const duplicated = makeWorkflow('duplicated-version');
  const calls: Array<{ workflowId: string; versionId: string }> = [];
  const restoreAdapters = configureWorkflowDbAdaptersForTests({
    remoteApi: {
      duplicateVersion: async (workflowId, versionId) => {
        calls.push({ workflowId, versionId });
        return duplicated;
      },
    },
  });

  try {
    assert.deepEqual(await duplicateWorkflowVersion('source-workflow', 'version-1'), duplicated);
    assert.deepEqual(calls, [{ workflowId: 'source-workflow', versionId: 'version-1' }]);
  } finally {
    restoreAdapters();
  }
});

test('workflow version pagination delegates to the backend API', async () => {
  const calls: Array<{ workflowId: string; limit?: number; offset?: number }> = [];
  const restoreAdapters = configureWorkflowDbAdaptersForTests({
    remoteApi: {
      listVersions: async (workflowId, options) => {
        calls.push({ workflowId, ...options });
        return {
          versions: [
            {
              id: 'version-3',
              workflowId,
              versionNumber: 3,
              name: 'Version 3',
              description: '',
              nodes: [],
              edges: [],
              metadata: {},
              nodeCount: 0,
              source: 'save',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          count: 1,
          total: 5,
          limit: options?.limit || 50,
          offset: options?.offset || 0,
        };
      },
    },
  });

  try {
    const page = await getWorkflowVersionPage('workflow-a', { limit: 1, offset: 2 });
    assert.deepEqual(calls, [{ workflowId: 'workflow-a', limit: 1, offset: 2 }]);
    assert.equal(page.versions[0].id, 'version-3');
    assert.equal(page.count, 1);
    assert.equal(page.total, 5);
    assert.equal(page.limit, 1);
    assert.equal(page.offset, 2);
    assert.equal(page.storage, 'remote');
  } finally {
    restoreAdapters();
  }
});

test('workflow version pagination returns an empty local page on network fallback', async () => {
  const restoreAdapters = configureWorkflowDbAdaptersForTests({
    remoteApi: {
      listVersions: async () => {
        throw new TypeError('Failed to fetch');
      },
    },
    localStore: {
      canUse: () => true,
    },
  });

  try {
    const page = await getWorkflowVersionPage('workflow-offline', { limit: 2, offset: 4 });
    assert.deepEqual(page.versions, []);
    assert.equal(page.count, 0);
    assert.equal(page.total, 0);
    assert.equal(page.limit, 2);
    assert.equal(page.offset, 4);
    assert.equal(page.storage, 'local');
  } finally {
    restoreAdapters();
  }
});
