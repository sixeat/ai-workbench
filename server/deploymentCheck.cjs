const {
  assertProxyConfiguration,
  buildProxyAllowlist,
  deploymentMode,
  parseBoolean,
  resolveAccessToken,
  resolveAdminToken,
  resolveKeyEncryptionSecret,
  resolveServeStatic,
} = require('./security.cjs');
const { loadEnv } = require('./env.cjs');
const { resolveGatewayUpstreams } = require('./services/gatewayService.cjs');
const {
  isLoopbackHostname,
  isWildcardBindHost,
} = require('./services/internalServiceExposureGuard.cjs');

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeFrontendApiUrl(value) {
  const trimmed = String(value || '').trim();
  return trimmed === '/' ? '/' : normalizeUrl(trimmed);
}

function isLocalUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

function isHttpsPublicUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || isLocalUrl(value);
  } catch {
    return false;
  }
}

function isPureOrigin(value) {
  if (!value || value === '/') return false;
  try {
    const parsed = new URL(value);
    return String(value).trim() === parsed.origin;
  } catch {
    return false;
  }
}

function parseOriginList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function sameOrigin(left, right) {
  if (!left || !right || left === '/' || right === '/') return false;
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.origin === rightUrl.origin;
  } catch {
    return false;
  }
}

function addSecurityResolverErrors(env, mode, errors) {
  for (const check of [
    () => resolveKeyEncryptionSecret(env, mode),
    () => resolveAccessToken(env, mode),
    () => resolveAdminToken(env, mode),
    () => assertProxyConfiguration({
      mode,
      enabled: parseBoolean(env.WORKBENCH_ENABLE_GENERIC_PROXY, false),
      allowlist: buildProxyAllowlist(env),
    }),
  ]) {
    try {
      check();
    } catch (error) {
      errors.push(error.message);
    }
  }
}

function hasSmtpConfig(env) {
  return Boolean(String(env.WORKBENCH_SMTP_HOST || '').trim());
}

function registrationEntryEnabled(env) {
  return parseBoolean(env.WORKBENCH_ALLOW_PUBLIC_REGISTRATION, false) ||
    parseBoolean(env.WORKBENCH_REQUIRE_INVITATION_CODE, true);
}

function addEmailDeploymentErrors(env, mode, errors) {
  if (mode !== 'server') return;

  if (parseBoolean(env.WORKBENCH_EMAIL_DEV_MODE, false) || parseBoolean(env.WORKBENCH_EMAIL_DEV_CODE_VISIBLE, false)) {
    errors.push('Email development mode must be disabled in server mode.');
  }

  if (registrationEntryEnabled(env) && !hasSmtpConfig(env)) {
    errors.push('WORKBENCH_SMTP_HOST is required when registration or invitation-based signup is enabled in server mode.');
  }
}

function addBootstrapAdminErrors(env, mode, errors, warnings) {
  if (mode !== 'server') return;

  const email = String(env.WORKBENCH_ADMIN_EMAIL || env.WORKBENCH_ADMIN_USERNAME || '').trim();
  const password = String(env.WORKBENCH_ADMIN_PASSWORD || '').trim();
  if (!email && !password) return;

  if (!email || !password) {
    errors.push('Both WORKBENCH_ADMIN_EMAIL and WORKBENCH_ADMIN_PASSWORD are required when bootstrapping an admin user.');
    return;
  }

  if (password === 'change-me-before-server-use') {
    errors.push('WORKBENCH_ADMIN_PASSWORD must not use the example password.');
  } else if (password.length < 12) {
    warnings.push('WORKBENCH_ADMIN_PASSWORD should be at least 12 characters for server deployments.');
  }
}

function addAdminAccessWarnings(env, mode, warnings) {
  if (mode !== 'server') return;

  const adminToken = String(env.WORKBENCH_ADMIN_TOKEN || '').trim();
  const email = String(env.WORKBENCH_ADMIN_EMAIL || env.WORKBENCH_ADMIN_USERNAME || '').trim();
  const password = String(env.WORKBENCH_ADMIN_PASSWORD || '').trim();
  if (adminToken || (email && password)) return;

  warnings.push('No bootstrap admin or WORKBENCH_ADMIN_TOKEN is configured. Make sure an enabled admin user already exists, or set WORKBENCH_ADMIN_EMAIL and WORKBENCH_ADMIN_PASSWORD before first server start.');
}

function addGatewayUpstreamErrors(env, errors) {
  try {
    resolveGatewayUpstreams(env);
  } catch (error) {
    errors.push(error.message);
  }
}

