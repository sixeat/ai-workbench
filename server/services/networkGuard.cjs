const dns = require('dns').promises;
const net = require('net');
const { Agent, fetch: undiciFetch } = require('undici');

const DEFAULT_TIMEOUT_MS = Number(process.env.WORKBENCH_FETCH_TIMEOUT_MS || 60_000);
const DEFAULT_MAX_REDIRECTS = Number(process.env.WORKBENCH_FETCH_MAX_REDIRECTS || 5);
const NO_TIMEOUT_DISPATCHER = new Agent({
  bodyTimeout: 0,
  headersTimeout: 0,
});
const DEFAULT_FETCH = global.fetch;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_REDIRECT_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-api-key',
  'x-workbench-admin-token',
  'x-workbench-token',
]);

function isPrivateIPv4(address) {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIPv6(address) {
  const value = address.toLowerCase();
  if (value === '::1' || value === '::') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true;
  if (value.startsWith('::ffff:')) {
    return isPrivateIPv4(value.replace('::ffff:', ''));
  }
  return false;
}

function isPrivateIp(address) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIPv4(address);
  if (version === 6) return isPrivateIPv6(address);
  return true;
}

function isBlockedHostname(hostname) {
  const value = String(hostname || '').toLowerCase();
  return (
    value === 'localhost' ||
    value.endsWith('.localhost') ||
    value === 'metadata.google.internal'
  );
}

async function assertPublicHttpUrl(url) {
  const parsed = new URL(String(url || ''));
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('Only http and https URLs are allowed.'), { status: 400 });
  }

  if (process.env.WORKBENCH_ALLOW_PRIVATE_MEDIA_FETCH === 'true') return parsed;

  if (isBlockedHostname(parsed.hostname)) {
    throw Object.assign(new Error('Private or local URLs are not allowed.'), { status: 400 });
  }

  if (net.isIP(parsed.hostname)) {
    if (isPrivateIp(parsed.hostname)) {
      throw Object.assign(new Error('Private or local URLs are not allowed.'), { status: 400 });
    }
    return parsed;
  }

  const addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateIp(item.address))) {
    throw Object.assign(new Error('Private or local URLs are not allowed.'), { status: 400 });
  }

  return parsed;
}

function stripSensitiveHeaders(headers) {
  const normalized = new Headers(headers || {});
  for (const key of SENSITIVE_REDIRECT_HEADERS) {
    normalized.delete(key);
  }
  return Object.fromEntries(normalized.entries());
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = Object.hasOwn(options, 'timeoutMs')
    ? Number(options.timeoutMs)
    : DEFAULT_TIMEOUT_MS;
  const shouldUseTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
  const maxRedirects = Number(options.maxRedirects ?? DEFAULT_MAX_REDIRECTS);
  const validateRedirectUrl = options.validateRedirectUrl;
  const controller = shouldUseTimeout ? new AbortController() : null;
  const timeout = shouldUseTimeout ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const {
      maxRedirects: _maxRedirects,
      timeoutMs: _timeoutMs,
      validateRedirectUrl: _validateRedirectUrl,
      ...baseFetchOptions
    } = options;
    const signal = baseFetchOptions.signal || controller?.signal;
    let currentUrl = String(url);
    const useNoTimeoutDispatcher = !shouldUseTimeout && !baseFetchOptions.dispatcher && global.fetch === DEFAULT_FETCH;
    const fetchImpl = useNoTimeoutDispatcher ? undiciFetch : global.fetch;
    let fetchOptions = {
      ...baseFetchOptions,
      redirect: 'manual',
      ...(signal ? { signal } : {}),
      ...(useNoTimeoutDispatcher ? { dispatcher: NO_TIMEOUT_DISPATCHER } : {}),
    };

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const response = await fetchImpl(currentUrl, fetchOptions);
      if (!REDIRECT_STATUSES.has(response.status)) return response;

      const location = response.headers.get('location');
      if (!location) return response;
      if (redirectCount >= maxRedirects) {
        throw Object.assign(new Error('Too many redirects.'), { status: 400 });
      }

      const nextUrl = new URL(location, currentUrl).toString();
      if (validateRedirectUrl) await validateRedirectUrl(nextUrl);

      const method = String(fetchOptions.method || 'GET').toUpperCase();
      const shouldSwitchToGet = response.status === 303 || ([301, 302].includes(response.status) && method === 'POST');
      const shouldStripHeaders = new URL(currentUrl).origin !== new URL(nextUrl).origin;
      currentUrl = nextUrl;
      fetchOptions = {
        ...fetchOptions,
        ...(shouldStripHeaders ? { headers: stripSensitiveHeaders(fetchOptions.headers) } : {}),
        ...(shouldSwitchToGet ? { method: 'GET', body: undefined } : {}),
      };
    }

    throw Object.assign(new Error('Too many redirects.'), { status: 400 });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function fetchPublicUrl(url, options = {}) {
  await assertPublicHttpUrl(url);
  return fetchWithTimeout(url, {
    ...options,
    validateRedirectUrl: assertPublicHttpUrl,
  });
}

module.exports = {
  assertPublicHttpUrl,
  fetchPublicUrl,
  fetchWithTimeout,
  isPrivateIp,
};
