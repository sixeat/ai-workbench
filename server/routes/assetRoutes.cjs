const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  addAssetToCollection,
  countAssetCollections,
  countAssets,
  createAssetCollection,
  deleteAssetCollection,
  getAssetCollectionForUser,
  getAssetForUser,
  insertAsset,
  listAssets,
  listAssetCollections,
  listCollectionAssets,
  reorderCollectionAssets,
  removeAssetFromCollection,
  updateAssetCollection,
} = require('../db.cjs');
const { sendSafeError } = require('../httpErrors.cjs');
const { assertUploadLimits } = require('../services/assetQuotaService.cjs');
const {
  collectionMetadataForTemplate,
  listAssetCollectionTemplates,
} = require('../assetCollectionTemplates.cjs');

const ASSET_COLLECTION_LIMITS = {
  maxNameLength: 160,
  maxDescriptionLength: 4000,
  maxCategoryLength: 80,
  maxMetadataBytes: 64 * 1024,
  maxRoleLength: 80,
  maxNoteLength: 2000,
};

function publicError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function createPublicAsset(deploymentMode, exposeLocalFilePath = false) {
  return function publicAsset(asset) {
    if (!asset) return null;
    const result = {
      id: asset.id,
      type: asset.type,
      url: asset.url,
      legacyUrl: asset.legacyUrl,
      fileName: asset.fileName,
      prompt: asset.prompt,
      model: asset.model,
      providerId: asset.providerId,
      createdAt: asset.createdAt,
    };
    if (deploymentMode === 'local' && exposeLocalFilePath) {
      result.filePath = asset.filePath;
    }
    return result;
  };
}

function isInsideOutputDir(outputDir, filePath) {
  try {
    const outputRoot = fsSync.realpathSync.native(outputDir);
    const resolved = fsSync.realpathSync.native(filePath || '');
    const relative = path.relative(outputRoot, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

function openFileLocation(filePath) {
  if (process.platform === 'win32') {
    spawn('explorer.exe', ['/select,', filePath], { detached: true, shell: false, stdio: 'ignore' }).unref();
    return;
  }

  const folder = path.dirname(filePath);
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [folder], { detached: true, shell: false, stdio: 'ignore' }).unref();
}

function withAssets(collection, userId, publicAsset) {
  return {
    ...collection,
    assets: listCollectionAssets(collection.id, userId).map(publicAsset),
  };
}

function nextCollectionCoverAssetId(collectionId, userId) {
  const assets = listCollectionAssets(collectionId, userId);
  return assets.find((asset) => asset.type === 'image')?.id || null;
}

function refreshCollectionCoverAfterRemoval(collectionId, userId, removedAssetIds) {
  const collection = getAssetCollectionForUser(collectionId, userId);
  if (!collection) return null;
  if (!collection.coverAssetId || !removedAssetIds.includes(collection.coverAssetId)) return collection;
  return updateAssetCollection(collectionId, userId, {
    coverAssetId: nextCollectionCoverAssetId(collectionId, userId),
  });
}

function normalizeAssetIdList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((assetId) => String(assetId || '').trim()).filter(Boolean))]
    : [];
}

function hasControlCharacters(value) {
  return [...String(value || '')].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function normalizeLimitedText(value, fieldName, maxLength, { required = false, fallback = '' } = {}) {
  const text = String(value ?? fallback ?? '').trim();
  if (required && !text) throw publicError(400, `${fieldName} is required`);
  if (text.length > maxLength) {
    throw publicError(400, `${fieldName} can include at most ${maxLength} characters.`);
  }
  if (hasControlCharacters(text)) {
    throw publicError(400, `${fieldName} cannot include control characters.`);
  }
  return text;
}

function normalizeMetadataObject(value, fallback = {}) {
  const metadata = value === undefined || value === null ? fallback : value;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw publicError(400, 'metadata must be an object.');
  }
  const size = Buffer.byteLength(JSON.stringify(metadata), 'utf8');
  if (size > ASSET_COLLECTION_LIMITS.maxMetadataBytes) {
    throw publicError(413, `metadata can include at most ${ASSET_COLLECTION_LIMITS.maxMetadataBytes} bytes.`);
  }
  return metadata;
}

