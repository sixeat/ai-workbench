const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-asset-collections-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const {
  addAssetToCollection,
  createAssetCollection,
  createUser,
  db,
  getAssetCollectionForUser,
  insertAsset,
  listCollectionAssets,
  listAssetCollections,
} = require('./db.cjs');
const {
  ASSET_COLLECTION_LIMITS,
  registerAssetRoutes,
} = require('./routes/assetRoutes.cjs');

function createFakeApp() {
  const routes = [];
  return {
    routes,
    get(pathname, ...handlers) {
      routes.push({ method: 'GET', pathname, handlers });
    },
    post(pathname, ...handlers) {
      routes.push({ method: 'POST', pathname, handlers });
    },
    patch(pathname, ...handlers) {
      routes.push({ method: 'PATCH', pathname, handlers });
    },
    delete(pathname, ...handlers) {
      routes.push({ method: 'DELETE', pathname, handlers });
    },
  };
}

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
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

function createRoutes() {
  const app = createFakeApp();
  registerAssetRoutes(app, {
    assetStorage: {
      exists: () => true,
      read: () => ({ pipe: () => {} }),
    },
    assertOpenLocationAllowed: () => {},
    deploymentMode: 'server',
    getRequestUserId: (req) => req.userId,
    openLocationEnabled: false,
    outputDir: tempDir,
    publicAsset: (asset) => asset,
    safeImageMimeTypes: new Set(['image/png']),
    uploadLimits: {},
  });
  return app.routes;
}

function route(routes, method, pathname) {
  return routes.find((item) => item.method === method && item.pathname === pathname);
}

function runRoute(routeItem, req, res) {
  let index = 0;
  function next() {
    const handler = routeItem.handlers[index];
    index += 1;
    if (handler) return handler(req, res, next);
    return undefined;
  }
  return next();
}

function seedAsset(id, userId) {
  return insertAsset({
    id,
    userId,
    type: 'image',
    storageDriver: 'local-fs',
    url: `/api/assets/${id}`,
    legacyUrl: `/api/images/${id}`,
    fileName: `${id}.png`,
    filePath: path.join(tempDir, `${id}.png`),
    mime: 'image/png',
    metadata: {},
  });
}

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('asset collection routes keep collection membership isolated by user', () => {
  const alice = createUser({
    email: 'asset-alice@example.com',
    username: 'asset-alice@example.com',
    name: 'Asset Alice',
    passwordHash: 'test',
  });
  const bob = createUser({
    email: 'asset-bob@example.com',
    username: 'asset-bob@example.com',
    name: 'Asset Bob',
    passwordHash: 'test',
  });
  const aliceAsset = seedAsset('asset-alice-owned', alice.id);
  const bobAsset = seedAsset('asset-bob-owned', bob.id);
  const aliceCollection = createAssetCollection({
    userId: alice.id,
    name: 'Alice collection',
  });
  const bobCollection = createAssetCollection({
    userId: bob.id,
    name: 'Bob collection',
  });
  const routes = createRoutes();
  const addRoute = route(routes, 'POST', '/api/asset-collections/:collectionId/assets');
  const removeRoute = route(routes, 'DELETE', '/api/asset-collections/:collectionId/assets/:assetId');

  const aliceAddRes = createMockRes();
  runRoute(addRoute, {
    userId: alice.id,
    params: { collectionId: aliceCollection.id },
    body: { assetId: aliceAsset.id, role: '角色正面', note: 'Alice owns both sides.' },
  }, aliceAddRes);

  assert.equal(aliceAddRes.statusCode, 201);
  assert.equal(listCollectionAssets(aliceCollection.id, alice.id).length, 1);

  const bobAddsAliceAssetRes = createMockRes();
  runRoute(addRoute, {
    userId: bob.id,
    params: { collectionId: bobCollection.id },
    body: { assetId: aliceAsset.id, role: '非法引用' },
  }, bobAddsAliceAssetRes);

  assert.equal(bobAddsAliceAssetRes.statusCode, 404);
  assert.equal(listCollectionAssets(bobCollection.id, bob.id).length, 0);

  const bobAddsToAliceCollectionRes = createMockRes();
  runRoute(addRoute, {
    userId: bob.id,
    params: { collectionId: aliceCollection.id },
    body: { assetId: bobAsset.id, role: '非法写入' },
  }, bobAddsToAliceCollectionRes);

  assert.equal(bobAddsToAliceCollectionRes.statusCode, 404);
  assert.equal(listCollectionAssets(aliceCollection.id, alice.id).length, 1);

  const bobRemoveAliceAssetRes = createMockRes();
  runRoute(removeRoute, {
    userId: bob.id,
    params: { collectionId: aliceCollection.id, assetId: aliceAsset.id },
  }, bobRemoveAliceAssetRes);

  assert.equal(bobRemoveAliceAssetRes.statusCode, 404);
  assert.equal(listCollectionAssets(aliceCollection.id, alice.id).length, 1);
});

