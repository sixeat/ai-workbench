import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAllModelCapabilities } from './modelCapabilityCache';
import type { ProxyModelCapabilities, ProxyModelCapabilityListResponse } from './apiProxy';

function capability(id: string): ProxyModelCapabilities {
  return {
    id,
    providerId: 'test-provider',
    modelPattern: `${id}-*`,
    capabilities: {},
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
  };
}

test('loadAllModelCapabilities follows server pagination until total is covered', async () => {
  const calls: Array<{ limit?: number; offset?: number }> = [];
  const pages: Record<number, ProxyModelCapabilityListResponse> = {
    0: {
      capabilities: [capability('cap-1'), capability('cap-2')],
      count: 2,
      total: 3,
      limit: 2,
      offset: 0,
    },
    2: {
      capabilities: [capability('cap-3')],
      count: 1,
      total: 3,
      limit: 2,
      offset: 2,
    },
  };

  const records = await loadAllModelCapabilities(async (options) => {
    calls.push(options);
    return pages[Number(options.offset || 0)];
  });

  assert.deepEqual(records.map((record) => record.id), ['cap-1', 'cap-2', 'cap-3']);
  assert.deepEqual(calls, [
    { limit: 500, offset: 0 },
    { limit: 500, offset: 2 },
  ]);
});

test('loadAllModelCapabilities de-duplicates overlapping pages', async () => {
  const records = await loadAllModelCapabilities(async (options) => {
    if (Number(options.offset || 0) === 0) {
      return {
        capabilities: [capability('cap-a'), capability('cap-b')],
        count: 2,
        total: 3,
        limit: 2,
        offset: 0,
      };
    }

    return {
      capabilities: [capability('cap-b'), capability('cap-c')],
      count: 2,
      total: 3,
      limit: 2,
      offset: 2,
    };
  });

  assert.deepEqual(records.map((record) => record.id), ['cap-a', 'cap-b', 'cap-c']);
});
