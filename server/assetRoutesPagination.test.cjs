const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-asset-routes-pagination-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const {
  createUser,
  db,
  insertAsset,
} = require('./db.cjs');
const { registerAssetRoutes } = require('./routes/assetRoutes.cjs');

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

function createReadableAssetStorage() {
  return {
    existsCount: 0,
    readCount: 0,
    lastReadAssetId: null,
    exists() {
      this.existsCount += 1;
      return true;
    },
    read(asset) {
      this.readCount += 1;
      this.lastReadAssetId = asset.id;
      return {
        pipe(res) {
          res.pipedAssetId = asset.id;
          return res;
        },
      };
    },
  };
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

function seedAsset(id, userId, createdAt) {
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
    createdAt,
    updatedAt: createdAt,
  });
}

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('asset list route returns paginated assets for the current user', () => {
  const owner = createUser({
    email: 'asset-page-owner@example.com',
    username: 'asset-page-owner@example.com',
    name: 'Asset Page Owner',
    passwordHash: 'test',
  });
  const other = createUser({
    email: 'asset-page-other@example.com',
    username: 'asset-page-other@example.com',
    name: 'Asset Page Other',
    passwordHash: 'test',
  });
  seedAsset('asset-page-old', owner.id, '2026-01-01T00:00:01.000Z');
  seedAsset('asset-page-middle', owner.id, '2026-01-01T00:00:02.000Z');
  seedAsset('asset-page-new', owner.id, '2026-01-01T00:00:03.000Z');
  seedAsset('asset-page-other-user', other.id, '2026-01-01T00:00:04.000Z');

  const app = createFakeApp();
  registerAssetRoutes(app, {
    assetStorage: {
      exists: () => true,
      read: () => ({ pipe: () => {} }),
    },
    assertOpenLocationAllowed: () => {},
    deploymentMode: 'server',
    getRequestUserId: () => owner.id,
    openLocationEnabled: false,
    outputDir: tempDir,
    publicAsset: (asset) => asset,
    safeImageMimeTypes: new Set(['image/png']),
    uploadLimits: {},
  });

  const route = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/assets');
  const res = createMockRes();
  runRoute(route, { query: { limit: 2, offset: 1 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 3);
  assert.equal(res.body.total, 3);
  assert.equal(res.body.limit, 2);
  assert.equal(res.body.offset, 1);
  assert.deepEqual(res.body.assets.map((asset) => asset.id), ['asset-page-middle', 'asset-page-old']);
});

test('asset stream route does not read another user asset from storage', () => {
  const owner = createUser({
    email: 'asset-stream-owner@example.com',
    username: 'asset-stream-owner@example.com',
    name: 'Asset Stream Owner',
    passwordHash: 'test',
  });
  const other = createUser({
    email: 'asset-stream-other@example.com',
    username: 'asset-stream-other@example.com',
    name: 'Asset Stream Other',
    passwordHash: 'test',
  });
  seedAsset('asset-stream-private', owner.id, '2026-01-02T00:00:01.000Z');

  const assetStorage = createReadableAssetStorage();
  const app = createFakeApp();
  registerAssetRoutes(app, {
    assetStorage,
    assertOpenLocationAllowed: () => {},
    deploymentMode: 'server',
    getRequestUserId: () => other.id,
    openLocationEnabled: false,
    outputDir: tempDir,
    publicAsset: (asset) => asset,
    safeImageMimeTypes: new Set(['image/png']),
    uploadLimits: {},
  });

  const route = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/assets/:assetId');
  const res = createMockRes();
  runRoute(route, { params: { assetId: 'asset-stream-private' } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Asset not found');
  assert.equal(assetStorage.existsCount, 0);
  assert.equal(assetStorage.readCount, 0);
});

test('legacy image stream route is also isolated by user id', () => {
  const owner = createUser({
    email: 'image-stream-owner@example.com',
    username: 'image-stream-owner@example.com',
    name: 'Image Stream Owner',
    passwordHash: 'test',
  });
  const other = createUser({
    email: 'image-stream-other@example.com',
    username: 'image-stream-other@example.com',
    name: 'Image Stream Other',
    passwordHash: 'test',
  });
  seedAsset('image-stream-private', owner.id, '2026-01-02T00:00:02.000Z');

  const assetStorage = createReadableAssetStorage();
  const app = createFakeApp();
  registerAssetRoutes(app, {
    assetStorage,
    assertOpenLocationAllowed: () => {},
    deploymentMode: 'server',
    getRequestUserId: () => other.id,
    openLocationEnabled: false,
    outputDir: tempDir,
    publicAsset: (asset) => asset,
    safeImageMimeTypes: new Set(['image/png']),
    uploadLimits: {},
  });

  const route = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/images/:imageId');
  const res = createMockRes();
  runRoute(route, { params: { imageId: 'image-stream-private' } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Image not found');
  assert.equal(assetStorage.existsCount, 0);
  assert.equal(assetStorage.readCount, 0);
});

test('asset stream route reads owned assets only after ownership is confirmed', () => {
  const owner = createUser({
    email: 'asset-stream-readable@example.com',
    username: 'asset-stream-readable@example.com',
    name: 'Asset Stream Readable',
    passwordHash: 'test',
  });
  seedAsset('asset-stream-readable', owner.id, '2026-01-02T00:00:03.000Z');

  const assetStorage = createReadableAssetStorage();
  const app = createFakeApp();
  registerAssetRoutes(app, {
    assetStorage,
    assertOpenLocationAllowed: () => {},
    deploymentMode: 'server',
    getRequestUserId: () => owner.id,
    openLocationEnabled: false,
    outputDir: tempDir,
    publicAsset: (asset) => asset,
    safeImageMimeTypes: new Set(['image/png']),
    uploadLimits: {},
  });

  const route = app.routes.find((item) => item.method === 'GET' && item.pathname === '/api/assets/:assetId');
  const res = createMockRes();
  runRoute(route, { params: { assetId: 'asset-stream-readable' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.equal(assetStorage.existsCount, 1);
  assert.equal(assetStorage.readCount, 1);
  assert.equal(assetStorage.lastReadAssetId, 'asset-stream-readable');
  assert.equal(res.pipedAssetId, 'asset-stream-readable');
});
