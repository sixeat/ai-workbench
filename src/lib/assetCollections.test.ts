import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categoryLabel,
  collectionAssetIdSet,
  collectionHasAsset,
  filterAssetsNotInCollection,
  formatAssetLibraryPageSummary,
  formatSuggestedRolesText,
  getSuggestedRoles,
  listAssetCollectionsForLibrary,
  listCollectionLibraryAssets,
  listUngroupedLibraryAssets,
  mergeLibraryAssetPages,
  normalizeSuggestedRoles,
  parseSuggestedRolesText,
  templateFor,
  type CollectionTemplate,
} from './assetCollections';

const remoteTemplates: CollectionTemplate[] = [
  {
    category: 'character',
    label: '远程角色',
    description: '远程角色模板',
    placeholder: '远程角色名称',
    roles: ['正面', '侧面'],
  },
  {
    category: 'general',
    label: '远程通用',
    description: '远程通用模板',
    placeholder: '远程通用名称',
    roles: ['参考'],
  },
];

test('asset collection helpers can use templates returned by the backend', () => {
  assert.equal(templateFor('character', remoteTemplates).placeholder, '远程角色名称');
  assert.equal(categoryLabel('character', remoteTemplates), '远程角色');
  assert.deepEqual(getSuggestedRoles({ category: 'character' }, remoteTemplates), ['正面', '侧面']);
});

test('asset collection helpers fall back to general backend template for unknown categories', () => {
  assert.equal(templateFor('unknown', remoteTemplates).category, 'general');
  assert.equal(categoryLabel('unknown', remoteTemplates), '远程通用');
  assert.deepEqual(getSuggestedRoles({ category: 'unknown' }, remoteTemplates), ['参考']);
});

test('asset collection metadata roles override template roles', () => {
  assert.deepEqual(
    getSuggestedRoles({
      category: 'character',
      metadata: { suggestedRoles: ['首帧', '尾帧'] },
    }, remoteTemplates),
    ['首帧', '尾帧']
  );
});

test('asset collection custom role helpers normalize text input', () => {
  assert.deepEqual(
    parseSuggestedRolesText('正面\n侧面，侧面、背面 / 表情', ['默认']),
    ['正面', '侧面', '背面', '表情']
  );
  assert.deepEqual(parseSuggestedRolesText('  \n ', ['默认']), ['默认']);
  assert.deepEqual(normalizeSuggestedRoles(['正面', '', '正面', '背面']), ['正面', '背面']);
  assert.equal(formatSuggestedRolesText(['正面', '侧面', '正面']), '正面\n侧面');
});

test('asset library helper filters ungrouped assets by search and limit', () => {
  const grouped = { id: 'grouped', fileName: 'front-view.png', model: 'image-model' };
  const face = { id: 'face', fileName: 'face-closeup.png', prompt: 'hero character face' };
  const scene = { id: 'scene', fileName: 'rain-street.png', prompt: 'night street' };
  const collections = [{ assets: [grouped] }];

  assert.deepEqual(
    listUngroupedLibraryAssets(collections, [grouped, face, scene]).map((asset) => asset.id),
    ['face', 'scene']
  );
  assert.deepEqual(
    listUngroupedLibraryAssets(collections, [grouped, face, scene], { search: 'hero' }).map((asset) => asset.id),
    ['face']
  );
  assert.deepEqual(
    listUngroupedLibraryAssets([], [grouped, face, scene], { limit: 2 }).map((asset) => asset.id),
    ['grouped', 'face']
  );
});

test('asset collection membership helpers detect and filter existing assets', () => {
  const collection = {
    assets: [
      { id: 'asset-a' },
      { id: ' ' },
      { id: 'asset-b' },
    ],
  };

  assert.deepEqual([...collectionAssetIdSet(collection)], ['asset-a', 'asset-b']);
  assert.equal(collectionHasAsset(collection, 'asset-a'), true);
  assert.equal(collectionHasAsset(collection, 'asset-c'), false);
  assert.deepEqual(
    filterAssetsNotInCollection([
      { id: 'asset-a', fileName: 'already.png' },
      { id: 'asset-c', fileName: 'new.png' },
      { id: '', fileName: 'missing-id.png' },
    ], collection).map((asset) => asset.id),
    ['asset-c']
  );
});

test('asset library helper filters collection assets by role and search', () => {
  const front = { id: 'front', fileName: 'front-view.png', libraryRole: '正面', prompt: 'hero standing' };
  const face = { id: 'face', fileName: 'face-closeup.png', libraryRole: '脸部特写', prompt: 'hero expression' };
  const scene = { id: 'scene', fileName: 'rain-street.png', libraryRole: '场景参考', libraryNote: 'night street' };

  assert.deepEqual(
    listCollectionLibraryAssets([front, face, scene], { role: '脸部特写' }).map((asset) => asset.id),
    ['face']
  );
  assert.deepEqual(
    listCollectionLibraryAssets([front, face, scene], { search: 'night' }).map((asset) => asset.id),
    ['scene']
  );
  assert.deepEqual(
    listCollectionLibraryAssets([front, face, scene], { role: 'all', search: 'hero' }).map((asset) => asset.id),
    ['front', 'face']
  );
});

test('asset library helper searches collections by category label roles and grouped assets', () => {
  const characterCollection = {
    id: 'collection-character',
    name: '女主 A',
    category: 'character',
    description: '主角素材',
    metadata: { suggestedRoles: ['三视图', '脸部特写'] },
    assets: [
      { id: 'asset-front', fileName: 'front.png', libraryRole: '正面' },
      { id: 'asset-expression', fileName: 'smile.png', libraryRole: '表情', libraryNote: 'wink mood' },
    ],
  };
  const sceneCollection = {
    id: 'collection-scene',
    name: '雨夜街区',
    category: 'scene',
    description: '夜晚街景',
    metadata: {},
    assets: [
      { id: 'asset-street', fileName: 'street.png', libraryRole: '环境' },
    ],
  };

  assert.deepEqual(
    listAssetCollectionsForLibrary([characterCollection, sceneCollection], { search: '角色' }).map((collection) => collection.id),
    ['collection-character']
  );
  assert.deepEqual(
    listAssetCollectionsForLibrary([characterCollection, sceneCollection], { search: '脸部特写' }).map((collection) => collection.id),
    ['collection-character']
  );
  assert.deepEqual(
    listAssetCollectionsForLibrary([characterCollection, sceneCollection], { search: 'wink' }).map((collection) => collection.id),
    ['collection-character']
  );
  assert.deepEqual(
    listAssetCollectionsForLibrary([characterCollection, sceneCollection], { search: '环境' }).map((collection) => collection.id),
    ['collection-scene']
  );
});

test('asset library pagination helpers merge pages and explain loaded counts', () => {
  const merged = mergeLibraryAssetPages(
    [
      { id: 'asset-a', fileName: 'a.png' },
      { id: 'asset-b', fileName: 'b.png' },
    ],
    [
      { id: 'asset-b', fileName: 'b-updated.png' },
      { id: 'asset-c', fileName: 'c.png' },
    ]
  );

  assert.deepEqual(merged.map((asset) => asset.id), ['asset-a', 'asset-b', 'asset-c']);
  assert.equal(merged[1].fileName, 'b.png');
  assert.equal(formatAssetLibraryPageSummary(24, 80, 200), '已加载 80/200 个素材');
  assert.equal(formatAssetLibraryPageSummary(3, 80, 200, '角色'), '3/80 个匹配，已加载 80/200');
  assert.equal(formatAssetLibraryPageSummary(0, 10, 0), '已加载 10/10 个素材');
});