test('asset collection list route supports pagination, search, and user isolation', () => {
  const alice = createUser({
    email: 'asset-list-alice@example.com',
    username: 'asset-list-alice@example.com',
    name: 'Asset List Alice',
    passwordHash: 'test',
  });
  const bob = createUser({
    email: 'asset-list-bob@example.com',
    username: 'asset-list-bob@example.com',
    name: 'Asset List Bob',
    passwordHash: 'test',
  });

  createAssetCollection({ userId: alice.id, name: '角色集合 A', category: 'character', description: 'front view' });
  createAssetCollection({ userId: alice.id, name: '场景集合 B', category: 'scene', description: 'rain street' });
  createAssetCollection({ userId: alice.id, name: '产品集合 C', category: 'product', description: 'drink bottle' });
  createAssetCollection({ userId: bob.id, name: '角色集合 Bob', category: 'character', description: 'private' });

  const routes = createRoutes();
  const listRoute = route(routes, 'GET', '/api/asset-collections');

  const firstPageRes = createMockRes();
  runRoute(listRoute, {
    userId: alice.id,
    query: { limit: '2', offset: '0' },
  }, firstPageRes);

  assert.equal(firstPageRes.statusCode, 200);
  assert.equal(firstPageRes.body.total, 3);
  assert.equal(firstPageRes.body.count, 3);
  assert.equal(firstPageRes.body.limit, 2);
  assert.equal(firstPageRes.body.offset, 0);
  assert.equal(firstPageRes.body.collections.length, 2);
  assert.ok(firstPageRes.body.collections.every((collection) => collection.userId === alice.id));

  const searchRes = createMockRes();
  runRoute(listRoute, {
    userId: alice.id,
    query: { limit: '10', offset: '0', search: '场景' },
  }, searchRes);

  assert.equal(searchRes.statusCode, 200);
  assert.equal(searchRes.body.total, 1);
  assert.deepEqual(searchRes.body.collections.map((collection) => collection.name), ['场景集合 B']);

  const bobSearchRes = createMockRes();
  runRoute(listRoute, {
    userId: bob.id,
    query: { limit: '10', offset: '0', search: '角色' },
  }, bobSearchRes);

  assert.equal(bobSearchRes.statusCode, 200);
  assert.equal(bobSearchRes.body.total, 1);
  assert.deepEqual(bobSearchRes.body.collections.map((collection) => collection.name), ['角色集合 Bob']);
});

