import {
  proxyDeleteWorkflow,
  proxyDuplicateWorkflow,
  proxyDuplicateWorkflowVersion,
  proxyListWorkflowVersions,
  proxyListWorkflows,
  proxyRestoreWorkflowVersion,
  proxySaveWorkflow,
  type ProxyWorkflowListOptions,
  type ProxyWorkflowVersion,
  type ProxyWorkflowVersionListOptions,
} from '../lib/apiProxy';

const DB_NAME = 'ai-workbench-workflows';
const DB_VERSION = 1;
const STORE_NAME = 'workflows';

export interface WorkflowProject {
  id: string;
  name: string;
  description: string;
  nodes: any[];
  edges: any[];
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  metadata?: Record<string, any>;
}

export type WorkflowStorageLocation = 'remote' | 'local';

export interface WorkflowMutationResult {
  storage: WorkflowStorageLocation;
  fallbackReason?: string;
}

export type WorkflowListOptions = ProxyWorkflowListOptions;

export interface WorkflowListPage {
  workflows: WorkflowProject[];
  count: number;
  total: number;
  limit: number;
  offset: number;
  storage: WorkflowStorageLocation;
}

export type WorkflowVersionListOptions = ProxyWorkflowVersionListOptions;

export interface WorkflowVersionListPage {
  versions: ProxyWorkflowVersion[];
  count: number;
  total: number;
  limit: number;
  offset: number;
  storage: WorkflowStorageLocation;
}

type WorkflowListResult = WorkflowProject[] | Omit<WorkflowListPage, 'storage'>;

interface WorkflowRemoteApi {
  list: (options?: WorkflowListOptions) => Promise<WorkflowListResult>;
  save: (project: WorkflowProject) => Promise<void>;
  delete: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<WorkflowProject>;
  duplicateVersion: (id: string, versionId: string) => Promise<WorkflowProject>;
  listVersions: (id: string, options?: WorkflowVersionListOptions) => Promise<ProxyWorkflowVersion[] | Omit<WorkflowVersionListPage, 'storage'>>;
  restoreVersion: (id: string, versionId: string) => Promise<WorkflowProject>;
}

interface WorkflowLocalStore {
  canUse: () => boolean;
  list: () => Promise<WorkflowProject[]>;
  get: (id: string) => Promise<WorkflowProject | null>;
  save: (project: WorkflowProject) => Promise<void>;
  delete: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<WorkflowProject>;
}

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

function shouldUseLocalFallback(error: unknown): boolean {
  if (!localWorkflowStore.canUse()) return false;
  const message = errorMessage(error);
  return message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('Load failed');
}

function workflowMatchesSearch(workflow: WorkflowProject, query: string): boolean {
  if (!query) return true;
  return [
    workflow.id,
    workflow.name,
    workflow.description,
  ].some((value) => String(value || '').toLowerCase().includes(query));
}

function normalizeWorkflowListOptions(options: WorkflowListOptions = {}) {
  return {
    limit: Number.isFinite(Number(options.limit)) && Number(options.limit) > 0 ? Number(options.limit) : 100,
    offset: Number.isFinite(Number(options.offset)) && Number(options.offset) > 0 ? Number(options.offset) : 0,
    search: String(options.search || '').trim().toLowerCase(),
  };
}

function normalizeWorkflowVersionListOptions(options: WorkflowVersionListOptions = {}) {
  return {
    limit: Number.isFinite(Number(options.limit)) && Number(options.limit) > 0 ? Number(options.limit) : 50,
    offset: Number.isFinite(Number(options.offset)) && Number(options.offset) > 0 ? Number(options.offset) : 0,
  };
}

function paginateLocalWorkflows(workflows: WorkflowProject[], options: WorkflowListOptions = {}): WorkflowListPage {
  const query = normalizeWorkflowListOptions(options);
  const filtered = workflows.filter((workflow) => workflowMatchesSearch(workflow, query.search));
  const page = filtered.slice(query.offset, query.offset + query.limit);
  return {
    workflows: page,
    count: page.length,
    total: filtered.length,
    limit: query.limit,
    offset: query.offset,
    storage: 'local',
  };
}

