const { assetRepository: defaultAssetRepository } = require('../repositories/assetRepository.cjs');
const { collectionMetadataForTemplate } = require('../assetCollectionTemplates.cjs');
const { writeAssetAuditLog } = require('./assetService.cjs');

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

function normalizeAssetIdList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((assetId) => String(assetId || '').trim()).filter(Boolean))]
    : [];
}

function normalizeCollectionCreateBody(body = {}) {
  const name = normalizeLimitedText(body.name, 'name', ASSET_COLLECTION_LIMITS.maxNameLength, { required: true });
  const description = normalizeLimitedText(body.description, 'description', ASSET_COLLECTION_LIMITS.maxDescriptionLength);
  const category = normalizeLimitedText(body.category, 'category', ASSET_COLLECTION_LIMITS.maxCategoryLength, { fallback: 'character' }) || 'character';
  const metadata = collectionMetadataForTemplate(category, normalizeMetadataObject(body.metadata, {}));
  normalizeMetadataObject(metadata);
  return {
    category,
    description,
    metadata,
    name,
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
    note: normalizeLimitedText(body.note, 'note', ASSET_COLLECTION_LIMITS.maxNoteLength),
    role: normalizeLimitedText(body.role, 'role', ASSET_COLLECTION_LIMITS.maxRoleLength),
  };
}

function listQuery(query = {}) {
  return {
    limit: Math.max(1, Math.min(500, Number(query.limit || 100) || 100)),
    offset: Math.max(0, Math.min(100_000, Number(query.offset || 0) || 0)),
    search: String(query.search || '').trim(),
  };
}

function nextCollectionCoverAssetId(collectionId, userId, assetRepository = defaultAssetRepository) {
  const assets = assetRepository.listCollectionAssets(collectionId, userId);
  return assets.find((asset) => asset.type === 'image')?.id || null;
}

function refreshCollectionCoverAfterRemoval(collectionId, userId, removedAssetIds, assetRepository = defaultAssetRepository) {
  const collection = assetRepository.getAssetCollectionForUser(collectionId, userId);
  if (!collection) return null;
  if (!collection.coverAssetId || !removedAssetIds.includes(collection.coverAssetId)) return collection;
  return assetRepository.updateAssetCollection(collectionId, userId, {
    coverAssetId: nextCollectionCoverAssetId(collectionId, userId, assetRepository),
  });
}

