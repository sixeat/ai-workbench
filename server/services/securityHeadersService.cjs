function configuredCspSource(env, envName, fallback) {
  const configured = String(env?.[envName] || '').trim();
  return configured || fallback;
}

function buildContentSecurityPolicy(env = {}) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${configuredCspSource(env, 'WORKBENCH_CSP_IMG_SRC', "'self' data: blob:")}`,
    `media-src ${configuredCspSource(env, 'WORKBENCH_CSP_MEDIA_SRC', "'self' data: blob:")}`,
    `connect-src ${configuredCspSource(env, 'WORKBENCH_CSP_CONNECT_SRC', "'self'")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

function hstsHeaderValue(env = {}) {
  if (String(env.WORKBENCH_ENABLE_HSTS || 'true').trim().toLowerCase() === 'false') return '';
  if (String(env.WORKBENCH_DEPLOYMENT_MODE || '').trim() !== 'server') return '';
  const maxAge = String(env.WORKBENCH_HSTS_MAX_AGE || '15552000').trim();
  const includeSubDomains = String(env.WORKBENCH_HSTS_INCLUDE_SUBDOMAINS || 'true').trim().toLowerCase() !== 'false';
  const preload = String(env.WORKBENCH_HSTS_PRELOAD || 'false').trim().toLowerCase() === 'true';
  return [
    `max-age=${maxAge}`,
    includeSubDomains ? 'includeSubDomains' : '',
    preload ? 'preload' : '',
  ].filter(Boolean).join('; ');
}

function applySecurityHeaders(res, options = {}) {
  const { env = process.env } = options;
  const hsts = hstsHeaderValue(env);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', buildContentSecurityPolicy(env));
  if (hsts) res.setHeader('Strict-Transport-Security', hsts);
}

function createSecurityHeadersMiddleware(options = {}) {
  return (_req, res, next) => {
    applySecurityHeaders(res, options);
    return next();
  };
}

module.exports = {
  applySecurityHeaders,
  buildContentSecurityPolicy,
  configuredCspSource,
  createSecurityHeadersMiddleware,
  hstsHeaderValue,
};