test('asset collection create and update reject invalid or oversized fields', () => {
  const alice = createUser({
    email: 'asset-boundary-alice@example.com',
    username: 'asset-boundary-alice@example.com',
    name: 'Asset Boundary Alice',
    passwordHash: 'test',
  });
  const routes = createRoutes();
  const createRoute = route(routes, 'POST', '/api/asset-collections');
  const patchRoute = route(routes, 'PATCH', '/api/asset-collections/:collectionId');

  const invalidMetadataRes = createMockRes();
  runRoute(createRoute, {
    userId: alice.id,
    body: {
      name: 'Invalid metadata collection',
      metadata: ['not', 'an', 'object'],
    },
  }, invalidMetadataRes);

  assert.equal(invalidMetadataRes.statusCode, 400);
  assert.match(invalidMetadataRes.body.error, /metadata must be an object/i);

  const oversizedMetadataRes = createMockRes();
  runRoute(createRoute, {
    userId: alice.id,
    body: {
      name: 'Oversized metadata collection',
      metadata: {
        notes: 'x'.repeat(ASSET_COLLECTION_LIMITS.maxMetadataBytes + 1),
      },
    },
  }, oversizedMetadataRes);

  assert.equal(oversizedMetadataRes.statusCode, 413);
  assert.match(oversizedMetadataRes.body.error, /metadata can include at most/i);
  assert.equal(listAssetCollections(alice.id, { search: 'metadata collection' }).length, 0);

  const validCollection = createAssetCollection({
    userId: alice.id,
    name: 'Boundary editable collection',
  });
  const oversizedNameRes = createMockRes();
  runRoute(patchRoute, {
    userId: alice.id,
    params: { collectionId: validCollection.id },
    body: {
      name: 'x'.repeat(ASSET_COLLECTION_LIMITS.maxNameLength + 1),
    },
  }, oversizedNameRes);

  assert.equal(oversizedNameRes.statusCode, 400);
  assert.match(oversizedNameRes.body.error, /name can include at most/i);
  assert.equal(getAssetCollectionForUser(validCollection.id, alice.id).name, 'Boundary editable collection');
});

test('asset collection item role and note are bounded before linking assets', () => {
  const alice = createUser({
    email: 'asset-item-boundary-alice@example.com',
    username: 'asset-item-boundary-alice@example.com',
    name: 'Asset Item Boundary Alice',
    passwordHash: 'test',
  });
  const aliceAsset = seedAsset('asset-item-boundary-owned', alice.id);
  const aliceCollection = createAssetCollection({
    userId: alice.id,
    name: 'Alice item boundary collection',
  });
  const routes = createRoutes();
  const addRoute = route(routes, 'POST', '/api/asset-collections/:collectionId/assets');
  const batchAddRoute = route(routes, 'POST', '/api/asset-collections/:collectionId/assets/batch');

  const oversizedRoleRes = createMockRes();
  runRoute(addRoute, {
    userId: alice.id,
    params: { collectionId: aliceCollection.id },
    body: {
      assetId: aliceAsset.id,
      role: 'x'.repeat(ASSET_COLLECTION_LIMITS.maxRoleLength + 1),
    },
  }, oversizedRoleRes);

  assert.equal(oversizedRoleRes.statusCode, 400);
  assert.match(oversizedRoleRes.body.error, /role can include at most/i);
  assert.equal(listCollectionAssets(aliceCollection.id, alice.id).length, 0);

  const oversizedNoteRes = createMockRes();
  runRoute(batchAddRoute, {
    userId: alice.id,
    params: { collectionId: aliceCollection.id },
    body: {
      assetIds: [aliceAsset.id],
      note: 'x'.repeat(ASSET_COLLECTION_LIMITS.maxNoteLength + 1),
    },
  }, oversizedNoteRes);

  assert.equal(oversizedNoteRes.statusCode, 400);
  assert.match(oversizedNoteRes.body.error, /note can include at most/i);
  assert.equal(listCollectionAssets(aliceCollection.id, alice.id).length, 0);
});

