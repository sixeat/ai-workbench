import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAllAssetCollections } from './assetCollectionCache';
import type { ProxyAssetCollection, ProxyAssetCollectionListResponse } from './apiProxy';

function collection(id: string): ProxyAssetCollection {
  return {
    id,
    userId: 'user',
    name: id,
    category: 'character',
    assets: [],
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
  };
}

test('loadAllAssetCollections follows server pagination until total is covered', async () => {
  const calls: Array<{ limit?: number; offset?: number }> = [];
  const pages: Record<number, ProxyAssetCollectionListResponse> = {
    0: {
      collections: [collection('collection-1'), collection('collection-2')],
      count: 2,
      total: 3,
      limit: 2,
      offset: 0,
    },
    2: {
      collections: [collection('collection-3')],
      count: 1,
      total: 3,
      limit: 2,
      offset: 2,
    },
  };

  const collections = await loadAllAssetCollections(async (options) => {
    calls.push(options);
    return pages[Number(options.offset || 0)];
  });

  assert.deepEqual(collections.map((item) => item.id), ['collection-1', 'collection-2', 'collection-3']);
  assert.deepEqual(calls, [
    { limit: 500, offset: 0 },
    { limit: 500, offset: 2 },
  ]);
});

test('loadAllAssetCollections de-duplicates overlapping pages', async () => {
  const collections = await loadAllAssetCollections(async (options) => {
    if (Number(options.offset || 0) === 0) {
      return {
        collections: [collection('collection-a'), collection('collection-b')],
        count: 2,
        total: 3,
        limit: 2,
        offset: 0,
      };
    }

    return {
      collections: [collection('collection-b'), collection('collection-c')],
      count: 2,
      total: 3,
      limit: 2,
      offset: 2,
    };
  });

  assert.deepEqual(collections.map((item) => item.id), ['collection-a', 'collection-b', 'collection-c']);
});
