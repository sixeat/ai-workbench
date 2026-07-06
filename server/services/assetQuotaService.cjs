const { sumAssetBytes } = require('../db.cjs');

function formatMegabytes(bytes) {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`;
}

function startOfTodayIso(now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return today.toISOString();
}

function quotaError(status, error, code) {
  return { status, error, code };
}

function assertAssetStorageQuota({ userId, sizeBytes, uploadLimits = {} }) {
  const maxUserAssetBytes = Number(uploadLimits.maxUserAssetBytes || 0);
  const nextSizeBytes = Number(sizeBytes || 0);

  if (maxUserAssetBytes <= 0 || nextSizeBytes <= 0) return null;

  const currentBytes = sumAssetBytes(userId);
  if (currentBytes + nextSizeBytes <= maxUserAssetBytes) return null;

  return quotaError(
    413,
    `Asset storage quota exceeded. Maximum storage is ${formatMegabytes(maxUserAssetBytes)}.`,
    'asset_storage_quota_exceeded'
  );
}

function assertUploadLimits({ userId, sizeBytes, uploadLimits = {} }) {
  const maxFileBytes = Number(uploadLimits.maxFileBytes || 0);
  const maxDailyUploadBytes = Number(uploadLimits.maxDailyUploadBytes || 0);

  if (maxFileBytes > 0 && sizeBytes > maxFileBytes) {
    return quotaError(
      413,
      `Image is too large. Maximum size is ${formatMegabytes(maxFileBytes)}.`,
      'upload_file_too_large'
    );
  }

  const storageLimitError = assertAssetStorageQuota({ userId, sizeBytes, uploadLimits });
  if (storageLimitError) return storageLimitError;

  if (maxDailyUploadBytes > 0) {
    const uploadedToday = sumAssetBytes(userId, {
      providerId: 'upload',
      since: startOfTodayIso(),
    });
    if (uploadedToday + sizeBytes > maxDailyUploadBytes) {
      return quotaError(
        413,
        `Daily upload quota exceeded. Maximum daily upload is ${formatMegabytes(maxDailyUploadBytes)}.`,
        'daily_upload_quota_exceeded'
      );
    }
  }

  return null;
}

function toExposedQuotaError(limitError) {
  if (!limitError) return null;
  return Object.assign(new Error(limitError.error), {
    status: limitError.status,
    expose: true,
    code: limitError.code,
  });
}

module.exports = {
  assertAssetStorageQuota,
  assertUploadLimits,
  formatMegabytes,
  startOfTodayIso,
  toExposedQuotaError,
};