test('asset collection batch add skips invalid assets and stays isolated by user', () => {
  const alice = createUser({
    email: 'asset-batch-alice@example.com',
    username: 'asset-batch-alice@example.com',
    name: 'Asset Batch Alice',
    passwordHash: 'test',
  });
  const bob = createUser({
    email: 'asset-batch-bob@example.com',
    username: 'asset-batch-bob@example.com',
    name: 'Asset Batch Bob',
    passwordHash: 'test',
  });
  const aliceAssetOne = seedAsset('asset-batch-alice-one', alice.id);
  const aliceAssetTwo = seedAsset('asset-batch-alice-two', alice.id);
  const bobAsset = seedAsset('asset-batch-bob-owned', bob.id);
  const aliceCollection = createAssetCollection({
    userId: alice.id,
    name: 'Alice batch collection',
  });
  const bobCollection = createAssetCollection({
    userId: bob.id,
    name: 'Bob batch collection',
  });
  const routes = createRoutes();
  const batchAddRoute = route(routes, 'POST', '/api/asset-collections/:collectionId/assets/batch');

  const aliceBatchRes = createMockRes();
  runRoute(batchAddRoute, {
    userId: alice.id,
    params: { collectionId: aliceCollection.id },
    body: {
      assetIds: [aliceAssetOne.id, 'missing-asset-id', aliceAssetTwo.id],
      role: 'front-view',
      note: 'Batch add valid assets only.',
    },
  }, aliceBatchRes);

  assert.equal(aliceBatchRes.statusCode, 201);
  assert.equal(aliceBatchRes.body.added, 2);
  assert.equal(aliceBatchRes.body.skipped, 1);
  assert.equal(listCollectionAssets(aliceCollection.id, alice.id).length, 2);

  const bobAddsAliceAssetsRes = createMockRes();
  runRoute(batchAddRoute, {
    userId: bob.id,
    params: { collectionId: bobCollection.id },
    body: { assetIds: [aliceAssetOne.id, aliceAssetTwo.id], role: 'illegal-reference' },
  }, bobAddsAliceAssetsRes);

  assert.equal(bobAddsAliceAssetsRes.statusCode, 404);
  assert.equal(listCollectionAssets(bobCollection.id, bob.id).length, 0);

  const bobAddsToAliceCollectionRes = createMockRes();
  runRoute(batchAddRoute, {
    userId: bob.id,
    params: { collectionId: aliceCollection.id },
    body: { assetIds: [bobAsset.id], role: 'illegal-write' },
  }, bobAddsToAliceCollectionRes);

  assert.equal(bobAddsToAliceCollectionRes.statusCode, 404);
  assert.equal(listCollectionAssets(aliceCollection.id, alice.id).length, 2);
});