function addGatewayInternalTokenChecks(env, mode, errors, warnings) {
  if (mode !== 'server') return;

  let upstreams;
  try {
    upstreams = resolveGatewayUpstreams(env);
  } catch {
    return;
  }

  const entries = Object.entries(upstreams);
  if (entries.length === 0) return;

  const internalToken = String(env.WORKBENCH_INTERNAL_SERVICE_TOKEN || '').trim();
  const remoteUpstreams = entries
    .filter(([, value]) => !isLoopbackHostname(hostnameFromUrl(value)))
    .map(([key, value]) => `${key}=${value}`);
  const wildcardUpstreams = entries
    .filter(([, value]) => isWildcardBindHost(hostnameFromUrl(value)))
    .map(([key, value]) => `${key}=${value}`);

  if (wildcardUpstreams.length > 0) {
    errors.push(`Gateway upstreams must not point to wildcard bind hosts such as 0.0.0.0 or [::]: ${wildcardUpstreams.join(', ')}`);
  }

  if (remoteUpstreams.length > 0 && !internalToken) {
    errors.push(`WORKBENCH_INTERNAL_SERVICE_TOKEN is required when gateway upstreams are not loopback: ${remoteUpstreams.join(', ')}`);
  } else if (!internalToken) {
    warnings.push('Gateway upstreams are configured without WORKBENCH_INTERNAL_SERVICE_TOKEN. This is acceptable only when all internal services listen on loopback and are not exposed outside the host.');
  }
}

function addInternalServiceHostChecks(env, mode, errors, warnings) {
  if (mode !== 'server') return;

  const hostEntries = [
    ['WORKBENCH_AUTH_SERVICE_HOST', env.WORKBENCH_AUTH_SERVICE_HOST],
    ['WORKBENCH_WORKER_SERVICE_HOST', env.WORKBENCH_WORKER_SERVICE_HOST],
    ['WORKBENCH_ASSET_SERVICE_HOST', env.WORKBENCH_ASSET_SERVICE_HOST],
    ['WORKBENCH_MODEL_SERVICE_HOST', env.WORKBENCH_MODEL_SERVICE_HOST],
    ['WORKBENCH_WORKFLOW_SERVICE_HOST', env.WORKBENCH_WORKFLOW_SERVICE_HOST],
  ].filter(([, value]) => String(value || '').trim());
  const internalToken = String(env.WORKBENCH_INTERNAL_SERVICE_TOKEN || '').trim();

  for (const [envName, value] of hostEntries) {
    if (isWildcardBindHost(value)) {
      errors.push(`${envName} must not bind to ${value} in server mode. Internal services should listen on 127.0.0.1 or a private interface behind the gateway.`);
      continue;
    }

    if (!isLoopbackHostname(value)) {
      if (!internalToken) {
        errors.push(`${envName} is not loopback, so WORKBENCH_INTERNAL_SERVICE_TOKEN is required.`);
      }
      warnings.push(`${envName} is not loopback. Make sure this service is reachable only from the gateway/private network and not exposed to the public internet.`);
    }
  }
}

function addPrivateMediaFetchErrors(env, mode, errors) {
  if (mode !== 'server') return;

  if (parseBoolean(env.WORKBENCH_ALLOW_PRIVATE_MEDIA_FETCH, false)) {
    errors.push('WORKBENCH_ALLOW_PRIVATE_MEDIA_FETCH must stay false in server mode. Private media fetch disables SSRF protection for downloaded model assets.');
  }
}

