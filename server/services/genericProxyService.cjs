const { assertGenericProxyAllowed } = require('../security.cjs');

function publicError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function createGenericProxyService({
  enableGenericProxy = false,
  proxyAllowlist = [],
  proxyRequest,
}) {
  async function proxy(body = {}) {
    const {
      body: proxyBody,
      headers = {},
      method = 'GET',
      url,
    } = body;

    if (!url) throw publicError(400, 'URL is required');

    assertGenericProxyAllowed(url, {
      allowlist: proxyAllowlist,
      enabled: enableGenericProxy,
    });

    const result = await proxyRequest(url, {
      body: proxyBody,
      headers,
      method,
      stripSensitiveHeaders: true,
    });

    return {
      data: result.data,
      status: result.status,
    };
  }

  return {
    proxy,
  };
}

module.exports = {
  createGenericProxyService,
};
