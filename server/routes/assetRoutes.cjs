const { sendSafeError } = require('../httpErrors.cjs');
const { assertUploadLimits } = require('../services/assetQuotaService.cjs');
const {
  createAssetService,
  createPublicAsset,
} = require('../services/assetService.cjs');
const {
  ASSET_COLLECTION_LIMITS,
  createAssetCollectionService,
} = require('../services/assetCollectionService.cjs');
const {
  listAssetCollectionTemplates,
} = require('../assetCollectionTemplates.cjs');

function streamAssetResult(res, result, fallbackMime) {
  res.setHeader('Content-Type', result.asset.mime || fallbackMime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  result.stream.pipe(res);
}

function sendCollectionError(res, error, options = {}) {
  if (error?.data && error?.expose && Number(error.status) >= 400 && Number(error.status) < 500) {
    return res.status(error.status).json({
      error: error.message,
      ...error.data,
    });
  }
  return sendSafeError(res, error, options);
}

function requestIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function auditContext(req, userId) {
  return {
    actorUserId: req.authUser?.id || userId,
    ipAddress: requestIp(req),
    userAgent: String(req.headers?.['user-agent'] || '').slice(0, 500),
  };
}

function registerAssetRoutes(app, context) {
  const {
    assetStorage,
    assetRepository,
    assertOpenLocationAllowed,
    deploymentMode,
    getRequestUserId,
    outputDir,
    openLocationEnabled,
    publicAsset,
    safeImageMimeTypes,
    uploadLimits,
  } = context;
  const assetCollectionService = createAssetCollectionService({
    assetRepository,
    publicAsset,
  });
  const assetService = createAssetService({
    assetRepository,
    assetStorage,
    assertOpenLocationAllowed,
    deploymentMode,
    outputDir,
    publicAsset,
    safeImageMimeTypes,
    uploadLimits,
  });

  app.get('/api/assets', (req, res) => {
    const userId = getRequestUserId(req);
    res.json(assetService.listAssets(userId, req.query || {}));
  });

  app.post('/api/assets/upload', async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      res.status(201).json({
        asset: await assetService.uploadImageAsset(userId, req.body || {}, auditContext(req, userId)),
      });
    } catch (error) {
      console.error('/api/assets/upload error:', error.message);
      sendSafeError(res, error, { message: 'Unable to upload asset.' });
    }
  });

  app.get('/api/asset-collections', (req, res) => {
    const userId = getRequestUserId(req);
    res.json(assetCollectionService.listCollections(userId, req.query || {}));
  });

  app.get('/api/asset-collection-templates', (req, res) => {
    const templates = listAssetCollectionTemplates();
    res.json({ templates, count: templates.length });
  });

  app.post('/api/asset-collections', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      res.status(201).json({
        collection: assetCollectionService.createCollection(userId, req.body || {}, auditContext(req, userId)),
      });
    } catch (error) {
      sendCollectionError(res, error, { message: 'Unable to create asset collection.' });
    }
  });

  app.patch('/api/asset-collections/:collectionId', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      res.json({
        collection: assetCollectionService.updateCollection(
          userId,
          req.params.collectionId,
          req.body || {},
          auditContext(req, userId)
        ),
      });
    } catch (error) {
      sendCollectionError(res, error, { message: 'Unable to update asset collection.' });
    }
  });

  app.delete('/api/asset-collections/:collectionId', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      res.json(assetCollectionService.deleteCollection(userId, req.params.collectionId, auditContext(req, userId)));
    } catch (error) {
      sendCollectionError(res, error, { message: 'Unable to delete asset collection.' });
    }
  });

  app.post('/api/asset-collections/:collectionId/assets', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      res.status(201).json({
        collection: assetCollectionService.addAsset(
          userId,
          req.params.collectionId,
          req.body || {},
          auditContext(req, userId)
        ),
      });
    } catch (error) {
      sendCollectionError(res, error, { message: 'Unable to add asset to collection.' });
    }
  });

  app.post('/api/asset-collections/:collectionId/assets/batch', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      res.status(201).json(assetCollectionService.addAssetsBatch(
        userId,
        req.params.collectionId,
        req.body || {},
        auditContext(req, userId)
      ));
    } catch (error) {
      sendCollectionError(res, error, { message: 'Unable to add assets to collection.' });
    }
  });

  app.post('/api/asset-collections/:collectionId/assets/batch-remove', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      res.json(assetCollectionService.removeAssetsBatch(
        userId,
        req.params.collectionId,
        req.body || {},
        auditContext(req, userId)
      ));
    } catch (error) {
      sendCollectionError(res, error, { message: 'Unable to remove assets from collection.' });
    }
  });

  app.post('/api/asset-collections/:collectionId/assets/reorder', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      res.json(assetCollectionService.reorderAssets(
        userId,
        req.params.collectionId,
        req.body || {},
        auditContext(req, userId)
      ));
    } catch (error) {
      sendCollectionError(res, error, { message: 'Unable to reorder collection assets.' });
    }
  });

  app.delete('/api/asset-collections/:collectionId/assets/:assetId', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      res.json(assetCollectionService.removeAsset(
        userId,
        req.params.collectionId,
        req.params.assetId,
        auditContext(req, userId)
      ));
    } catch (error) {
      sendCollectionError(res, error, { message: 'Unable to remove asset from collection.' });
    }
  });

  app.get('/api/assets/:assetId', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      streamAssetResult(res, assetService.getReadableAsset(userId, req.params.assetId, 'Asset not found'), 'application/octet-stream');
    } catch (error) {
      return sendSafeError(res, error, { message: 'Asset not found' });
    }
  });

  if (openLocationEnabled) {
    app.post('/api/assets/:assetId/open-location', (req, res) => {
      try {
        const userId = getRequestUserId(req);
        res.json(assetService.openAssetLocation(userId, req.params.assetId));
      } catch (error) {
        return sendSafeError(res, error, { message: 'Opening local file locations is not available.' });
      }
    });
  }

  app.get('/api/images/:imageId', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      streamAssetResult(res, assetService.getReadableAsset(userId, req.params.imageId, 'Image not found'), 'image/png');
    } catch (error) {
      return sendSafeError(res, error, { message: 'Image not found' });
    }
  });
}

module.exports = {
  ASSET_COLLECTION_LIMITS,
  assertUploadLimits,
  createPublicAsset,
  registerAssetRoutes,
};
