const { getProviderTemplate } = require('../providerRegistry.cjs');

const INTERNAL_FIELDS = new Set([
  'apiKey',
  'apiKeyId',
  'baseUrl',
  'hasSystem',
  'messageCount',
  'parentTaskId',
  'platformModelId',
  'publicBaseUrl',
  'providerId',
  'requestKind',
  'retryOf',
  'sourceTaskId',
  'upstreamTaskId',
  'upstreamTaskIds',
  'userId',
]);

function stripInternalFields(body = {}) {
  const result = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (!INTERNAL_FIELDS.has(key)) result[key] = value;
  }
  return result;
}

function providerChatEndpoint(providerId, fallback) {
  return getProviderTemplate(providerId)?.endpoints?.chat || fallback;
}

const adapters = {
  anthropic: {
    id: 'anthropic',
    endpoint(providerId = 'anthropic') {
      return providerChatEndpoint(providerId, '/v1/messages');
    },
    buildRequest({ apiKey, body }) {
      return {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: stripInternalFields(body),
      };
    },
  },
  'openai-compatible': {
    id: 'openai-compatible',
    endpoint(providerId = 'openai-compatible') {
      return providerChatEndpoint(providerId, '/v1/chat/completions');
    },
    buildRequest({ apiKey, body }) {
      return {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: stripInternalFields(body),
      };
    },
  },
};

const openAiCompatibleProviderIds = new Set([
  'aliyun-bailian',
  'custom',
  'moonshot',
  'siliconflow',
]);

function getTextProviderAdapter(providerId, requestFormat) {
  if (requestFormat === 'anthropic' || providerId === 'anthropic') return adapters.anthropic;
  if (adapters[providerId]) return adapters[providerId];
  if (openAiCompatibleProviderIds.has(providerId)) return adapters['openai-compatible'];
  return adapters['openai-compatible'];
}

module.exports = {
  getTextProviderAdapter,
  stripInternalFields,
};