function checkDeploymentConfig(env = process.env) {
  const errors = [];
  const warnings = [];
  const mode = deploymentMode(env);
  const serveStatic = resolveServeStatic(env, mode);
  const viteProxyUrl = normalizeFrontendApiUrl(env.VITE_PROXY_URL);
  const corsOrigins = parseOriginList(env.WORKBENCH_CORS_ORIGIN);
  const publicBaseUrl = normalizeUrl(env.WORKBENCH_PUBLIC_BASE_URL);
  const sameSite = String(env.WORKBENCH_COOKIE_SAMESITE || 'Lax').trim();
  const secureCookie = parseBoolean(env.WORKBENCH_COOKIE_SECURE, false);
  const splitDeployment = mode === 'server' && !serveStatic;

  if (mode !== 'server') {
    warnings.push('WORKBENCH_DEPLOYMENT_MODE is not server. This check is designed for server deployments.');
  }

  addSecurityResolverErrors(env, mode, errors);
  addEmailDeploymentErrors(env, mode, errors);
  addBootstrapAdminErrors(env, mode, errors, warnings);
  addAdminAccessWarnings(env, mode, warnings);
  addGatewayUpstreamErrors(env, errors);
  addGatewayInternalTokenChecks(env, mode, errors, warnings);
  addInternalServiceHostChecks(env, mode, errors, warnings);
  addPrivateMediaFetchErrors(env, mode, errors);

  if (mode === 'server' && serveStatic) {
    errors.push('WORKBENCH_SERVE_STATIC must be false in server mode. Deploy the frontend as static files on Nginx, Vercel, OSS, or a CDN, and keep this backend API-only.');
  }

  if (splitDeployment) {
    if (!viteProxyUrl) {
      errors.push('VITE_PROXY_URL is required when WORKBENCH_SERVE_STATIC=false.');
    } else if (viteProxyUrl === '/') {
      errors.push('VITE_PROXY_URL=/ means same-origin. Use the public backend API origin for split deployment.');
    } else if (!isHttpsPublicUrl(viteProxyUrl)) {
      warnings.push('VITE_PROXY_URL should use HTTPS for public deployments.');
    } else if (!isPureOrigin(viteProxyUrl)) {
      errors.push('VITE_PROXY_URL must be the backend API origin only, for example https://api.example.com. Do not include /api, paths, query strings, hashes, or a trailing slash.');
    }

    if (corsOrigins.length === 0) {
      errors.push('WORKBENCH_CORS_ORIGIN is required when frontend and backend are deployed separately.');
    }

    if (corsOrigins.includes('*')) {
      errors.push('WORKBENCH_CORS_ORIGIN=* is not compatible with credentialed login cookies.');
    }

    for (const origin of corsOrigins) {
      if (!isHttpsPublicUrl(origin)) {
        warnings.push(`WORKBENCH_CORS_ORIGIN should use HTTPS: ${origin}`);
      } else if (!isPureOrigin(origin)) {
        errors.push(`WORKBENCH_CORS_ORIGIN must contain frontend origins only, without paths, query strings, hashes, or trailing slashes: ${origin}`);
      }
      if (sameOrigin(origin, viteProxyUrl)) {
        errors.push('WORKBENCH_CORS_ORIGIN must be the frontend origin, not the backend API origin from VITE_PROXY_URL.');
      }
    }

    if (!publicBaseUrl) {
      warnings.push('WORKBENCH_PUBLIC_BASE_URL is empty. Relative reference assets may not be reachable by third-party model APIs.');
    } else if (!isHttpsPublicUrl(publicBaseUrl)) {
      warnings.push('WORKBENCH_PUBLIC_BASE_URL should use HTTPS for public deployments.');
    } else if (!isPureOrigin(publicBaseUrl)) {
      errors.push('WORKBENCH_PUBLIC_BASE_URL must be the backend API origin only, for example https://api.example.com. Do not include /api, paths, query strings, hashes, or a trailing slash.');
    }

    if (sameSite.toLowerCase() !== 'none') {
      warnings.push('Cross-origin frontend/API deployments usually require WORKBENCH_COOKIE_SAMESITE=None.');
    }

    if (sameSite.toLowerCase() === 'none' && !secureCookie) {
      errors.push('WORKBENCH_COOKIE_SECURE=true is required when WORKBENCH_COOKIE_SAMESITE=None.');
    }
  }

  if (mode === 'server' && parseBoolean(env.WORKBENCH_TRUST_CLIENT_USER_ID, false)) {
    errors.push('WORKBENCH_TRUST_CLIENT_USER_ID must stay false in server mode.');
  }

  if (mode === 'server' && parseBoolean(env.WORKBENCH_ALLOW_DIRECT_API_KEYS, false)) {
    errors.push('WORKBENCH_ALLOW_DIRECT_API_KEYS must stay false in server mode. Save API keys on the backend and call generation APIs with apiKeyId.');
  }

  if (mode === 'server' && parseBoolean(env.WORKBENCH_ENABLE_OPEN_LOCATION, false)) {
    warnings.push('WORKBENCH_ENABLE_OPEN_LOCATION is ignored outside local mode and should stay disabled on servers.');
  }

  if (mode === 'server' && !parseBoolean(env.WORKBENCH_REQUIRE_LOGIN, true) && parseBoolean(env.WORKBENCH_ALLOW_PUBLIC_SERVER, false)) {
    warnings.push('Login is disabled and WORKBENCH_ALLOW_PUBLIC_SERVER=true. Paid model endpoints may be exposed publicly.');
  }

  return {
    ok: errors.length === 0,
    mode,
    serveStatic,
    splitDeployment,
    errors,
    warnings,
  };
}

function printReport(report) {
  console.log('AI Workbench deployment check');
  console.log(`mode: ${report.mode}`);
  console.log(`serveStatic: ${report.serveStatic}`);
  console.log(`splitDeployment: ${report.splitDeployment}`);

  if (report.errors.length > 0) {
    console.log('\nErrors:');
    for (const error of report.errors) console.log(`- ${error}`);
  }

  if (report.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }

  if (report.ok) {
    console.log('\nResult: OK');
  } else {
    console.log('\nResult: FAILED');
  }
}

if (require.main === module) {
  loadEnv();
  const report = checkDeploymentConfig(process.env);
  printReport(report);
  process.exit(report.ok ? 0 : 1);
}

module.exports = {
  checkDeploymentConfig,
  printReport,
};
