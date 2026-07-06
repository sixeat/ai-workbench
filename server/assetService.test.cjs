const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createAssetService,
  createPublicAsset,
  isInsideOutputDir,
  parseUploadDataUrl,
} = require('./services/assetService.cjs');

function createAssetRepository() {
  const assets = [];
  const auditLogs = [];
  return {
    assets,
    auditLogs,
    countAssets(userId) {
      return assets.filter((asset) => asset.userId === userId).length;
    },
    createAuditLog(log) {
      const saved = {
        id: `audit-${auditLogs.length + 1}`,
        ...log,
      };
      auditLogs.push(saved);
      return saved;
    },
    getAssetForUser(assetId, userId) {
      return assets.find((asset) => asset.id === assetId && asset.userId === userId) || null;
    },
    insertAsset(asset) {
      const stored = {
        createdAt: '2026-07-06T00:00:00.000Z',
        id: asset.id || `asset-${assets.length + 1}`,
        legacyUrl: `/api/images/${asset.id || `asset-${assets.length + 1}`}`,
        url: `/api/assets/${asset.id || `asset-${assets.length + 1}`}`,
        ...asset,
      };
      assets.push(stored);
      return stored;
    },
    listAssets(userId, query = {}) {
      const limit = Number(query.limit || 100);
      const offset = Number(query.offset || 0);
      return assets.filter((asset) => asset.userId === userId).slice(offset, offset + limit);
    },
    sumAssetBytes(userId, filters = {}) {
      return assets
        .filter((asset) => asset.userId === userId)
        .filter((asset) => !filters.providerId || asset.providerId === filters.providerId)
        .reduce((sum, asset) => sum + Number(asset.sizeBytes || 0), 0);
    },
  };
}

function createAssetStorage(existingPaths = new Set()) {
  let savedCount = 0;
  return {
    get savedCount() {
      return savedCount;
    },
    exists(asset) {
      return existingPaths.has(asset.filePath);
    },
    read(asset) {
      if (!existingPaths.has(asset.filePath)) return null;
      return { assetId: asset.id, pipe: () => {} };
    },
    async save(buffer, meta = {}) {
      savedCount += 1;
      return {
        fileName: meta.fileName || 'upload.png',
        filePath: `/tmp/${savedCount}.png`,
        id: `stored-${savedCount}`,
        legacyUrl: `/api/images/stored-${savedCount}`,
        metadata: meta.metadata,
        mime: meta.mime,
        prompt: meta.prompt,
        providerId: meta.providerId,
        sizeBytes: buffer.length,
        storageDriver: 'memory',
        type: meta.type,
        url: `/api/assets/stored-${savedCount}`,
      };
    },
  };
}

function imageDataUrl(size, mime = 'image/png') {
  return `data:${mime};base64,${Buffer.alloc(size, 1).toString('base64')}`;
}

test('asset service lists and formats public assets without leaking file paths in server mode', () => {
  const assetRepository = createAssetRepository();
  assetRepository.insertAsset({
    fileName: 'one.png',
    filePath: '/tmp/private/one.png',
    id: 'asset-1',
    type: 'image',
    userId: 'user-1',
    url: '/api/assets/asset-1',
  });
  assetRepository.insertAsset({
    fileName: 'two.png',
    filePath: '/tmp/private/two.png',
    id: 'asset-2',
    type: 'image',
    userId: 'user-2',
    url: '/api/assets/asset-2',
  });

  const service = createAssetService({
    assetRepository,
    publicAsset: createPublicAsset('server', true),
  });
  const page = service.listAssets('user-1', { limit: '10' });

  assert.equal(page.total, 1);
  assert.equal(page.assets[0].id, 'asset-1');
  assert.equal(page.assets[0].filePath, undefined);
  assert.equal(createPublicAsset('local', true)(assetRepository.assets[0]).filePath, '/tmp/private/one.png');
});

