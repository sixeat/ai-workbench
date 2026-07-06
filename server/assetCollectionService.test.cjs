const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ASSET_COLLECTION_LIMITS,
  createAssetCollectionService,
} = require('./services/assetCollectionService.cjs');

function createAssetRepository() {
  const assets = new Map();
  const auditLogs = [];
  const collections = new Map();
  const collectionAssets = new Map();

  function collectionItems(collectionId) {
    if (!collectionAssets.has(collectionId)) collectionAssets.set(collectionId, []);
    return collectionAssets.get(collectionId);
  }

  function ownedCollection(collectionId, userId) {
    const collection = collections.get(collectionId);
    return collection?.userId === userId ? collection : null;
  }

  function ownedAsset(assetId, userId) {
    const asset = assets.get(assetId);
    return asset?.userId === userId ? asset : null;
  }

  function publicCollection(collection) {
    return collection ? { ...collection } : null;
  }

  return {
    assets,
    auditLogs,
    collections,
    collectionAssets,
    addAssetToCollection({ collectionId, assetId, userId, role = '', note = '' }) {
      const collection = ownedCollection(collectionId, userId);
      const asset = ownedAsset(assetId, userId);
      if (!collection || !asset) return null;
      const items = collectionItems(collectionId);
      if (!items.some((item) => item.assetId === assetId)) {
        items.push({ assetId, note, role });
      }
      return publicCollection(collection);
    },
    countAssetCollections(userId, query = {}) {
      return this.listAssetCollections(userId, { ...query, limit: 10_000, offset: 0 }).length;
    },
    createAuditLog(log) {
      const saved = {
        id: `audit-${auditLogs.length + 1}`,
        ...log,
      };
      auditLogs.push(saved);
      return saved;
    },
    createAssetCollection(input) {
      const collection = {
        category: 'character',
        coverAssetId: null,
        description: '',
        id: `collection-${collections.size + 1}`,
        metadata: {},
        ...input,
      };
      collections.set(collection.id, collection);
      return publicCollection(collection);
    },
    deleteAssetCollection(collectionId, userId) {
      if (!ownedCollection(collectionId, userId)) return false;
      collections.delete(collectionId);
      collectionAssets.delete(collectionId);
      return true;
    },
    getAssetCollectionForUser(collectionId, userId) {
      return publicCollection(ownedCollection(collectionId, userId));
    },
    listAssetCollections(userId, query = {}) {
      const search = String(query.search || '').toLowerCase();
      const limit = Number(query.limit || 100);
      const offset = Number(query.offset || 0);
      return Array.from(collections.values())
        .filter((collection) => collection.userId === userId)
        .filter((collection) => !search || collection.name.toLowerCase().includes(search))
        .slice(offset, offset + limit)
        .map(publicCollection);
    },
    listCollectionAssets(collectionId, userId) {
      if (!ownedCollection(collectionId, userId)) return [];
      return collectionItems(collectionId)
        .map((item) => ownedAsset(item.assetId, userId))
        .filter(Boolean)
        .map((asset) => ({ ...asset }));
    },
    removeAssetFromCollection(collectionId, assetId, userId) {
      if (!ownedCollection(collectionId, userId)) return false;
      const items = collectionItems(collectionId);
      const index = items.findIndex((item) => item.assetId === assetId);
      if (index < 0) return false;
      items.splice(index, 1);
      return true;
    },
    reorderCollectionAssets({ collectionId, userId, assetIds }) {
      const collection = ownedCollection(collectionId, userId);
      if (!collection) return null;
      const items = collectionItems(collectionId);
      const next = [];
      let reordered = 0;
      for (const assetId of assetIds) {
        const item = items.find((candidate) => candidate.assetId === assetId);
        if (!item) continue;
        next.push(item);
        reordered += 1;
      }
      for (const item of items) {
        if (!next.some((candidate) => candidate.assetId === item.assetId)) next.push(item);
      }
      collectionAssets.set(collectionId, next);
      return {
        collection: publicCollection(collection),
        reordered,
        skipped: assetIds.length - reordered,
      };
    },
    updateAssetCollection(collectionId, userId, patch) {
      const collection = ownedCollection(collectionId, userId);
      if (!collection) return null;
      Object.assign(collection, patch);
      return publicCollection(collection);
    },
  };
}

function seedAsset(repository, id, userId, patch = {}) {
  repository.assets.set(id, {
    fileName: `${id}.png`,
    id,
    type: 'image',
    userId,
    ...patch,
  });
  return repository.assets.get(id);
}

test('asset collection service creates lists and validates metadata', () => {
  const repository = createAssetRepository();
  const service = createAssetCollectionService({
    assetRepository: repository,
    publicAsset: (asset) => ({ id: asset.id, type: asset.type }),
  });

  assert.throws(
    () => service.createCollection('user-1', {
      metadata: { notes: 'x'.repeat(ASSET_COLLECTION_LIMITS.maxMetadataBytes + 1) },
      name: 'Oversized metadata',
    }),
    /metadata can include at most/i
  );

  const collection = service.createCollection('user-1', {
    category: 'character',
    name: 'Main character',
  });
  assert.equal(collection.assets.length, 0);
  assert.equal(collection.category, 'character');

  const page = service.listCollections('user-1', { limit: '10', search: 'main' });
  assert.equal(page.total, 1);
  assert.equal(page.collections[0].name, 'Main character');
});