test('asset collection batch remove and cover updates stay isolated by user', () => {
  const alice = createUser({
    email: 'asset-remove-alice@example.com',
    username: 'asset-remove-alice@example.com',
    name: 'Asset Remove Alice',
    passwordHash: 'test',
  });
  const bob = createUser({
    email: 'asset-remove-bob@example.com',
    username: 'asset-remove-bob@example.com',
    name: 'Asset Remove Bob',
    passwordHash: 'test',
  });
  const aliceAssetOne = seedAsset('asset-remove-alice-one', alice.id);
  const aliceAssetTwo = seedAsset('asset-remove-alice-two', alice.id);
  const bobAsset = seedAsset('asset-remove-bob-owned', bob.id);
  const aliceCollection = createAssetCollection({
    userId: alice.id,
    name: 'Alice removable collection',
  });
  const bobCollection = createAssetCollection({
    userId: bob.id,
    name: 'Bob removable collection',
  });

  addAssetToCollection({ collectionId: aliceCollection.id, assetId: aliceAssetOne.id, userId: alice.id });
  addAssetToCollection({ collectionId: aliceCollection.id, assetId: aliceAssetTwo.id, userId: alice.id });
  addAssetToCollection({ collectionId: bobCollection.id, assetId: bobAsset.id, userId: bob.id });

  const routes = createRoutes();
  const patchRoute = route(routes, 'PATCH', '/api/asset-collections/:collectionId');
  const batchRemoveRoute = route(routes, 'POST', '/api/asset-collections/:collectionId/assets/batch-remove');

  const setCoverRes = createMockRes();
  runRoute(patchRoute, {
    userId: alice.id,
    params: { collectionId: aliceCollection.id },
    body: { coverAssetId: aliceAssetTwo.id },
  }, setCoverRes);

  assert.equal(setCoverRes.statusCode, 200);
  assert.equal(setCoverRes.body.collection.coverAssetId, aliceAssetTwo.id);

  const invalidCoverRes = createMockRes();
  runRoute(patchRoute, {
    userId: alice.id,
    params: { collectionId: aliceCollection.id },
    body: { coverAssetId: bobAsset.id },
  }, invalidCoverRes);

  assert.equal(invalidCoverRes.statusCode, 400);
  assert.equal(getAssetCollectionForUser(aliceCollection.id, alice.id).coverAssetId, aliceAssetTwo.id);

  const bobRemovesAliceAssetsRes = createMockRes();
  runRoute(batchRemoveRoute, {
    userId: bob.id,
    params: { collectionId: aliceCollection.id },
    body: { assetIds: [aliceAssetOne.id, aliceAssetTwo.id] },
  }, bobRemovesAliceAssetsRes);

  assert.equal(bobRemovesAliceAssetsRes.statusCode, 404);
  assert.equal(listCollectionAssets(aliceCollection.id, alice.id).length, 2);

  const aliceRemoveCoverRes = createMockRes();
  runRoute(batchRemoveRoute, {
    userId: alice.id,
    params: { collectionId: aliceCollection.id },
    body: { assetIds: [aliceAssetTwo.id, 'missing-remove-asset'] },
  }, aliceRemoveCoverRes);

  assert.equal(aliceRemoveCoverRes.statusCode, 200);
  assert.equal(aliceRemoveCoverRes.body.removed, 1);
  assert.equal(aliceRemoveCoverRes.body.skipped, 1);
  assert.equal(aliceRemoveCoverRes.body.collection.coverAssetId, aliceAssetOne.id);
  assert.equal(listCollectionAssets(aliceCollection.id, alice.id).length, 1);

  const aliceRemoveLastRes = createMockRes();
  runRoute(batchRemoveRoute, {
    userId: alice.id,
    params: { collectionId: aliceCollection.id },
    body: { assetIds: [aliceAssetOne.id] },
  }, aliceRemoveLastRes);

  assert.equal(aliceRemoveLastRes.statusCode, 200);
  assert.equal(aliceRemoveLastRes.body.collection.coverAssetId, null);
  assert.equal(listCollectionAssets(aliceCollection.id, alice.id).length, 0);
});

test('asset collection reorder route persists order and stays isolated by user', () => {
  const alice = createUser({
    email: 'asset-order-alice@example.com',
    username: 'asset-order-alice@example.com',
    name: 'Asset Order Alice',
    passwordHash: 'test',
  });
  const bob = createUser({
    email: 'asset-order-bob@example.com',
    username: 'asset-order-bob@example.com',
    name: 'Asset Order Bob',
    passwordHash: 'test',
  });
  const aliceAssetOne = seedAsset('asset-order-alice-one', alice.id);
  const aliceAssetTwo = seedAsset('asset-order-alice-two', alice.id);
  const aliceAssetThree = seedAsset('asset-order-alice-three', alice.id);
  const bobAsset = seedAsset('asset-order-bob-owned', bob.id);
  const aliceCollection = createAssetCollection({
    userId: alice.id,
    name: 'Alice ordered collection',
  });
  const bobCollection = createAssetCollection({
    userId: bob.id,
    name: 'Bob ordered collection',
  });

  addAssetToCollection({ collectionId: aliceCollection.id, assetId: aliceAssetOne.id, userId: alice.id });
  addAssetToCollection({ collectionId: aliceCollection.id, assetId: aliceAssetTwo.id, userId: alice.id });
  addAssetToCollection({ collectionId: aliceCollection.id, assetId: aliceAssetThree.id, userId: alice.id });
  addAssetToCollection({ collectionId: bobCollection.id, assetId: bobAsset.id, userId: bob.id });

  const routes = createRoutes();
  const reorderRoute = route(routes, 'POST', '/api/asset-collections/:collectionId/assets/reorder');

  const bobReorderAliceRes = createMockRes();
  runRoute(reorderRoute, {
    userId: bob.id,
    params: { collectionId: aliceCollection.id },
    body: { assetIds: [aliceAssetThree.id, aliceAssetTwo.id, aliceAssetOne.id] },
  }, bobReorderAliceRes);

  assert.equal(bobReorderAliceRes.statusCode, 404);
  assert.deepEqual(
    listCollectionAssets(aliceCollection.id, alice.id).map((asset) => asset.id),
    [aliceAssetOne.id, aliceAssetTwo.id, aliceAssetThree.id]
  );

  const aliceReorderRes = createMockRes();
  runRoute(reorderRoute, {
    userId: alice.id,
    params: { collectionId: aliceCollection.id },
    body: { assetIds: [aliceAssetThree.id, 'missing-order-asset', aliceAssetOne.id] },
  }, aliceReorderRes);

  assert.equal(aliceReorderRes.statusCode, 200);
  assert.equal(aliceReorderRes.body.reordered, 2);
  assert.equal(aliceReorderRes.body.skipped, 1);
  assert.deepEqual(
    listCollectionAssets(aliceCollection.id, alice.id).map((asset) => asset.id),
    [aliceAssetThree.id, aliceAssetOne.id, aliceAssetTwo.id]
  );

  const bobInvalidItemsRes = createMockRes();
  runRoute(reorderRoute, {
    userId: bob.id,
    params: { collectionId: bobCollection.id },
    body: { assetIds: [aliceAssetOne.id] },
  }, bobInvalidItemsRes);

  assert.equal(bobInvalidItemsRes.statusCode, 404);
  assert.deepEqual(
    listCollectionAssets(bobCollection.id, bob.id).map((asset) => asset.id),
    [bobAsset.id]
  );
});

