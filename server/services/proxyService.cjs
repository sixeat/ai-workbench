const { assertPublicHttpUrl, fetchWithTimeout } = require('./networkGuard.cjs');

const STRIPPED_PROXY_HEADERS = new Set([
  'authorization',
  'cookie',
  'host',
  'connection',
  'origin',
  'proxy-authorization',
  'referer',
  'set-cookie',
  'x-api-key',
  'x-csrf-token',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'x-user-id',
  'x-workbench-admin-token',
  'x-workbench-token',
]);

function joinUrl(baseUrl, endpoint) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  const pathPart = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (!base) return pathPart;
  if (base.endsWith(pathPart)) return base;

  const versionPrefix = pathPart.match(/^\/(v\d+)(\/.*)$/i);
  if (versionPrefix && base.endsWith(`/${versionPrefix[1]}`)) {
    return `${base}${versionPrefix[2]}`;
  }

  return `${base}${pathPart}`;
}

async function proxyRequest(targetUrl, options = {}) {
  const shouldGuardNetwork = process.env.WORKBENCH_DEPLOYMENT_MODE === 'server';
  if (process.env.WORKBENCH_DEPLOYMENT_MODE === 'server') {
    await assertPublicHttpUrl(targetUrl);
  }

  const headers = options.stripSensitiveHeaders
    ? stripProxyRequestHeaders(options.headers)
    : stripHopByHopHeaders(options.headers);

  const fetchOptions = {
    method: options.method || 'GET',
    headers,
  };

  if (options.body) {
    fetchOptions.body = typeof options.body === 'string'
      ? options.body
      : JSON.stringify(options.body);
  }

  const response = await fetchWithTimeout(targetUrl, {
    ...fetchOptions,
    ...(Object.hasOwn(options, 'timeoutMs') ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.maxRedirects != null ? { maxRedirects: options.maxRedirects } : {}),
    ...(shouldGuardNetwork ? { validateRedirectUrl: assertPublicHttpUrl } : {}),
  });
  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
    data,
  };
}

function stripProxyRequestHeaders(headers = {}) {
  const nextHeaders = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const normalized = String(key).trim().toLowerCase();
    if (!normalized || STRIPPED_PROXY_HEADERS.has(normalized)) continue;
    nextHeaders[key] = value;
  }
  return nextHeaders;
}

function stripHopByHopHeaders(headers = {}) {
  const nextHeaders = { ...(headers || {}) };
  delete nextHeaders.origin;
  delete nextHeaders.referer;
  delete nextHeaders.host;
  delete nextHeaders.connection;
  return nextHeaders;
}

module.exports = {
  joinUrl,
  proxyRequest,
  stripHopByHopHeaders,
  stripProxyRequestHeaders,
};