function createAssetCollectionService(options = {}) {
  const {
    assetRepository = defaultAssetRepository,
    publicAsset = (asset) => asset,
  } = options;

  function withAssets(collection, userId) {
    return {
      ...collection,
      assets: assetRepository.listCollectionAssets(collection.id, userId).map(publicAsset),
    };
  }

  function listCollections(userId, queryParams = {}) {
    const query = listQuery(queryParams);
    const total = assetRepository.countAssetCollections(userId, query);
    const collections = assetRepository.listAssetCollections(userId, query)
      .map((collection) => withAssets(collection, userId));
    return {
      collections,
      count: total,
      limit: query.limit,
      offset: query.offset,
      total,
    };
  }

  function collectionAuditMetadata(collection, extra = {}) {
    return {
      category: collection?.category || '',
      name: collection?.name || '',
      ...extra,
    };
  }

  function auditCollection(userId, action, collection, metadata = {}, context = {}) {
    return writeAssetAuditLog(
      assetRepository,
      userId,
      action,
      'asset_collection',
      collection?.id || metadata.collectionId || '',
      collectionAuditMetadata(collection, metadata),
      context
    );
  }

  function createCollection(userId, body = {}, context = {}) {
    const collection = assetRepository.createAssetCollection({
      userId,
      ...normalizeCollectionCreateBody(body),
    });
    auditCollection(userId, 'asset_collection.create', collection, {}, context);
    return {
      ...collection,
      assets: [],
    };
  }

  function updateCollection(userId, collectionId, body = {}, context = {}) {
    const existingCollection = assetRepository.getAssetCollectionForUser(collectionId, userId);
    if (!existingCollection) throw publicError(404, 'Collection not found');

    const update = normalizeCollectionUpdateBody(body);
    if (Object.prototype.hasOwnProperty.call(update, 'coverAssetId') && update.coverAssetId) {
      const coverAssetInCollection = assetRepository.listCollectionAssets(collectionId, userId)
        .some((asset) => asset.id === update.coverAssetId);
      if (!coverAssetInCollection) throw publicError(400, 'coverAssetId must belong to the collection');
    }

    const collection = assetRepository.updateAssetCollection(collectionId, userId, update);
    if (!collection) throw publicError(404, 'Collection not found');
    auditCollection(userId, 'asset_collection.update', collection, {
      changedFields: Object.keys(update).sort(),
      previousCategory: existingCollection.category || '',
      previousName: existingCollection.name || '',
    }, context);
    return withAssets(collection, userId);
  }

  function deleteCollection(userId, collectionId, context = {}) {
    const existingCollection = assetRepository.getAssetCollectionForUser(collectionId, userId);
    const deleted = assetRepository.deleteAssetCollection(collectionId, userId);
    if (!deleted) throw publicError(404, 'Collection not found');
    auditCollection(userId, 'asset_collection.delete', existingCollection || { id: collectionId }, {}, context);
    return { ok: true };
  }

  function addAsset(userId, collectionId, body = {}, context = {}) {
    if (!body.assetId) throw publicError(400, 'assetId is required');
    const item = normalizeCollectionItemBody(body);
    const collection = assetRepository.addAssetToCollection({
      assetId: body.assetId,
      collectionId,
      note: item.note,
      role: item.role,
      userId,
    });
    if (!collection) throw publicError(404, 'Collection or asset not found');
    auditCollection(userId, 'asset_collection.add_asset', collection, {
      assetCount: 1,
      assetId: String(body.assetId || ''),
      role: item.role || '',
    }, context);
    return withAssets(collection, userId);
  }

  function addAssetsBatch(userId, collectionId, body = {}, context = {}) {
    const assetIds = normalizeAssetIdList(body.assetIds);
    const item = normalizeCollectionItemBody(body);

    if (assetIds.length === 0) throw publicError(400, 'assetIds must be a non-empty array');
    if (assetIds.length > 100) throw publicError(400, 'assetIds can include at most 100 items');

    const existingCollection = assetRepository.getAssetCollectionForUser(collectionId, userId);
    if (!existingCollection) throw publicError(404, 'Collection not found');

    let latestCollection = existingCollection;
    let added = 0;

    for (const assetId of assetIds) {
      const collection = assetRepository.addAssetToCollection({
        assetId,
        collectionId,
        note: item.note,
        role: item.role,
        userId,
      });
      if (!collection) continue;
      latestCollection = collection;
      added += 1;
    }

    const skipped = assetIds.length - added;
    if (added === 0) throw Object.assign(publicError(404, 'Collection or assets not found'), { data: { added, skipped } });

    auditCollection(userId, 'asset_collection.add_assets', latestCollection, {
      added,
      requested: assetIds.length,
      role: item.role || '',
      skipped,
    }, context);
    return {
      added,
      collection: withAssets(latestCollection, userId),
      skipped,
    };
  }

  function removeAssetsBatch(userId, collectionId, body = {}, context = {}) {
    const assetIds = normalizeAssetIdList(body.assetIds);

    if (assetIds.length === 0) throw publicError(400, 'assetIds must be a non-empty array');
    if (assetIds.length > 100) throw publicError(400, 'assetIds can include at most 100 items');

    const existingCollection = assetRepository.getAssetCollectionForUser(collectionId, userId);
    if (!existingCollection) throw publicError(404, 'Collection not found');

    let removed = 0;
    for (const assetId of assetIds) {
      if (assetRepository.removeAssetFromCollection(collectionId, assetId, userId)) removed += 1;
    }

    const skipped = assetIds.length - removed;
    if (removed === 0) throw Object.assign(publicError(404, 'Collection items not found'), { data: { removed, skipped } });

    const collection = refreshCollectionCoverAfterRemoval(collectionId, userId, assetIds, assetRepository) ||
      assetRepository.getAssetCollectionForUser(collectionId, userId);

    auditCollection(userId, 'asset_collection.remove_assets', collection || existingCollection, {
      removed,
      requested: assetIds.length,
      skipped,
    }, context);
    return {
      collection: withAssets(collection, userId),
      removed,
      skipped,
    };
  }

  function reorderAssets(userId, collectionId, body = {}, context = {}) {
    const assetIds = normalizeAssetIdList(body.assetIds);

    if (assetIds.length === 0) throw publicError(400, 'assetIds must be a non-empty array');
    if (assetIds.length > 500) throw publicError(400, 'assetIds can include at most 500 items');

    const result = assetRepository.reorderCollectionAssets({
      assetIds,
      collectionId,
      userId,
    });
    if (!result) throw publicError(404, 'Collection not found');
    if (result.reordered === 0) {
      throw Object.assign(publicError(404, 'Collection items not found'), {
        data: { reordered: 0, skipped: result.skipped },
      });
    }

    auditCollection(userId, 'asset_collection.reorder_assets', result.collection, {
      requested: assetIds.length,
      reordered: result.reordered,
      skipped: result.skipped,
    }, context);
    return {
      collection: withAssets(result.collection, userId),
      reordered: result.reordered,
      skipped: result.skipped,
    };
  }

  function removeAsset(userId, collectionId, assetId, context = {}) {
    const removed = assetRepository.removeAssetFromCollection(collectionId, assetId, userId);
    if (!removed) throw publicError(404, 'Collection item not found');
    const collection = refreshCollectionCoverAfterRemoval(collectionId, userId, [assetId], assetRepository);
    auditCollection(userId, 'asset_collection.remove_asset', collection || { id: collectionId }, {
      assetCount: 1,
      assetId: String(assetId || ''),
    }, context);
    return {
      collection: collection ? withAssets(collection, userId) : null,
      ok: true,
    };
  }

  return {
    addAsset,
    addAssetsBatch,
    createCollection,
    deleteCollection,
    listCollections,
    removeAsset,
    removeAssetsBatch,
    reorderAssets,
    updateCollection,
  };
}

module.exports = {
  ASSET_COLLECTION_LIMITS,
  createAssetCollectionService,
  normalizeAssetIdList,
  normalizeCollectionCreateBody,
  normalizeCollectionItemBody,
  normalizeCollectionUpdateBody,
};