function normalizeCollectionCreateBody(body = {}) {
  const name = normalizeLimitedText(body.name, 'name', ASSET_COLLECTION_LIMITS.maxNameLength, { required: true });
  const description = normalizeLimitedText(body.description, 'description', ASSET_COLLECTION_LIMITS.maxDescriptionLength);
  const category = normalizeLimitedText(body.category, 'category', ASSET_COLLECTION_LIMITS.maxCategoryLength, { fallback: 'character' }) || 'character';
  const metadata = collectionMetadataForTemplate(category, normalizeMetadataObject(body.metadata, {}));
  normalizeMetadataObject(metadata);
  return {
    name,
    description,
    category,
    metadata,
  };
}

function normalizeCollectionUpdateBody(body = {}) {
  const result = {};
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    result.name = normalizeLimitedText(body.name, 'name', ASSET_COLLECTION_LIMITS.maxNameLength, { required: true });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    result.description = normalizeLimitedText(body.description, 'description', ASSET_COLLECTION_LIMITS.maxDescriptionLength);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'category')) {
    result.category = normalizeLimitedText(body.category, 'category', ASSET_COLLECTION_LIMITS.maxCategoryLength, { required: true });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'metadata')) {
    result.metadata = normalizeMetadataObject(body.metadata);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'coverAssetId')) {
    result.coverAssetId = body.coverAssetId;
  }
  return result;
}

function normalizeCollectionItemBody(body = {}) {
  return {
    role: normalizeLimitedText(body.role, 'role', ASSET_COLLECTION_LIMITS.maxRoleLength),
    note: normalizeLimitedText(body.note, 'note', ASSET_COLLECTION_LIMITS.maxNoteLength),
  };
}

