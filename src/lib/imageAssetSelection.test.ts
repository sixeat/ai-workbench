import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNGROUPED_IMAGE_COLLECTION_ID,
  buildSelectableImageAssetItems,
  isSelectableImageAsset,
  listImageAssetRoles,
  listImageCollectionCategories,
} from './imageAssetSelection';
import type { ProxyAsset, ProxyAssetCollection } from './apiProxy';

function asset(id: string, type: string, fileName: string): ProxyAsset {
  return {
    id,
    type,
    url: `/api/assets/${id}`,
    fileName,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

test('image asset selection keeps image-like assets and excludes videos', () => {
  assert.equal(isSelectableImageAsset(asset('image', 'image', 'portrait.png')), true);
  assert.equal(isSelectableImageAsset(asset('legacy', 'asset', 'reference.webp')), true);
  assert.equal(isSelectableImageAsset(asset('video', 'video', 'clip.mp4')), false);
});

test('image asset selection includes grouped and ungrouped assets without duplicates', () => {
  const grouped = asset('grouped', 'image', 'role-front.png');
  const ungrouped = asset('ungrouped', 'image', 'draft.png');
  const collections: ProxyAssetCollection[] = [
    {
      id: 'character',
      userId: 'user',
      name: '角色 A',
      category: 'character',
      assets: [grouped],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const items = buildSelectableImageAssetItems(collections, [grouped, ungrouped]);
  assert.deepEqual(items.map((item) => item.asset.id), ['grouped', 'ungrouped']);
  assert.equal(items[1].collectionId, UNGROUPED_IMAGE_COLLECTION_ID);
  assert.equal(items[1].grouped, false);
});

test('image asset selection filters by collection and search text', () => {
  const front = asset('front', 'image', 'front-view.png');
  const face = asset('face', 'image', 'face-closeup.png');
  const collections: ProxyAssetCollection[] = [
    {
      id: 'character',
      userId: 'user',
      name: '主角素材',
      category: 'character',
      assets: [front, face],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const items = buildSelectableImageAssetItems(collections, [], { collectionId: 'character', search: 'face' });
  assert.deepEqual(items.map((item) => item.asset.id), ['face']);
});

test('image asset selection filters by category and library role', () => {
  const front = { ...asset('front', 'image', 'front-view.png'), libraryRole: '三视图' };
  const face = { ...asset('face', 'image', 'face-closeup.png'), libraryRole: '脸部特写' };
  const scene = { ...asset('scene', 'image', 'rain-street.png'), libraryRole: '环境' };
  const collections: ProxyAssetCollection[] = [
    {
      id: 'character',
      userId: 'user',
      name: '主角素材',
      category: 'character',
      assets: [front, face],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'scene',
      userId: 'user',
      name: '雨夜街区',
      category: 'scene',
      assets: [scene],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const categoryItems = buildSelectableImageAssetItems(collections, [], { category: 'character' });
  assert.deepEqual(categoryItems.map((item) => item.asset.id), ['front', 'face']);

  const roleItems = buildSelectableImageAssetItems(collections, [], { category: 'character', role: '脸部特写' });
  assert.deepEqual(roleItems.map((item) => item.asset.id), ['face']);
  assert.deepEqual(listImageAssetRoles(categoryItems), ['脸部特写', '三视图']);

  const categories = listImageCollectionCategories(collections);
  assert.deepEqual(categories.map((item) => item.id).sort(), ['character', 'scene']);
});
