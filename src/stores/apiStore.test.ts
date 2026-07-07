import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

function installLocalStorage() {
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorage,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  });
  return storage;
}

const storage = installLocalStorage();
const { getInstanceRuntimeConfig, useApiStore } = await import('./apiStore');

function resetApiStore() {
  storage.clear();
  useApiStore.setState({ instances: {}, deploymentMode: 'local' });
}

beforeEach(() => {
  resetApiStore();
});

test('local API keys stay in memory and are not persisted to localStorage', () => {
  const id = useApiStore.getState().addInstance({
    name: 'Local OpenAI',
    providerId: 'openai-compatible',
    apiKey: 'sk-local-secret',
    baseUrl: 'https://api.example.com',
    customHeaders: {},
    models: ['gpt-test'],
    modelFetchMode: 'manual',
    isEnabled: true,
  });

  const instance = useApiStore.getState().instances[id];
  assert.equal(instance.apiKey, '');
  assert.equal(getInstanceRuntimeConfig(id)?.apiKey, 'sk-local-secret');
  assert.equal(JSON.stringify(JSON.parse(storage.get('ai-workbench-api-v2') || '{}')).includes('sk-local-secret'), false);
});

test('server deployment mode clears local browser API instances and blocks new local keys', () => {
  const id = useApiStore.getState().addInstance({
    name: 'Local OpenAI',
    providerId: 'openai-compatible',
    apiKey: 'sk-local-secret',
    baseUrl: 'https://api.example.com',
    customHeaders: {},
    models: ['gpt-test'],
    modelFetchMode: 'manual',
    isEnabled: true,
  });
  assert.ok(useApiStore.getState().instances[id]);

  useApiStore.getState().setDeploymentMode('server');

  assert.equal(useApiStore.getState().deploymentMode, 'server');
  assert.deepEqual(Object.keys(useApiStore.getState().instances), []);
  assert.equal(getInstanceRuntimeConfig(id), null);

  const blockedId = useApiStore.getState().addInstance({
    name: 'Blocked Local Key',
    providerId: 'openai-compatible',
    apiKey: 'sk-should-not-save',
    baseUrl: 'https://api.example.com',
    customHeaders: {},
    models: ['gpt-test'],
    modelFetchMode: 'manual',
    isEnabled: true,
  });

  assert.equal(blockedId, '');
  assert.deepEqual(Object.keys(useApiStore.getState().instances), []);
});

test('backend user key instances keep only apiKeyId and never store raw keys', () => {
  useApiStore.getState().setDeploymentMode('server');
  useApiStore.getState().syncServerKeyInstances([
    {
      id: 'key-1',
      ownerUserId: 'user-1',
      keyScope: 'user',
      providerId: 'openai-compatible',
      name: 'User Key',
      baseUrl: 'https://api.example.com',
      isEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ]);

  const instance = useApiStore.getState().instances['user:key-1'];
  assert.equal(instance.apiKey, '');
  assert.equal(instance.apiKeyId, 'key-1');
  assert.equal(getInstanceRuntimeConfig('user:key-1')?.apiKey, '');
  assert.equal(getInstanceRuntimeConfig('user:key-1')?.apiKeyId, 'key-1');
  assert.equal(JSON.stringify(useApiStore.getState().instances).includes('sk-'), false);
});

test('paginated backend user key sync ignores server keys and keeps missing user keys by default', () => {
  useApiStore.getState().setDeploymentMode('server');
  useApiStore.getState().syncServerKeyInstances([
    {
      id: 'key-a',
      ownerUserId: 'user-1',
      keyScope: 'user',
      providerId: 'openai-compatible',
      name: 'User Key A',
      baseUrl: 'https://api-a.example.com',
      isEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'key-b',
      ownerUserId: 'user-1',
      keyScope: 'user',
      providerId: 'seedance',
      name: 'User Key B',
      baseUrl: 'https://api-b.example.com',
      isEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ], { replaceMissing: true });

  useApiStore.getState().syncServerKeyInstances([
    {
      id: 'key-b',
      ownerUserId: 'user-1',
      keyScope: 'user',
      providerId: 'seedance',
      name: 'User Key B Updated',
      baseUrl: 'https://api-b.example.com',
      isEnabled: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    },
    {
      id: 'server-key',
      ownerUserId: 'local-user',
      keyScope: 'server',
      providerId: 'openai-compatible',
      name: 'Hidden Server Key',
      baseUrl: 'https://server.example.com',
      isEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    },
  ]);

  assert.ok(useApiStore.getState().instances['user:key-a']);
  assert.equal(useApiStore.getState().instances['user:key-b'].name, 'User Key B Updated');
  assert.equal(useApiStore.getState().instances['user:key-b'].isEnabled, false);
  assert.equal(useApiStore.getState().instances['server:server-key'], undefined);
});

test('backend server keys never become workbench API instances', () => {
  useApiStore.getState().setDeploymentMode('server');
  useApiStore.getState().syncServerKeyInstances([
    {
      id: 'server-only-key',
      ownerUserId: 'local-user',
      keyScope: 'server',
      providerId: 'openai-compatible',
      name: 'Platform Secret Key',
      baseUrl: 'https://server.example.com',
      isEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    },
  ], { replaceMissing: true });

  assert.deepEqual(useApiStore.getState().instances, {});
});
