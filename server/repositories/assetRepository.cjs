const db = require('../db.cjs');

function createAssetRepository(overrides = {}) {
  return {
    addAssetToCollection: overrides.addAssetToCollection || db.addAssetToCollection,
    countAllAssets: overrides.countAllAssets || db.countAllAssets,
    countAssetCollections: overrides.countAssetCollections || db.countAssetCollections,
    countAssets: overrides.countAssets || db.countAssets,
    createAuditLog: overrides.createAuditLog || db.createAuditLog,
    createAssetCollection: overrides.createAssetCollection || db.createAssetCollection,
    deleteAssetCollection: overrides.deleteAssetCollection || db.deleteAssetCollection,
    getAssetCollectionForUser: overrides.getAssetCollectionForUser || db.getAssetCollectionForUser,
    getAssetForUser: overrides.getAssetForUser || db.getAssetForUser,
    insertAsset: overrides.insertAsset || db.insertAsset,
    listAssetCollections: overrides.listAssetCollections || db.listAssetCollections,
    listAssets: overrides.listAssets || db.listAssets,
    listCollectionAssets: overrides.listCollectionAssets || db.listCollectionAssets,
    removeAssetFromCollection: overrides.removeAssetFromCollection || db.removeAssetFromCollection,
    reorderCollectionAssets: overrides.reorderCollectionAssets || db.reorderCollectionAssets,
    sumAssetBytes: overrides.sumAssetBytes || db.sumAssetBytes,
    updateAssetCollection: overrides.updateAssetCollection || db.updateAssetCollection,
  };
}

const assetRepository = createAssetRepository();

module.exports = {
  assetRepository,
  createAssetRepository,
};