function normalizeWorkflowListResult(result: WorkflowListResult, options: WorkflowListOptions = {}): WorkflowListPage {
  const query = normalizeWorkflowListOptions(options);
  if (Array.isArray(result)) {
    return {
      workflows: result,
      count: result.length,
      total: result.length,
      limit: query.limit,
      offset: query.offset,
      storage: 'remote',
    };
  }

  return {
    workflows: result.workflows,
    count: result.count ?? result.workflows.length,
    total: result.total ?? result.count ?? result.workflows.length,
    limit: result.limit ?? query.limit,
    offset: result.offset ?? query.offset,
    storage: 'remote',
  };
}

function normalizeWorkflowVersionListResult(
  result: ProxyWorkflowVersion[] | Omit<WorkflowVersionListPage, 'storage'>,
  options: WorkflowVersionListOptions = {}
): WorkflowVersionListPage {
  const query = normalizeWorkflowVersionListOptions(options);
  if (Array.isArray(result)) {
    return {
      versions: result,
      count: result.length,
      total: result.length,
      limit: query.limit,
      offset: query.offset,
      storage: 'remote',
    };
  }

  return {
    versions: result.versions,
    count: result.count ?? result.versions.length,
    total: result.total ?? result.count ?? result.versions.length,
    limit: result.limit ?? query.limit,
    offset: result.offset ?? query.offset,
    storage: 'remote',
  };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
  });
}

async function getAllLocalWorkflows(): Promise<WorkflowProject[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const results = request.result as WorkflowProject[];
      resolve(results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
    };
    request.onerror = () => reject(request.error);
  });
}