function streamAsset(res, assetStorage, asset, fallbackMime) {
  res.setHeader('Content-Type', asset.mime || fallbackMime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  assetStorage.read(asset).pipe(res);
}

function registerAssetRoutes(app, context) {
  const {
    assetStorage,
    assertOpenLocationAllowed,
    deploymentMode,
    getRequestUserId,
    outputDir,
    openLocationEnabled,
    publicAsset,
    safeImageMimeTypes,
    uploadLimits,
  } = context;

  app.get('/api/assets', (req, res) => {
    const userId = getRequestUserId(req);
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100) || 100));
    const offset = Math.max(0, Math.min(100_000, Number(req.query.offset || 0) || 0));
    const total = countAssets(userId);
    const assets = listAssets(userId, { limit, offset }).map(publicAsset);
    res.json({ assets, count: total, total, limit, offset });
  });

  app.post('/api/assets/upload', async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const body = req.body || {};
      const dataUrl = String(body.dataUrl || '');
      const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);

      if (!match) return res.status(400).json({ error: 'dataUrl must be a base64 data URL.' });
      const mime = match[1].toLowerCase();
      if (!safeImageMimeTypes.has(mime)) {
        return res.status(400).json({ error: 'Only png, jpeg, webp, and gif uploads are supported.' });
      }

      const buffer = Buffer.from(match[2], 'base64');
      const limitError = assertUploadLimits({ userId, sizeBytes: buffer.length, uploadLimits });
      if (limitError) return res.status(limitError.status).json({ error: limitError.error });

      const stored = await assetStorage.save(buffer, {
        type: 'image',
        mime,
        fileName: body.fileName,
        prompt: body.prompt || '',
        providerId: 'upload',
        metadata: {
          source: 'upload',
          originalName: body.fileName || '',
        },
      });

      const asset = insertAsset({
        ...stored,
        userId,
      });

      res.status(201).json({ asset: publicAsset(asset) });
    } catch (error) {
      console.error('/api/assets/upload error:', error.message);
      sendSafeError(res, error, { message: 'Unable to upload asset.' });
    }
  });

  app.get('/api/asset-collections', (req, res) => {
    const userId = getRequestUserId(req);
    const requestQuery = req.query || {};
    const limit = Math.max(1, Math.min(500, Number(requestQuery.limit || 100) || 100));
    const offset = Math.max(0, Math.min(100_000, Number(requestQuery.offset || 0) || 0));
    const search = String(requestQuery.search || '').trim();
    const query = { limit, offset, search };
    const total = countAssetCollections(userId, query);
    const collections = listAssetCollections(userId, query).map((collection) => withAssets(collection, userId, publicAsset));
    res.json({ collections, count: total, total, limit, offset });
  });

  app.get('/api/asset-collection-templates', (req, res) => {
    const templates = listAssetCollectionTemplates();
    res.json({ templates, count: templates.length });
  });

  app.post('/api/asset-collections', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const body = normalizeCollectionCreateBody(req.body || {});

      const collection = createAssetCollection({
        userId,
        ...body,
      });

      res.status(201).json({
        collection: {
          ...collection,
          assets: [],
        },
      });
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to create asset collection.' });
    }
  });

  app.patch('/api/asset-collections/:collectionId', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const collectionId = req.params.collectionId;
      const existingCollection = getAssetCollectionForUser(collectionId, userId);
      if (!existingCollection) return res.status(404).json({ error: 'Collection not found' });

      const body = normalizeCollectionUpdateBody(req.body || {});
      if (Object.prototype.hasOwnProperty.call(body, 'coverAssetId') && body.coverAssetId) {
        const coverAssetInCollection = listCollectionAssets(collectionId, userId)
          .some((asset) => asset.id === body.coverAssetId);
        if (!coverAssetInCollection) {
          return res.status(400).json({ error: 'coverAssetId must belong to the collection' });
        }
      }

      const collection = updateAssetCollection(collectionId, userId, body);
      if (!collection) return res.status(404).json({ error: 'Collection not found' });
      res.json({ collection: withAssets(collection, userId, publicAsset) });
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to update asset collection.' });
    }
  });

  app.delete('/api/asset-collections/:collectionId', (req, res) => {
    const userId = getRequestUserId(req);
    const deleted = deleteAssetCollection(req.params.collectionId, userId);
    if (!deleted) return res.status(404).json({ error: 'Collection not found' });
    res.json({ ok: true });
  });

  app.post('/api/asset-collections/:collectionId/assets', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const body = req.body || {};
      if (!body.assetId) return res.status(400).json({ error: 'assetId is required' });
      const item = normalizeCollectionItemBody(body);

      const collection = addAssetToCollection({
        collectionId: req.params.collectionId,
        assetId: body.assetId,
        userId,
        role: item.role,
        note: item.note,
      });
      if (!collection) return res.status(404).json({ error: 'Collection or asset not found' });

      res.status(201).json({ collection: withAssets(collection, userId, publicAsset) });
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to add asset to collection.' });
    }
  });

  app.post('/api/asset-collections/:collectionId/assets/batch', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const body = req.body || {};
      const assetIds = normalizeAssetIdList(body.assetIds);
      const item = normalizeCollectionItemBody(body);

      if (assetIds.length === 0) return res.status(400).json({ error: 'assetIds must be a non-empty array' });
      if (assetIds.length > 100) return res.status(400).json({ error: 'assetIds can include at most 100 items' });

      const existingCollection = getAssetCollectionForUser(req.params.collectionId, userId);
      if (!existingCollection) return res.status(404).json({ error: 'Collection not found' });

      let latestCollection = existingCollection;
      let added = 0;

      for (const assetId of assetIds) {
        const collection = addAssetToCollection({
          collectionId: req.params.collectionId,
          assetId,
          userId,
          role: item.role,
          note: item.note,
        });
        if (!collection) continue;
        latestCollection = collection;
        added += 1;
      }

      const skipped = assetIds.length - added;
      if (added === 0) return res.status(404).json({ error: 'Collection or assets not found', added, skipped });

      res.status(201).json({
        collection: withAssets(latestCollection, userId, publicAsset),
        added,
        skipped,
      });
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to add assets to collection.' });
    }
  });

  app.post('/api/asset-collections/:collectionId/assets/batch-remove', (req, res) => {
    const userId = getRequestUserId(req);
    const body = req.body || {};
    const assetIds = normalizeAssetIdList(body.assetIds);

    if (assetIds.length === 0) return res.status(400).json({ error: 'assetIds must be a non-empty array' });
    if (assetIds.length > 100) return res.status(400).json({ error: 'assetIds can include at most 100 items' });

    const existingCollection = getAssetCollectionForUser(req.params.collectionId, userId);
    if (!existingCollection) return res.status(404).json({ error: 'Collection not found' });

    let removed = 0;
    for (const assetId of assetIds) {
      if (removeAssetFromCollection(req.params.collectionId, assetId, userId)) removed += 1;
    }

    const skipped = assetIds.length - removed;
    if (removed === 0) return res.status(404).json({ error: 'Collection items not found', removed, skipped });

    const collection = refreshCollectionCoverAfterRemoval(req.params.collectionId, userId, assetIds)
      || getAssetCollectionForUser(req.params.collectionId, userId);

    res.json({
      collection: withAssets(collection, userId, publicAsset),
      removed,
      skipped,
    });
  });

  app.post('/api/asset-collections/:collectionId/assets/reorder', (req, res) => {
    const userId = getRequestUserId(req);
    const body = req.body || {};
    const assetIds = normalizeAssetIdList(body.assetIds);

    if (assetIds.length === 0) return res.status(400).json({ error: 'assetIds must be a non-empty array' });
    if (assetIds.length > 500) return res.status(400).json({ error: 'assetIds can include at most 500 items' });

    const result = reorderCollectionAssets({
      collectionId: req.params.collectionId,
      userId,
      assetIds,
    });
    if (!result) return res.status(404).json({ error: 'Collection not found' });
    if (result.reordered === 0) {
      return res.status(404).json({ error: 'Collection items not found', reordered: 0, skipped: result.skipped });
    }

    res.json({
      collection: withAssets(result.collection, userId, publicAsset),
      reordered: result.reordered,
      skipped: result.skipped,
    });
  });

  app.delete('/api/asset-collections/:collectionId/assets/:assetId', (req, res) => {
    const userId = getRequestUserId(req);
    const removed = removeAssetFromCollection(req.params.collectionId, req.params.assetId, userId);
    if (!removed) return res.status(404).json({ error: 'Collection item not found' });
    const collection = refreshCollectionCoverAfterRemoval(
      req.params.collectionId,
      userId,
      [req.params.assetId]
    );
    res.json({
      ok: true,
      collection: collection ? withAssets(collection, userId, publicAsset) : null,
    });
  });

  app.get('/api/assets/:assetId', (req, res) => {
    const userId = getRequestUserId(req);
    const asset = getAssetForUser(req.params.assetId, userId);
    if (!asset || !assetStorage.exists(asset)) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    streamAsset(res, assetStorage, asset, 'application/octet-stream');
  });

  if (openLocationEnabled) {
    app.post('/api/assets/:assetId/open-location', (req, res) => {
      try {
        assertOpenLocationAllowed(deploymentMode);
      } catch (error) {
        return sendSafeError(res, error, { message: 'Opening local file locations is not available.' });
      }

      const userId = getRequestUserId(req);
      const asset = getAssetForUser(req.params.assetId, userId);
      if (!asset || !assetStorage.exists(asset)) {
        return res.status(404).json({ error: 'Asset not found' });
      }

      if (!isInsideOutputDir(outputDir, asset.filePath)) {
        return res.status(403).json({ error: 'Asset path is outside the configured output directory.' });
      }

      openFileLocation(asset.filePath);
      res.json({ ok: true });
    });
  }

  app.get('/api/images/:imageId', (req, res) => {
    const userId = getRequestUserId(req);
    const asset = getAssetForUser(req.params.imageId, userId);
    if (!asset || !assetStorage.exists(asset)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    streamAsset(res, assetStorage, asset, 'image/png');
  });
}

module.exports = {
  ASSET_COLLECTION_LIMITS,
  assertUploadLimits,
  createPublicAsset,
  registerAssetRoutes,
};
