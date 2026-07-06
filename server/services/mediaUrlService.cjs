function getPublicBaseUrl(req) {
  if (!req) return '';
  const explicit = process.env.WORKBENCH_PUBLIC_BASE_URL || '';
  if (explicit) return explicit.replace(/\/+$/, '');
  if (req.publicBaseUrl) return String(req.publicBaseUrl).replace(/\/+$/, '');

  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return host ? `${protocol}://${host}` : '';
}

function toPublicAssetUrl(req, url) {
  const value = String(url || '').trim();
  if (!value || value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) return value;
  const baseUrl = getPublicBaseUrl(req);
  const pathPart = value.startsWith('/') ? value : `/${value}`;
  return baseUrl ? `${baseUrl}${pathPart}` : value;
}

module.exports = {
  getPublicBaseUrl,
  toPublicAssetUrl,
};