async function getLocalWorkflow(id: string): Promise<WorkflowProject | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function saveLocalWorkflow(project: WorkflowProject): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(project);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function deleteLocalWorkflow(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function duplicateLocalWorkflow(id: string): Promise<WorkflowProject> {
  const original = await getLocalWorkflow(id);
  if (!original) throw new Error('Workflow not found');
  const now = new Date().toISOString();
  const duplicated: WorkflowProject = {
    ...original,
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    name: `${original.name} Copy`,
    createdAt: now,
    updatedAt: now,
  };
  await saveLocalWorkflow(duplicated);
  return duplicated;
}

const defaultRemoteWorkflowApi: WorkflowRemoteApi = {
  async list(options) {
    const data = await proxyListWorkflows(options);
    return {
      workflows: data.workflows,
      count: data.count,
      total: data.total ?? data.count,
      limit: data.limit ?? normalizeWorkflowListOptions(options).limit,
      offset: data.offset ?? normalizeWorkflowListOptions(options).offset,
    };
  },
  async save(project) {
    await proxySaveWorkflow(project);
  },
  async delete(id) {
    await proxyDeleteWorkflow(id);
  },
  async duplicate(id) {
    const data = await proxyDuplicateWorkflow(id);
    return data.workflow;
  },
  async duplicateVersion(id, versionId) {
    const data = await proxyDuplicateWorkflowVersion(id, versionId);
    return data.workflow;
  },
  async listVersions(id, options) {
    const data = await proxyListWorkflowVersions(id, options);
    return {
      versions: data.versions,
      count: data.count,
      total: data.total ?? data.count,
      limit: data.limit ?? normalizeWorkflowVersionListOptions(options).limit,
      offset: data.offset ?? normalizeWorkflowVersionListOptions(options).offset,
    };
  },
  async restoreVersion(id, versionId) {
    const data = await proxyRestoreWorkflowVersion(id, versionId);
    return data.workflow;
  },
};

const indexedDbWorkflowStore: WorkflowLocalStore = {
  canUse: canUseIndexedDb,
  list: getAllLocalWorkflows,
  get: getLocalWorkflow,
  save: saveLocalWorkflow,
  delete: deleteLocalWorkflow,
  duplicate: duplicateLocalWorkflow,
};

let remoteWorkflowApi = defaultRemoteWorkflowApi;
let localWorkflowStore = indexedDbWorkflowStore;

export function configureWorkflowDbAdaptersForTests(options: {
  remoteApi?: Partial<WorkflowRemoteApi>;
  localStore?: Partial<WorkflowLocalStore>;
} = {}): () => void {
  const previousRemoteApi = remoteWorkflowApi;
  const previousLocalStore = localWorkflowStore;
  remoteWorkflowApi = { ...defaultRemoteWorkflowApi, ...options.remoteApi };
  localWorkflowStore = { ...indexedDbWorkflowStore, ...options.localStore };
  return () => {
    remoteWorkflowApi = previousRemoteApi;
    localWorkflowStore = previousLocalStore;
  };
}

export async function getAllWorkflows(): Promise<WorkflowProject[]> {
  const page = await listWorkflowPage();
  return page.workflows;
}

export async function listWorkflowPage(options: WorkflowListOptions = {}): Promise<WorkflowListPage> {
  try {
    return normalizeWorkflowListResult(await remoteWorkflowApi.list(options), options);
  } catch (error) {
    if (shouldUseLocalFallback(error)) return paginateLocalWorkflows(await localWorkflowStore.list(), options);
    throw error;
  }
}

export async function getWorkflow(id: string): Promise<WorkflowProject | null> {
  try {
    const workflows = (await listWorkflowPage({ limit: 500 })).workflows;
    return workflows.find((workflow) => workflow.id === id) || null;
  } catch (error) {
    if (shouldUseLocalFallback(error)) return localWorkflowStore.get(id);
    throw error;
  }
}

export async function saveWorkflow(project: WorkflowProject): Promise<WorkflowMutationResult> {
  try {
    await remoteWorkflowApi.save(project);
    return { storage: 'remote' };
  } catch (error) {
    if (shouldUseLocalFallback(error)) {
      await localWorkflowStore.save(project);
      return { storage: 'local', fallbackReason: errorMessage(error) };
    }
    throw error;
  }
}

export async function deleteWorkflow(id: string): Promise<WorkflowMutationResult> {
  try {
    await remoteWorkflowApi.delete(id);
    return { storage: 'remote' };
  } catch (error) {
    if (shouldUseLocalFallback(error)) {
      await localWorkflowStore.delete(id);
      return { storage: 'local', fallbackReason: errorMessage(error) };
    }
    throw error;
  }
}

export async function duplicateWorkflow(id: string): Promise<WorkflowProject> {
  try {
    return await remoteWorkflowApi.duplicate(id);
  } catch (error) {
    if (shouldUseLocalFallback(error)) return localWorkflowStore.duplicate(id);
    throw error;
  }
}

export async function duplicateWorkflowVersion(id: string, versionId: string): Promise<WorkflowProject> {
  try {
    return await remoteWorkflowApi.duplicateVersion(id, versionId);
  } catch (error) {
    if (shouldUseLocalFallback(error)) {
      throw new Error('离线模式暂不支持复制历史版本。');
    }
    throw error;
  }
}

export async function getWorkflowVersions(id: string): Promise<ProxyWorkflowVersion[]> {
  const page = await getWorkflowVersionPage(id);
  return page.versions;
}

export async function getWorkflowVersionPage(
  id: string,
  options: WorkflowVersionListOptions = {}
): Promise<WorkflowVersionListPage> {
  try {
    return normalizeWorkflowVersionListResult(await remoteWorkflowApi.listVersions(id, options), options);
  } catch (error) {
    if (shouldUseLocalFallback(error)) {
      const query = normalizeWorkflowVersionListOptions(options);
      return {
        versions: [],
        count: 0,
        total: 0,
        limit: query.limit,
        offset: query.offset,
        storage: 'local',
      };
    }
    throw error;
  }
}

export async function restoreWorkflowVersion(id: string, versionId: string): Promise<WorkflowProject> {
  try {
    return await remoteWorkflowApi.restoreVersion(id, versionId);
  } catch (error) {
    if (shouldUseLocalFallback(error)) {
      throw new Error('离线模式暂不支持版本回滚。');
    }
    throw error;
  }
}

export type { ProxyWorkflowVersion as WorkflowVersion };
