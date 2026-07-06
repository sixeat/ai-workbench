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

function applySecurityHeaders(res, options = {}) {
  const { env = process.env } = options;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', buildContentSecurityPolicy(env));
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
};
