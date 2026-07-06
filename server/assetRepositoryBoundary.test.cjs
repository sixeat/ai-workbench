const assert = require('node:assert/strict');
const test = require('node:test');

const { registerAssetRoutes } = require('./routes/assetRoutes.cjs');
const { assertUploadLimits } = require('./services/assetQuotaService.cjs');

function createFakeApp() {
  const routes = [];
  return {
    routes,
    get(pathname, handler) {
      routes.push({ method: 'GET', pathname, handler });
    },
    post(pathname, handler) {
      routes.push({ method: 'POST', pathname, handler });
    },
    patch(pathname, handler) {
      routes.push({ method: 'PATCH', pathname, handler });
    },
    delete(pathname, handler) {
      routes.push({ method: 'DELETE', pathname, handler });
    },
  };
}

function createMockReq(body = {}) {
  return {
    body,
    params: {},
    query: {},
  };
}

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
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

function createMemoryAssetRepository() {
  const assets = [];
  return {
    assets,
    countAssets(userId) {
      return assets.filter((asset) => asset.userId === userId).length;
    },
    insertAsset(asset) {
      const stored = {
        id: asset.id || `asset-${assets.length + 1}`,
        url: `/api/assets/${asset.id || `asset-${assets.length + 1}`}`,
        legacyUrl: `/api/images/${asset.id || `asset-${assets.length + 1}`}`,
        createdAt: new Date(0).toISOString(),
        ...asset,
      };
      assets.push(stored);
      return stored;
    },
    listAssets(userId) {
      return assets.filter((asset) => asset.userId === userId);
    },
    sumAssetBytes(userId, filters = {}) {
      return assets
        .filter((asset) => asset.userId === userId)
        .filter((asset) => !filters.providerId || asset.providerId === filters.providerId)
        .reduce((sum, asset) => sum + Number(asset.sizeBytes || 0), 0);
    },
  };
}

test('asset upload route can use an injected asset repository', async () => {
  const app = createFakeApp();
  const assetRepository = createMemoryAssetRepository();
  const assetStorage = {
    async save(buffer, meta) {
      return {
        id: 'stored-upload',
        type: meta.type,
        mime: meta.mime,
        fileName: meta.fileName || 'upload.png',
        filePath: '/tmp/upload.png',
        sizeBytes: buffer.length,
        providerId: meta.providerId,
        prompt: meta.prompt,
      };
    },
  };
  registerAssetRoutes(app, {
    assetRepository,
    assetStorage,
    assertOpenLocationAllowed: () => true,
    deploymentMode: 'server',
    getRequestUserId: () => 'user-1',
    outputDir: '/tmp',
    openLocationEnabled: false,
    publicAsset: (asset) => asset,
    safeImageMimeTypes: new Set(['image/png']),
    uploadLimits: {},
  });

  const route = app.routes.find((item) => item.method === 'POST' && item.pathname === '/api/assets/upload');
  const res = createMockRes();
  await route.handler(createMockReq({
    dataUrl: `data:image/png;base64,${Buffer.from('image bytes').toString('base64')}`,
    fileName: 'reference.png',
    prompt: 'reference image',
  }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.asset.id, 'stored-upload');
  assert.equal(assetRepository.assets.length, 1);
  assert.equal(assetRepository.assets[0].userId, 'user-1');
});

test('asset quota service can use an injected asset repository', () => {
  const assetRepository = createMemoryAssetRepository();
  assetRepository.insertAsset({
    id: 'upload-today',
    userId: 'user-1',
    providerId: 'upload',
    sizeBytes: 9,
  });

  const result = assertUploadLimits({
    userId: 'user-1',
    sizeBytes: 2,
    uploadLimits: {
      maxDailyUploadBytes: 10,
      maxFileBytes: 100,
      maxUserAssetBytes: 100,
    },
    assetRepository,
  });

  assert.equal(result.status, 413);
  assert.equal(result.code, 'daily_upload_quota_exceeded');
});