test('asset collection service adds batch assets and keeps user isolation', () => {
  const repository = createAssetRepository();
  const service = createAssetCollectionService({
    assetRepository: repository,
    publicAsset: (asset) => ({ id: asset.id, type: asset.type }),
  });
  const collection = service.createCollection('user-1', { name: 'References' });
  seedAsset(repository, 'asset-1', 'user-1');
  seedAsset(repository, 'asset-2', 'user-1');
  seedAsset(repository, 'asset-private', 'user-2');

  const result = service.addAssetsBatch('user-1', collection.id, {
    assetIds: ['asset-1', 'asset-2', 'asset-private', 'asset-1'],
    role: 'front',
  });

  assert.equal(result.added, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.collection.assets.map((asset) => asset.id), ['asset-1', 'asset-2']);
});

test('asset collection service refreshes cover after removals and reorders assets', () => {
  const repository = createAssetRepository();
  const service = createAssetCollectionService({
    assetRepository: repository,
    publicAsset: (asset) => ({ id: asset.id, type: asset.type }),
  });
  const collection = service.createCollection('user-1', { name: 'Cover refresh' });
  seedAsset(repository, 'asset-1', 'user-1');
  seedAsset(repository, 'asset-2', 'user-1');
  service.addAssetsBatch('user-1', collection.id, { assetIds: ['asset-1', 'asset-2'] });
  service.updateCollection('user-1', collection.id, { coverAssetId: 'asset-1' });

  const removeResult = service.removeAssetsBatch('user-1', collection.id, { assetIds: ['asset-1', 'missing'] });
  assert.equal(removeResult.removed, 1);
  assert.equal(removeResult.skipped, 1);
  assert.equal(repository.getAssetCollectionForUser(collection.id, 'user-1').coverAssetId, 'asset-2');

  service.addAsset('user-1', collection.id, { assetId: 'asset-1' });
  const reorderResult = service.reorderAssets('user-1', collection.id, { assetIds: ['asset-1', 'asset-2', 'missing'] });
  assert.equal(reorderResult.reordered, 2);
  assert.equal(reorderResult.skipped, 1);
  assert.deepEqual(reorderResult.collection.assets.map((asset) => asset.id), ['asset-1', 'asset-2']);
});

test('asset collection service writes safe audit logs for mutating operations', () => {
  const repository = createAssetRepository();
  const service = createAssetCollectionService({
    assetRepository: repository,
    publicAsset: (asset) => ({ id: asset.id, type: asset.type }),
  });
  const context = {
    actorUserId: 'user-1',
    ipAddress: '198.51.100.77',
    userAgent: 'Collection Audit Browser',
  };

  const collection = service.createCollection('user-1', {
    category: 'character',
    metadata: { notes: 'private metadata should stay out of audit assertions' },
    name: 'Character References',
  }, context);
  seedAsset(repository, 'asset-1', 'user-1');
  seedAsset(repository, 'asset-2', 'user-1');

  service.updateCollection('user-1', collection.id, { name: 'Character References v2' }, context);
  service.addAsset('user-1', collection.id, { assetId: 'asset-1', note: 'private note', role: 'front' }, context);
  service.addAssetsBatch('user-1', collection.id, { assetIds: ['asset-1', 'asset-2'], role: 'side' }, context);
  service.reorderAssets('user-1', collection.id, { assetIds: ['asset-2', 'asset-1'] }, context);
  service.removeAsset('user-1', collection.id, 'asset-1', context);
  service.removeAssetsBatch('user-1', collection.id, { assetIds: ['asset-2'] }, context);
  service.deleteCollection('user-1', collection.id, context);

  assert.deepEqual(repository.auditLogs.map((log) => log.action), [
    'asset_collection.create',
    'asset_collection.update',
    'asset_collection.add_asset',
    'asset_collection.add_assets',
    'asset_collection.reorder_assets',
    'asset_collection.remove_asset',
    'asset_collection.remove_assets',
    'asset_collection.delete',
  ]);
  assert.equal(repository.auditLogs.every((log) => log.actorUserId === 'user-1'), true);
  assert.equal(repository.auditLogs.every((log) => log.ipAddress === '198.51.100.77'), true);
  assert.equal(repository.auditLogs.every((log) => log.userAgent === 'Collection Audit Browser'), true);
  assert.equal(repository.auditLogs.every((log) => log.targetType === 'asset_collection'), true);

  const logsByAction = new Map(repository.auditLogs.map((log) => [log.action, log]));
  assert.equal(logsByAction.get('asset_collection.update').metadata.previousName, 'Character References');
  assert.deepEqual(logsByAction.get('asset_collection.update').metadata.changedFields, ['name']);
  assert.equal(logsByAction.get('asset_collection.add_assets').metadata.added, 2);
  assert.equal(logsByAction.get('asset_collection.remove_assets').metadata.removed, 1);
  assert.equal(JSON.stringify(repository.auditLogs).includes('private note'), false);
  assert.equal(JSON.stringify(repository.auditLogs).includes('private metadata'), false);
});
