function publicError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function normalizeModelItems(data) {
  const items = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
      ? data.models
      : [];

  return items
    .map((item) => ({
      id: String(item.id || item.name || '').trim(),
      ownedBy: item.owned_by ? String(item.owned_by) : undefined,
    }))
    .filter((item) => item.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function modelListErrorData(result) {
  return {
    error: result.data?.error?.message || `HTTP ${result.status}`,
  };
}

function createModelListService({
  getRequestUserId = (req) => req.authUser?.id || 'local-user',
  joinUrl,
  proxyRequest,
  readSecrets,
  resolveApiCredentials,
  resolveDirectCredentials,
}) {
  async function resolveRequestCredentials(req, secrets) {
    const body = req.body || {};
    if (body.apiKeyId) {
      return resolveApiCredentials({
        body,
        secrets,
        userId: getRequestUserId(req),
      });
    }
    return resolveDirectCredentials(body, secrets);
  }

  async function listModels(req) {
    const secrets = await readSecrets();
    const { baseUrl, apiKey } = await resolveRequestCredentials(req, secrets);
    if (!baseUrl) throw publicError(400, 'Base URL is required');

    const result = await proxyRequest(joinUrl(baseUrl, '/v1/models'), {
      method: 'GET',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });

    if (result.status >= 400) {
      return {
        data: modelListErrorData(result),
        status: result.status,
      };
    }

    const models = normalizeModelItems(result.data);
    return {
      data: {
        count: models.length,
        models,
      },
      status: 200,
    };
  }

  return {
    listModels,
  };
}

module.exports = {
  createModelListService,
  normalizeModelItems,
};
