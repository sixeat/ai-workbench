const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { assetRepository: defaultAssetRepository } = require('../repositories/assetRepository.cjs');
const { assertUploadLimits } = require('./assetQuotaService.cjs');

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
      createdAt: asset.createdAt,
      fileName: asset.fileName,
      id: asset.id,
      legacyUrl: asset.legacyUrl,
      model: asset.model,
      prompt: asset.prompt,
      providerId: asset.providerId,
      type: asset.type,
      url: asset.url,
    };
    if (deploymentMode === 'local' && exposeLocalFilePath) {
      result.filePath = asset.filePath;
    }
    return result;
  };
}

function listQuery(query = {}) {
  return {
    limit: Math.max(1, Math.min(500, Number(query.limit || 100) || 100)),
    offset: Math.max(0, Math.min(100_000, Number(query.offset || 0) || 0)),
  };
}

function parseUploadDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw publicError(400, 'dataUrl must be a base64 data URL.');
  return {
    buffer: Buffer.from(match[2], 'base64'),
    mime: match[1].toLowerCase(),
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

function auditContext(userId, context = {}) {
  return {
    actorUserId: context.actorUserId || userId,
    ipAddress: context.ipAddress || null,
    userAgent: context.userAgent || null,
  };
}

function writeAssetAuditLog(assetRepository, userId, action, targetType, targetId, metadata = {}, context = {}) {
  if (typeof assetRepository.createAuditLog !== 'function') return null;
  const requestContext = auditContext(userId, context);
  return assetRepository.createAuditLog({
    action,
    actorUserId: requestContext.actorUserId,
    ipAddress: requestContext.ipAddress,
    metadata,
    targetId,
    targetType,
    userAgent: requestContext.userAgent,
  });
}

function createAssetService(options = {}) {
  const {
    assetRepository = defaultAssetRepository,
    assetStorage,
    assertOpenLocationAllowed = () => {},
    deploymentMode = 'local',
    openFileLocation: openFileLocationImpl = openFileLocation,
    outputDir = '',
    publicAsset = (asset) => asset,
    safeImageMimeTypes = new Set(),
    uploadLimits = {},
  } = options;

  function listAssets(userId, queryParams = {}) {
    const { limit, offset } = listQuery(queryParams);
    const total = assetRepository.countAssets(userId);
    const assets = assetRepository.listAssets(userId, { limit, offset }).map(publicAsset);
    return { assets, count: total, limit, offset, total };
  }

  async function uploadImageAsset(userId, body = {}, context = {}) {
    const { buffer, mime } = parseUploadDataUrl(body.dataUrl);
    if (!safeImageMimeTypes.has(mime)) {
      throw publicError(400, 'Only png, jpeg, webp, and gif uploads are supported.');
    }

    const limitError = assertUploadLimits({ userId, sizeBytes: buffer.length, uploadLimits, assetRepository });
    if (limitError) throw publicError(limitError.status, limitError.error);

    const stored = await assetStorage.save(buffer, {
      fileName: body.fileName,
      metadata: {
        originalName: body.fileName || '',
        source: 'upload',
      },
      mime,
      prompt: body.prompt || '',
      providerId: 'upload',
      type: 'image',
    });

    const asset = assetRepository.insertAsset({
      ...stored,
      userId,
    });
    writeAssetAuditLog(assetRepository, userId, 'asset.upload', 'asset', asset.id, {
      fileName: asset.fileName || '',
      mime: asset.mime || mime,
      providerId: asset.providerId || 'upload',
      sizeBytes: Number(asset.sizeBytes || buffer.length),
      source: asset.metadata?.source || 'upload',
      type: asset.type || 'image',
    }, context);
    return publicAsset(asset);
  }

  function getReadableAsset(userId, assetId, notFoundMessage = 'Asset not found') {
    const asset = assetRepository.getAssetForUser(assetId, userId);
    if (!asset || !assetStorage.exists(asset)) throw publicError(404, notFoundMessage);
    const stream = assetStorage.read(asset);
    if (!stream) throw publicError(404, notFoundMessage);
    return { asset, stream };
  }

  function openAssetLocation(userId, assetId) {
    assertOpenLocationAllowed(deploymentMode);
    const { asset } = getReadableAsset(userId, assetId, 'Asset not found');
    if (!isInsideOutputDir(outputDir, asset.filePath)) {
      throw publicError(403, 'Asset path is outside the configured output directory.');
    }

    openFileLocationImpl(asset.filePath);
    return { ok: true };
  }

  return {
    getReadableAsset,
    listAssets,
    openAssetLocation,
    uploadImageAsset,
  };
}

module.exports = {
  createAssetService,
  createPublicAsset,
  writeAssetAuditLog,
  isInsideOutputDir,
  openFileLocation,
  parseUploadDataUrl,
};
