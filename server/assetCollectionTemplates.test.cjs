const assert = require('node:assert/strict');
const test = require('node:test');

const {
  collectionMetadataForTemplate,
  listAssetCollectionTemplates,
  templateForAssetCollection,
} = require('./assetCollectionTemplates.cjs');

test('asset collection templates include creative production categories', () => {
  const templates = listAssetCollectionTemplates();
  const categories = templates.map((template) => template.category);

  assert.deepEqual(
    ['character', 'scene', 'product', 'reference-group'].every((category) => categories.includes(category)),
    true
  );
});

test('asset collection template metadata provides suggested roles and preserves custom metadata', () => {
  const metadata = collectionMetadataForTemplate('character', { projectId: 'project-1' });

  assert.equal(metadata.template, 'character');
  assert.equal(metadata.projectId, 'project-1');
  assert.equal(metadata.suggestedRoles.includes('三视图'), true);
  assert.equal(metadata.suggestedRoles.includes('正面'), true);
  assert.equal(metadata.suggestedRoles.includes('背面'), true);
});

test('reference group template includes cross-modal reference roles', () => {
  const metadata = collectionMetadataForTemplate('reference-group');

  assert.equal(metadata.suggestedRoles.includes('首帧'), true);
  assert.equal(metadata.suggestedRoles.includes('尾帧'), true);
  assert.equal(metadata.suggestedRoles.includes('角色参考'), true);
  assert.equal(metadata.suggestedRoles.includes('场景参考'), true);
  assert.equal(metadata.suggestedRoles.includes('产品参考'), true);
});

test('unknown asset collection categories fall back to general template metadata', () => {
  const template = templateForAssetCollection('unknown-kind');
  const metadata = collectionMetadataForTemplate('unknown-kind');

  assert.equal(template.category, 'general');
  assert.equal(metadata.template, 'general');
  assert.equal(metadata.suggestedRoles.includes('参考'), true);
});
