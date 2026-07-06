const LOCAL_DEVELOPMENT_SECRET = 'ai-workbench-local-development-secret';
const EXAMPLE_KEY_SECRET = 'replace-with-a-long-random-secret';

function deploymentMode(env = process.env) {
  return env.WORKBENCH_DEPLOYMENT_MODE === 'local' ? 'local' : 'server';
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function resolveHost(env = process.env, mode = deploymentMode(env)) {
  if (env.PROXY_HOST) return env.PROXY_HOST;
  return mode === 'server' ? '0.0.0.0' : '127.0.0.1';
}

function resolveServeStatic(env = process.env, mode = deploymentMode(env)) {
  if (env.WORKBENCH_SERVE_STATIC !== undefined && env.WORKBENCH_SERVE_STATIC !== '') {
    return parseBoolean(env.WORKBENCH_SERVE_STATIC, mode !== 'server');
  }
  return mode !== 'server';
}

function resolveSyncGeneration(env = process.env, mode = deploymentMode(env)) {
  return mode === 'local' && parseBoolean(env.WORKBENCH_ENABLE_SYNC_GENERATION, false);
}

function resolveCorsOrigin(env = process.env, mode = deploymentMode(env)) {
  const configured = String(env.WORKBENCH_CORS_ORIGIN || '').trim();
  if (configured) {
    const origins = configured.split(',').map((item) => item.trim()).filter(Boolean);
    return origins.length === 1 ? origins[0] : origins;
  }

  if (mode === 'server') return false;

  return (origin, callback) => {
    if (!origin) return callback(null, true);

    try {
      const hostname = new URL(origin).hostname;
      const allowed = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
      callback(null, allowed);
    } catch {
      callback(null, false);
    }
  };
}

function resolveKeyEncryptionSecret(env = process.env, mode = deploymentMode(env)) {
  const configured = String(env.WORKBENCH_KEY_SECRET || '').trim();

  if (mode === 'server') {
    if (!configured || configured === LOCAL_DEVELOPMENT_SECRET || configured === EXAMPLE_KEY_SECRET) {
      throw new Error('WORKBENCH_KEY_SECRET must be set to a strong, unique value in server mode.');
    }
    return configured;
  }

  return configured || LOCAL_DEVELOPMENT_SECRET;
}

function resolveAccessToken(env = process.env, mode = deploymentMode(env)) {
  const token = String(env.WORKBENCH_ACCESS_TOKEN || '').trim();
  const allowPublic = parseBoolean(env.WORKBENCH_ALLOW_PUBLIC_SERVER, false);
  const requireLogin = parseBoolean(env.WORKBENCH_REQUIRE_LOGIN, true);

  if (mode === 'server' && !token && !requireLogin && !allowPublic) {
    throw new Error('WORKBENCH_ACCESS_TOKEN must be set when login is disabled in server mode, or set WORKBENCH_ALLOW_PUBLIC_SERVER=true explicitly.');
  }

  return token;
}

function resolveAdminToken(env = process.env, mode = deploymentMode(env)) {
  const token = String(env.WORKBENCH_ADMIN_TOKEN || '').trim();
  if (mode === 'server' && token && token === String(env.WORKBENCH_ACCESS_TOKEN || '').trim()) {
    throw new Error('WORKBENCH_ADMIN_TOKEN must be different from WORKBENCH_ACCESS_TOKEN in server mode.');
  }
  return token;
}

function assertProxyConfiguration({ mode, enabled, allowlist }) {
  if (mode === 'server' && enabled && (!allowlist || allowlist.length === 0)) {
    throw new Error('WORKBENCH_PROXY_ALLOWLIST must be set when generic proxy is enabled in server mode.');
  }
}

function isLoopbackHost(host) {
  return ['127.0.0.1', 'localhost', '::1'].includes(String(host || '').trim().toLowerCase());
}

function shouldTrustClientUserId(env = process.env, _mode = deploymentMode(env), _host = resolveHost(env, _mode)) {
  return parseBoolean(env.WORKBENCH_TRUST_CLIENT_USER_ID, false);
}

function getRequestUserId(req, defaultUserId, options = {}) {
  const trusted = options.trustClientUserId !== false;
  if (!trusted) return defaultUserId;
  return String(req.headers['x-user-id'] || req.query?.userId || req.body?.userId || defaultUserId);
}

function isApiRequestAuthorized(req, accessToken) {
  if (!accessToken) return true;

  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  const headerToken = String(req.headers['x-workbench-token'] || '').trim();
  return [bearer, headerToken].some((token) => token && token === accessToken);
}

function isAdminRequestAuthorized(req, adminToken, _mode = deploymentMode()) {
  if (!adminToken) return false;

  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  const headerToken = String(req.headers['x-workbench-admin-token'] || '').trim();
  return [headerToken, bearer].some((token) => token && token === adminToken);
}

function buildProxyAllowlist(env = process.env) {
  return String(env.WORKBENCH_PROXY_ALLOWLIST || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function assertGenericProxyAllowed(targetUrl, options = {}) {
  const enabled = Boolean(options.enabled);
  const allowlist = options.allowlist || [];

  if (!enabled) {
    throw Object.assign(new Error('Generic proxy is disabled. Set WORKBENCH_ENABLE_GENERIC_PROXY=true to enable it.'), { status: 403 });
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw Object.assign(new Error('Proxy URL is invalid.'), { status: 400 });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('Proxy URL must use http or https.'), { status: 400 });
  }

  if (allowlist.length === 0) return;

  const hostname = parsed.hostname.toLowerCase();
  const origin = parsed.origin.toLowerCase();
  const allowed = allowlist.some((entry) =>
    entry === hostname ||
    entry === origin ||
    (entry.startsWith('*.') && hostname.endsWith(entry.slice(1)))
  );

  if (!allowed) {
    throw Object.assign(new Error('Proxy URL host is not allowed.'), { status: 403 });
  }
}

function assertOpenLocationAllowed(mode) {
  if (mode !== 'local') {
    throw Object.assign(new Error('Opening local file locations is only available in local mode.'), { status: 403 });
  }
  if (process.env.WORKBENCH_ENABLE_OPEN_LOCATION !== 'true') {
    throw Object.assign(new Error('Opening local file locations is disabled.'), { status: 403 });
  }
}

module.exports = {
  LOCAL_DEVELOPMENT_SECRET,
  EXAMPLE_KEY_SECRET,
  assertGenericProxyAllowed,
  assertOpenLocationAllowed,
  assertProxyConfiguration,
  buildProxyAllowlist,
  deploymentMode,
  getRequestUserId,
  isAdminRequestAuthorized,
  isApiRequestAuthorized,
  isLoopbackHost,
  parseBoolean,
  resolveAdminToken,
  resolveAccessToken,
  resolveCorsOrigin,
  resolveHost,
  resolveKeyEncryptionSecret,
  resolveServeStatic,
  resolveSyncGeneration,
  shouldTrustClientUserId,
};
