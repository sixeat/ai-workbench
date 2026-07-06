const { getModelCapabilities } = require('../modelCapabilities.cjs');
const { getProviderDefaultModels, getProviderTemplate } = require('../providerRegistry.cjs');
const { safeUpstreamErrorMessage } = require('../httpErrors.cjs');
const { getTextProviderAdapter } = require('./textProviderAdapters.cjs');

function authHeadersForProvider(provider, apiKey) {
  if (!apiKey) return {};
  if (provider?.requestFormat === 'anthropic' || provider?.id === 'anthropic') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': provider?.headers?.['anthropic-version'] || '2023-06-01',
    };
  }
  return { Authorization: `Bearer ${apiKey}` };
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

function publicCapabilities(capabilities) {
  return {
    chat: Boolean(capabilities.chat),
    imageGeneration: Boolean(capabilities.imageGeneration),
    imageReference: Boolean(capabilities.imageReference),
    multiImageReference: Boolean(capabilities.multiImageReference),
    negativePrompt: Boolean(capabilities.negativePrompt),
    seed: Boolean(capabilities.seed),
    quality: Boolean(capabilities.quality),
    responseFormatB64: Boolean(capabilities.responseFormatB64),
    responseFormatUrl: Boolean(capabilities.responseFormatUrl),
    videoGeneration: Boolean(capabilities.videoGeneration),
    image: capabilities.image || {},
    video: capabilities.video || {},
  };
}

function pickModel(providerId, requestedModel, models) {
  if (requestedModel) return requestedModel;
  if (models[0]?.id) return models[0].id;
  return getProviderDefaultModels(providerId)[0] || '';
}

function createApiKeyTestService({
  joinUrl,
  proxyRequest,
  readSecrets,
  resolveApiCredentials,
}) {
  async function resolveCredentials({ req, userId, apiKeyId, providerId }) {
    const secrets = await readSecrets();
    const credentials = await resolveApiCredentials({
      userId,
      body: {
        apiKeyId,
        providerId,
      },
      secrets,
    });
    const provider = getProviderTemplate(credentials.providerId || providerId) || getProviderTemplate(providerId);
    return {
      ...credentials,
      provider,
      baseUrl: credentials.baseUrl || provider?.defaultBaseUrl || '',
      req,
    };
  }

  async function testModelList({ baseUrl, apiKey, provider }) {
    const modelsEndpoint = provider?.endpoints?.models;
    if (!modelsEndpoint) {
      return {
        ok: true,
        skipped: true,
        method: 'not_available',
        networkRequest: false,
        billable: false,
        reason: 'Provider does not expose a model-list endpoint template.',
        count: 0,
        models: [],
      };
    }

    const result = await proxyRequest(joinUrl(baseUrl, modelsEndpoint), {
      method: 'GET',
      headers: authHeadersForProvider(provider, apiKey),
    });
    const models = normalizeModelItems(result.data);

    return {
      ok: result.status < 400,
      method: 'model_list',
      networkRequest: true,
      billable: false,
      status: result.status,
      count: models.length,
      models: models.slice(0, 20),
      ...(result.status >= 400 ? { error: safeUpstreamErrorMessage(result, 'Model list request failed.') } : {}),
    };
  }

  async function testTextPing({ baseUrl, apiKey, provider, model }) {
    if (!model) {
      return {
        ok: false,
        skipped: true,
        method: 'not_requested',
        networkRequest: false,
        billable: false,
        reason: 'No model was selected for text ping.',
      };
    }

    const adapter = getTextProviderAdapter(provider?.id || 'openai-compatible', provider?.requestFormat);
    const body = {
      providerId: provider?.id,
      model,
      max_tokens: 8,
      messages: [
        {
          role: 'user',
          content: 'Reply with OK.',
        },
      ],
    };
    const request = adapter.buildRequest({ apiKey, body, providerId: provider?.id });
    const result = await proxyRequest(joinUrl(baseUrl, adapter.endpoint(provider?.id)), {
      method: 'POST',
      headers: request.headers,
      body: request.body,
    });

    return {
      ok: result.status < 400,
      method: 'text_ping',
      networkRequest: true,
      billable: true,
      status: result.status,
      ...(result.status >= 400 ? { error: safeUpstreamErrorMessage(result, 'Text ping request failed.') } : {}),
    };
  }

  async function testApiKey({
    req,
    userId,
    apiKeyId,
    providerId,
    model = '',
    testText = false,
    testImage = false,
    testVideo = false,
  }) {
    const credentials = await resolveCredentials({ req, userId, apiKeyId, providerId });
    if (!credentials.baseUrl) {
      throw Object.assign(new Error('Base URL is required for this provider.'), { status: 400, expose: true });
    }
    if (!credentials.apiKey) {
      throw Object.assign(new Error('API key is required.'), { status: 400, expose: true });
    }

    const modelList = await testModelList(credentials);
    const selectedModel = pickModel(credentials.providerId, model, modelList.models || []);
    const capabilities = getModelCapabilities(credentials.providerId, selectedModel);
    const canTextPing = testText && capabilities.chat;
    const text = canTextPing
      ? await testTextPing({ ...credentials, model: selectedModel })
      : {
        ok: Boolean(capabilities.chat),
        skipped: true,
        method: testText ? 'capability_table' : 'not_requested',
        networkRequest: false,
        billable: false,
        reason: testText ? 'Selected model is not marked as supporting chat.' : 'Text ping was not requested.',
      };
    const image = testImage
      ? {
        ok: Boolean(capabilities.imageGeneration),
        skipped: true,
        method: 'capability_table',
        networkRequest: false,
        billable: false,
        reason: capabilities.imageGeneration
          ? 'Image capability check passed from the model capability table. No paid image generation was started.'
          : 'Selected model is not marked as supporting image generation.',
      }
      : {
        ok: Boolean(capabilities.imageGeneration),
        skipped: true,
        method: 'not_requested',
        networkRequest: false,
        billable: false,
        reason: 'Image capability check was not requested.',
      };
    const video = testVideo
      ? {
        ok: Boolean(capabilities.videoGeneration),
        skipped: true,
        method: 'capability_table',
        networkRequest: false,
        billable: false,
        reason: capabilities.videoGeneration
          ? 'Video capability check passed from the model capability table. No paid video generation was started.'
          : 'Selected model is not marked as supporting video generation.',
      }
      : {
        ok: Boolean(capabilities.videoGeneration),
        skipped: true,
        method: 'not_requested',
        networkRequest: false,
        billable: false,
        reason: 'Video capability check was not requested.',
      };

    return {
      apiKeyId,
      providerId: credentials.providerId,
      baseUrl: credentials.baseUrl,
      selectedModel,
      models: modelList,
      capabilities: publicCapabilities(capabilities),
      tests: {
        credentials: {
          ok: modelList.ok || modelList.skipped,
        },
        text,
        image,
        video,
      },
    };
  }

  return {
    testApiKey,
  };
}

module.exports = {
  createApiKeyTestService,
};
