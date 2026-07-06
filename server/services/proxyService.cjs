const { assertPublicHttpUrl, fetchWithTimeout } = require('./networkGuard.cjs');

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

  const headers = { ...(options.headers || {}) };
  delete headers.origin;
  delete headers.referer;
  delete headers.host;
  delete headers.connection;

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

module.exports = {
  joinUrl,
  proxyRequest,
};
