const fs = require('fs').promises;
const { createReadStream, existsSync } = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const OUTPUT_DIR = process.env.IMAGE_OUTPUT_DIR || path.join(__dirname, '..', 'outputs');

function slugify(value) {
  return String(value || 'asset')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'asset';
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function extensionFromMime(mime) {
  if (mime?.includes('jpeg') || mime?.includes('jpg')) return 'jpg';
  if (mime?.includes('webp')) return 'webp';
  if (mime?.includes('gif')) return 'gif';
  if (mime?.includes('mp4')) return 'mp4';
  return 'png';
}

function safeFileName(value, fallbackExtension) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const parsed = path.parse(raw.replace(/\\/g, '/'));
  const base = slugify(parsed.name || 'asset');
  return `${base}.${fallbackExtension}`;
}

function assertInsideDirectory(parentDir, childPath) {
  const parent = path.resolve(parentDir);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  throw new Error('Resolved asset path is outside the configured output directory.');
}

class LocalAssetStorage {
  constructor(outputDir = OUTPUT_DIR) {
    this.outputDir = outputDir;
    this.driver = 'local-fs';
  }

  async save(buffer, meta = {}) {
    await fs.mkdir(this.outputDir, { recursive: true });
    const id = meta.id || randomUUID();
    const index = Number(meta.index || 0);
    const mime = meta.mime || 'image/png';
    const extension = extensionFromMime(mime);
    const fileName = safeFileName(meta.fileName, extension) || `${timestamp()}_${String(index + 1).padStart(2, '0')}_${slugify(meta.providerId || meta.provider || 'asset')}_${slugify(meta.prompt)}.${extension}`;
    const filePath = path.join(this.outputDir, fileName);
    assertInsideDirectory(this.outputDir, filePath);
    await fs.writeFile(filePath, buffer);

    return {
      id,
      type: meta.type || 'image',
      storageDriver: this.driver,
      url: `/api/assets/${id}`,
      legacyUrl: `/api/images/${id}`,
      fileName,
      filePath,
      mime,
      prompt: meta.prompt,
      negativePrompt: meta.negativePrompt,
      model: meta.model,
      providerId: meta.providerId || meta.provider,
      width: meta.width,
      height: meta.height,
      seed: meta.seed,
      sizeBytes: buffer?.byteLength ?? buffer?.length ?? 0,
      metadata: meta.metadata || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  read(asset) {
    if (!asset || !asset.filePath || !existsSync(asset.filePath)) return null;
    return createReadStream(asset.filePath);
  }

  exists(asset) {
    return Boolean(asset?.filePath && existsSync(asset.filePath));
  }

  getPublicUrl(asset) {
    return asset?.url || '';
  }
}

module.exports = {
  OUTPUT_DIR,
  LocalAssetStorage,
};
