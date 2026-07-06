const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createPublicAsset,
  registerAssetRoutes,
} = require('./routes/assetRoutes.cjs');

function createFakeApp() {
  const routes = [];
  return {
    get(path, handler) {
      routes.push({ method: 'GET', path, handler });
    },
    post(path, handler) {
      routes.push({ method: 'POST', path, handler });
    },
    patch(path, handler) {
      routes.push({ method: 'PATCH', path, handler });
    },
    delete(path, handler) {
      routes.push({ method: 'DELETE', path, handler });
    },
    routes,
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

function baseContext(openLocationEnabled) {
  return {
    assetStorage: {},
    assertOpenLocationAllowed: () => {},
    deploymentMode: 'server',
    getRequestUserId: () => 'local-user',
    openLocationEnabled,
    outputDir: '/tmp/outputs',
    publicAsset: (asset) => asset,
    safeImageMimeTypes: new Set(['image/png']),
  };
}

test('public assets hide file paths unless local open-location is enabled', () => {
  const asset = {
    id: 'asset-1',
    type: 'image',
    url: '/api/assets/asset-1',
    filePath: '/tmp/outputs/asset.png',
  };

  assert.equal(createPublicAsset('server', true)(asset).filePath, undefined);
  assert.equal(createPublicAsset('local', false)(asset).filePath, undefined);
  assert.equal(createPublicAsset('local', true)(asset).filePath, '/tmp/outputs/asset.png');
});

test('open-location route is registered only when explicitly enabled', () => {
  const disabledApp = createFakeApp();
  registerAssetRoutes(disabledApp, baseContext(false));
  assert.equal(disabledApp.routes.some((route) => route.path === '/api/assets/:assetId/open-location'), false);

  const enabledApp = createFakeApp();
  registerAssetRoutes(enabledApp, baseContext(true));
  assert.equal(enabledApp.routes.some((route) => route.path === '/api/assets/:assetId/open-location'), true);
});

test('asset collection templates route exposes reusable collection presets', () => {
  const app = createFakeApp();
  registerAssetRoutes(app, baseContext(false));

  const route = app.routes.find((item) => item.method === 'GET' && item.path === '/api/asset-collection-templates');
  const res = createMockRes();
  route.handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.templates.some((template) => template.category === 'character'), true);
  assert.equal(res.body.templates.some((template) => template.category === 'reference-group'), true);
  assert.equal(res.body.count, res.body.templates.length);
});