test('asset service uploads image data URLs and enforces mime and quota before saving', async () => {
  const assetRepository = createAssetRepository();
  const assetStorage = createAssetStorage();
  const service = createAssetService({
    assetRepository,
    assetStorage,
    publicAsset: (asset) => asset,
    safeImageMimeTypes: new Set(['image/png']),
    uploadLimits: {
      maxDailyUploadBytes: 100,
      maxFileBytes: 5,
      maxUserAssetBytes: 100,
    },
  });

  assert.throws(
    () => parseUploadDataUrl('not-a-data-url'),
    /base64 data URL/
  );
  await assert.rejects(
    () => service.uploadImageAsset('user-1', { dataUrl: imageDataUrl(2, 'text/plain') }),
    /Only png/
  );
  assert.equal(assetStorage.savedCount, 0);

  await assert.rejects(
    () => service.uploadImageAsset('user-1', { dataUrl: imageDataUrl(6), fileName: 'large.png' }),
    /too large/i
  );
  assert.equal(assetStorage.savedCount, 0);

  const uploaded = await service.uploadImageAsset('user-1', {
    dataUrl: imageDataUrl(4),
    fileName: 'avatar.png',
    prompt: 'reference image',
  }, {
    actorUserId: 'user-1',
    ipAddress: '203.0.113.60',
    userAgent: 'Asset Audit Browser',
  });
  assert.equal(uploaded.id, 'stored-1');
  assert.equal(uploaded.userId, 'user-1');
  assert.equal(uploaded.metadata.originalName, 'avatar.png');
  assert.equal(assetRepository.assets.length, 1);
  assert.equal(assetRepository.auditLogs.length, 1);
  assert.equal(assetRepository.auditLogs[0].action, 'asset.upload');
  assert.equal(assetRepository.auditLogs[0].actorUserId, 'user-1');
  assert.equal(assetRepository.auditLogs[0].ipAddress, '203.0.113.60');
  assert.equal(assetRepository.auditLogs[0].targetId, 'stored-1');
  assert.equal(assetRepository.auditLogs[0].targetType, 'asset');
  assert.deepEqual(assetRepository.auditLogs[0].metadata, {
    fileName: 'avatar.png',
    mime: 'image/png',
    providerId: 'upload',
    sizeBytes: 4,
    source: 'upload',
    type: 'image',
  });
  assert.equal(JSON.stringify(assetRepository.auditLogs).includes('data:image'), false);
  assert.equal(JSON.stringify(assetRepository.auditLogs).includes('reference image'), false);
});

test('asset service reads owned assets and blocks open-location outside output dir', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-asset-service-'));
  const ownedPath = path.join(tempDir, 'owned.png');
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-asset-service-outside-'));
  const outsidePath = path.join(outsideDir, 'outside.png');
  fs.writeFileSync(ownedPath, 'owned');
  fs.writeFileSync(outsidePath, 'outside');

  try {
    const assetRepository = createAssetRepository();
    const existingPaths = new Set([ownedPath, outsidePath]);
    const assetStorage = createAssetStorage(existingPaths);
    assetRepository.insertAsset({
      filePath: ownedPath,
      id: 'owned',
      type: 'image',
      userId: 'user-1',
    });
    assetRepository.insertAsset({
      filePath: outsidePath,
      id: 'outside',
      type: 'image',
      userId: 'user-1',
    });
    assetRepository.insertAsset({
      filePath: ownedPath,
      id: 'other-user',
      type: 'image',
      userId: 'user-2',
    });
    const opened = [];
    const service = createAssetService({
      assetRepository,
      assetStorage,
      outputDir: tempDir,
      openFileLocation: (filePath) => opened.push(filePath),
    });

    assert.equal(service.getReadableAsset('user-1', 'owned').stream.assetId, 'owned');
    assert.throws(
      () => service.getReadableAsset('user-1', 'other-user'),
      /Asset not found/
    );
    assert.equal(isInsideOutputDir(tempDir, ownedPath), true);
    assert.equal(isInsideOutputDir(tempDir, outsidePath), false);

    assert.deepEqual(service.openAssetLocation('user-1', 'owned'), { ok: true });
    assert.deepEqual(opened, [ownedPath]);
    assert.throws(
      () => service.openAssetLocation('user-1', 'outside'),
      /outside the configured output directory/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});
