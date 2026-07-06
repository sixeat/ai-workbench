const { toPublicAssetUrl } = require('./mediaUrlService.cjs');

function normalizeBailianImageUrl(image, req) {
  if (!image) return '';
  return toPublicAssetUrl(req, typeof image === 'string' ? image : image.url || '');
}

function normalizeOpenAiImageBody(body, req) {
  return {
    ...body,
    ...(body.reference_image ? { reference_image: toPublicAssetUrl(req, body.reference_image) } : {}),
    ...(Array.isArray(body.reference_images)
      ? { reference_images: body.reference_images.map((image) => toPublicAssetUrl(req, image)) }
      : {}),
  };
}

function buildBailianImageBody(body, req) {
  const referenceImages = [
    ...(body.reference_image ? [body.reference_image] : []),
    ...(Array.isArray(body.reference_images) ? body.reference_images : []),
  ].map((image) => normalizeBailianImageUrl(image, req)).filter(Boolean);

  const content = [{ text: String(body.prompt || '').trim() }];
  for (const url of referenceImages) {
    content.push({ image: url });
  }

  const parameters = {};
  if (body.size) parameters.size = body.size;
  if (body.n) parameters.n = Number(body.n);
  if (body.seed) parameters.seed = Number(body.seed);
  if (typeof body.watermark === 'boolean') parameters.watermark = body.watermark;
  if (typeof body.prompt_extend === 'boolean') parameters.prompt_extend = body.prompt_extend;
  if (typeof body.enable_sequential === 'boolean') parameters.enable_sequential = body.enable_sequential;
  if (typeof body.thinking_mode === 'boolean') parameters.thinking_mode = body.thinking_mode;

  return {
    model: body.model,
    input: {
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    },
    parameters,
  };
}

function extractOpenAiImageItems(data) {
  return Array.isArray(data?.data) ? data.data : [];
}

function extractBailianImageItems(data) {
  const choices = data?.output?.choices || data?.output?.choice || [];
  const items = [];

  for (const choice of Array.isArray(choices) ? choices : [choices]) {
    const content = choice?.message?.content || choice?.content || [];
    for (const item of Array.isArray(content) ? content : [content]) {
      const url = item?.image || item?.url || item?.image_url;
      if (url) items.push({ url });
    }
  }

  const results = data?.output?.results || data?.output?.images || data?.output?.task_results || [];
  for (const item of Array.isArray(results) ? results : [results]) {
    const url = item?.url || item?.image_url || item?.image;
    if (url) items.push({ url });
  }

  return items;
}

const adapters = {
  'aliyun-bailian': {
    id: 'aliyun-bailian',
    endpoint: '/api/v1/services/aigc/multimodal-generation/generation',
    buildRequest({ apiKey, body, req }) {
      return {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-DashScope-Async': 'disable',
        },
        body: buildBailianImageBody(body, req),
      };
    },
    extractItems: extractBailianImageItems,
  },
  'openai-compatible': {
    id: 'openai-compatible',
    endpoint: '/v1/images/generations',
    buildRequest({ apiKey, body, req }) {
      return {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: normalizeOpenAiImageBody(body, req),
      };
    },
    extractItems: extractOpenAiImageItems,
  },
};

function getImageProviderAdapter(providerId) {
  return adapters[providerId] || adapters['openai-compatible'];
}

module.exports = {
  buildBailianImageBody,
  extractBailianImageItems,
  extractOpenAiImageItems,
  getImageProviderAdapter,
  normalizeOpenAiImageBody,
};