test('asset collection update and delete routes stay isolated by user', () => {
  const alice = createUser({
    email: 'asset-edit-alice@example.com',
    username: 'asset-edit-alice@example.com',
    name: 'Asset Edit Alice',
    passwordHash: 'test',
  });
  const bob = createUser({
    email: 'asset-edit-bob@example.com',
    username: 'asset-edit-bob@example.com',
    name: 'Asset Edit Bob',
    passwordHash: 'test',
  });
  const aliceCollection = createAssetCollection({
    userId: alice.id,
    name: 'Alice original collection',
    description: 'Original description',
    category: 'character',
  });
  const routes = createRoutes();
  const patchRoute = route(routes, 'PATCH', '/api/asset-collections/:collectionId');
  const deleteRoute = route(routes, 'DELETE', '/api/asset-collections/:collectionId');

  const bobPatchRes = createMockRes();
  runRoute(patchRoute, {
    userId: bob.id,
    params: { collectionId: aliceCollection.id },
    body: { name: 'Bob should not rename this' },
  }, bobPatchRes);

  assert.equal(bobPatchRes.statusCode, 404);
  assert.equal(getAssetCollectionForUser(aliceCollection.id, alice.id).name, 'Alice original collection');

  const bobDeleteRes = createMockRes();
  runRoute(deleteRoute, {
    userId: bob.id,
    params: { collectionId: aliceCollection.id },
  }, bobDeleteRes);

  assert.equal(bobDeleteRes.statusCode, 404);
  assert.ok(getAssetCollectionForUser(aliceCollection.id, alice.id));

  const alicePatchRes = createMockRes();
  runRoute(patchRoute, {
    userId: alice.id,
    params: { collectionId: aliceCollection.id },
    body: {
      name: 'Alice renamed collection',
      description: 'Updated description',
      category: 'scene',
      metadata: { suggestedRoles: ['wide shot'] },
    },
  }, alicePatchRes);

  assert.equal(alicePatchRes.statusCode, 200);
  assert.equal(alicePatchRes.body.collection.name, 'Alice renamed collection');
  assert.equal(alicePatchRes.body.collection.category, 'scene');
  assert.deepEqual(alicePatchRes.body.collection.metadata.suggestedRoles, ['wide shot']);

  const aliceDeleteRes = createMockRes();
  runRoute(deleteRoute, {
    userId: alice.id,
    params: { collectionId: aliceCollection.id },
  }, aliceDeleteRes);

  assert.equal(aliceDeleteRes.statusCode, 200);
  assert.equal(getAssetCollectionForUser(aliceCollection.id, alice.id), null);
});
