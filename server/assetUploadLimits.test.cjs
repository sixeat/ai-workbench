const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-upload-limits-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const {
  createUser,
  db,
  insertAsset,
  listAssets,
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

function createAssetStorage() {
  let nextId = 1;
  return {
    savedCount: 0,
    async save(buffer, meta = {}) {
      this.savedCount += 1;
      const id = `uploaded-${nextId}`;
      nextId += 1;
      const now = new Date().toISOString();
      return {
        id,
        type: meta.type || 'image',
        storageDriver: 'local-fs',
        url: `/api/assets/${id}`,
        legacyUrl: `/api/images/${id}`,
        fileName: meta.fileName || `${id}.png`,
        filePath: path.join(tempDir, `${id}.png`),
        mime: meta.mime || 'image/png',
        prompt: meta.prompt || '',
        providerId: meta.providerId || 'upload',
        sizeBytes: buffer.length,
        metadata: meta.metadata || {},
        createdAt: now,
        updatedAt: now,
      };
    },
  };
}

function createUploadRoute(uploadLimits) {
  const app = createFakeApp();
  const assetStorage = createAssetStorage();
  registerAssetRoutes(app, {
    assetStorage,
    assertOpenLocationAllowed: () => {},
    deploymentMode: 'server',
    getRequestUserId: () => 'local-user',
    openLocationEnabled: false,
    outputDir: tempDir,
    publicAsset: (asset) => asset,
    safeImageMimeTypes: new Set(['image/png']),
    uploadLimits,
  });
  return {
    assetStorage,
    route: app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/assets/upload'),
  };
}

function imageDataUrl(size) {
  return `data:image/png;base64,${Buffer.alloc(size, 1).toString('base64')}`;
}

function dataUrl(mime, size) {
  return `data:${mime};base64,${Buffer.alloc(size, 1).toString('base64')}`;
}

async function runRoute(route, req, res) {
  let index = 0;
  function next() {
    const handler = route.handlers[index];
    index += 1;
    if (handler) return handler(req, res, next);
    return undefined;
  }
  return next();
}

function seedAsset({
  id,
  sizeBytes,
  userId = 'local-user',
  providerId = 'upload',
  createdAt = new Date().toISOString(),
}) {
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
    providerId,
    sizeBytes,
    metadata: {},
    createdAt,
    updatedAt: createdAt,
  });
}

test.beforeEach(() => {
  db.prepare('DELETE FROM asset_collection_items').run();
  db.prepare('DELETE FROM asset_collections').run();
  db.prepare('DELETE FROM task_outputs').run();
  db.prepare('DELETE FROM assets').run();
});

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('upload stores the asset size in SQLite', async () => {
  const { route } = createUploadRoute({
    maxFileBytes: 10,
    maxUserAssetBytes: 100,
    maxDailyUploadBytes: 100,
  });
  const res = createMockRes();

  await runRoute(route, {
    body: {
      dataUrl: imageDataUrl(4),
      fileName: 'avatar.png',
    },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(listAssets('local-user', 10)[0].sizeBytes, 4);
});

test('upload rejects unsupported mime types before saving', async () => {
  const { assetStorage, route } = createUploadRoute({
    maxFileBytes: 100,
    maxUserAssetBytes: 100,
    maxDailyUploadBytes: 100,
  });
  const res = createMockRes();

  await runRoute(route, {
    body: {
      dataUrl: dataUrl('text/plain', 4),
      fileName: 'not-an-image.txt',
    },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /png, jpeg, webp, and gif/i);
  assert.equal(assetStorage.savedCount, 0);
});

test('upload rejects files above the single-file limit before saving', async () => {
  const { assetStorage, route } = createUploadRoute({
    maxFileBytes: 5,
    maxUserAssetBytes: 100,
    maxDailyUploadBytes: 100,
  });
  const res = createMockRes();

  await runRoute(route, {
    body: {
      dataUrl: imageDataUrl(6),
      fileName: 'too-large.png',
    },
  }, res);

  assert.equal(res.statusCode, 413);
  assert.match(res.body.error, /too large/i);
  assert.equal(assetStorage.savedCount, 0);
});

test('upload rejects files when the user storage quota would be exceeded', async () => {
  seedAsset({ id: 'existing-total', sizeBytes: 90, providerId: 'generated' });
  const { route } = createUploadRoute({
    maxFileBytes: 100,
    maxUserAssetBytes: 100,
    maxDailyUploadBytes: 100,
  });
  const res = createMockRes();

  await runRoute(route, {
    body: {
      dataUrl: imageDataUrl(11),
      fileName: 'over-total.png',
    },
  }, res);

  assert.equal(res.statusCode, 413);
  assert.match(res.body.error, /storage quota/i);
});

test('upload quotas count only the current user assets', async () => {
  const otherUser = createUser({
    email: 'upload-other-user@example.com',
    username: 'upload-other-user@example.com',
    name: 'Upload Other User',
    passwordHash: 'test',
  });
  seedAsset({
    id: 'other-user-total',
    userId: otherUser.id,
    sizeBytes: 95,
    providerId: 'generated',
  });
  seedAsset({
    id: 'other-user-daily',
    userId: otherUser.id,
    sizeBytes: 95,
    providerId: 'upload',
  });
  const { route } = createUploadRoute({
    maxFileBytes: 100,
    maxUserAssetBytes: 100,
    maxDailyUploadBytes: 100,
  });
  const res = createMockRes();

  await runRoute(route, {
    body: {
      dataUrl: imageDataUrl(10),
      fileName: 'current-user.png',
    },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(listAssets('local-user', 10).length, 1);
});

test('upload rejects files when the daily upload quota would be exceeded', async () => {
  seedAsset({ id: 'existing-daily', sizeBytes: 90, providerId: 'upload' });
  const { route } = createUploadRoute({
    maxFileBytes: 100,
    maxUserAssetBytes: 1000,
    maxDailyUploadBytes: 100,
  });
  const res = createMockRes();

  await runRoute(route, {
    body: {
      dataUrl: imageDataUrl(11),
      fileName: 'over-daily.png',
    },
  }, res);

  assert.equal(res.statusCode, 413);
  assert.match(res.body.error, /daily upload quota/i);
});
