const { toPublicAssetUrl } = require('./mediaUrlService.cjs');

function normalizeArkContent(body, req) {
  const content = [];
  const prompt = String(body.prompt || body.text || '').trim();

  if (prompt) {
    content.push({ type: 'text', text: prompt });
  }

  const images = Array.isArray(body.images) ? body.images : [];
  for (const image of images) {
    const url = toPublicAssetUrl(req, typeof image === 'string' ? image : image?.url);
    if (!url) continue;
    content.push({
      type: 'image_url',
      image_url: { url },
      role: 'reference_image',
    });
  }

  if (body.referenceVideoUrl) {
    content.push({
      type: 'video_url',
      video_url: { url: toPublicAssetUrl(req, body.referenceVideoUrl) },
      role: 'reference_video',
    });
  }

  if (body.referenceAudioUrl) {
    content.push({
      type: 'audio_url',
      audio_url: { url: toPublicAssetUrl(req, body.referenceAudioUrl) },
      role: 'reference_audio',
    });
  }

  return content;
}

function publicMediaReference(value, req) {
  const raw = typeof value === 'string' ? value : value?.url || value?.file_id || value?.fileId || '';
  const url = toPublicAssetUrl(req, raw);
  if (!url) return null;
  if (/^file_[a-z0-9_-]+$/i.test(url)) return { file_id: url };
  return { url };
}

function contentText(content = []) {
  const textItem = Array.isArray(content) ? content.find((item) => item?.type === 'text' && item.text) : null;
  return String(textItem?.text || '').trim();
}

function contentImageReferences(content = [], req) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((item) => item?.type === 'image_url')
    .map((item) => publicMediaReference(item.image_url?.url || item.url || '', req))
    .filter(Boolean);
}

function normalizeBailianImageUrl(image, req) {
  if (!image) return '';
  return toPublicAssetUrl(req, typeof image === 'string' ? image : image.url || '');
}

function isBailianWan27ImageToVideoModel(model) {
  return /^wan2\.7-.*i2v/i.test(String(model || ''));
}

function buildBailianMedia(images, body, req) {
  const imageUrls = images.map((image) => normalizeBailianImageUrl(image, req)).filter(Boolean);
  const media = [];

  if (imageUrls[0]) media.push({ type: 'first_frame', url: imageUrls[0] });
  if (imageUrls[1]) media.push({ type: 'last_frame', url: imageUrls[1] });
  if (body.referenceAudioUrl) media.push({ type: 'driving_audio', url: toPublicAssetUrl(req, body.referenceAudioUrl) });
  if (body.referenceVideoUrl) media.push({ type: 'first_clip', url: toPublicAssetUrl(req, body.referenceVideoUrl) });

  return media;
}

function buildBailianVideoBody(body, req) {
  const images = Array.isArray(body.images) ? body.images : [];
  const input = {
    prompt: String(body.prompt || body.text || '').trim(),
  };
  const isWan27ImageToVideo = isBailianWan27ImageToVideoModel(body.model);

  const imageUrls = images.map((image) => normalizeBailianImageUrl(image, req)).filter(Boolean);
  if (body.negative_prompt) input.negative_prompt = body.negative_prompt;

  if (isWan27ImageToVideo) {
    input.media = buildBailianMedia(images, body, req);
  } else {
    if (imageUrls.length > 0) input.img_url = imageUrls[0];
    if (body.referenceAudioUrl) input.audio_url = toPublicAssetUrl(req, body.referenceAudioUrl);
    if (body.referenceVideoUrl) input.video_url = toPublicAssetUrl(req, body.referenceVideoUrl);
  }

  const parameters = {};
  if (body.ratio || body.aspectRatio) parameters.ratio = body.ratio || body.aspectRatio;
  if (body.resolution) parameters.resolution = body.resolution;
  if (body.duration) parameters.duration = Number(body.duration);
  if (body.seed) parameters.seed = Number(body.seed);
  if (typeof body.watermark === 'boolean') parameters.watermark = body.watermark;
  if (typeof body.promptExtend === 'boolean') parameters.prompt_extend = body.promptExtend;
  if (typeof body.prompt_extend === 'boolean') parameters.prompt_extend = body.prompt_extend;

  return {
    model: body.model,
    input,
    parameters,
  };
}

function buildBailianContentForValidation(body) {
  const content = [];
  if (body.prompt || body.text) content.push({ type: 'text' });
  const images = Array.isArray(body.images) ? body.images : [];
  for (const image of images) {
    if (normalizeBailianImageUrl(image)) content.push({ type: 'image_url' });
  }
  if (body.referenceVideoUrl) content.push({ type: 'video_url' });
  if (body.referenceAudioUrl) content.push({ type: 'audio_url' });
  return content;
}

function summarizeVideoUpstream(data) {
  const taskId = data?.request_id || data?.requestId || data?.id || data?.task_id || data?.taskId || data?.output?.task_id || data?.output?.id || data?.data?.id;
  const status = data?.status || data?.task_status || data?.output?.task_status || data?.output?.status || data?.data?.status;
  return {
    ...(taskId ? { taskId: String(taskId) } : {}),
    ...(status ? { status: String(status) } : {}),
  };
}

function normalizeVideoStatus(data) {
  const raw = String(
    data?.status ||
    data?.task_status ||
    data?.output?.task_status ||
    data?.output?.status ||
    data?.data?.status ||
    ''
  ).toLowerCase();

  if (['succeeded', 'success', 'completed', 'complete', 'done'].includes(raw)) return 'succeeded';
  if (['failed', 'failure', 'error'].includes(raw)) return 'failed';
  if (['cancelled', 'canceled'].includes(raw)) return 'cancelled';
  return 'running';
}

function findFirstVideoUrl(value, depth = 0) {
  if (!value || depth > 8) return '';
  if (typeof value === 'string') {
    return /^https?:\/\//i.test(value) && /\.(mp4|mov|webm)(\?|#|$)/i.test(value) ? value : '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstVideoUrl(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';

  const videoUrl = value.video_url || value.videoUrl || value.output_video || value.outputVideo;
  if (typeof videoUrl === 'string' && /^https?:\/\//i.test(videoUrl)) return videoUrl;
  if (videoUrl && typeof videoUrl === 'object') {
    const nested = findFirstVideoUrl(videoUrl, depth + 1);
    if (nested) return nested;
  }

  for (const key of ['url', 'file_url', 'fileUrl']) {
    if (typeof value[key] === 'string' && /^https?:\/\//i.test(value[key]) && /\.(mp4|mov|webm)(\?|#|$)/i.test(value[key])) {
      return value[key];
    }
  }

  for (const item of Object.values(value)) {
    const found = findFirstVideoUrl(item, depth + 1);
    if (found) return found;
  }
  return '';
}

function commonArkBody(body, content) {
  const promptExtend = body.promptExtend ?? body.prompt_extend;
  const seed = body.seed;
  const negativePrompt = body.negativePrompt || body.negative_prompt || '';
  return {
    model: body.model,
    __workbenchMode: body.mode || '',
    content,
    generate_audio: body.generateAudio ?? body.generate_audio ?? false,
    ratio: body.ratio || body.aspectRatio || '16:9',
    resolution: body.resolution || undefined,
    duration: Number(body.duration || 5),
    watermark: body.watermark ?? false,
    prompt_extend: typeof promptExtend === 'boolean' ? promptExtend : undefined,
    seed: seed ? Number(seed) : undefined,
    negative_prompt: negativePrompt || undefined,
  };
}

function normalizeXaiResolution(value) {
  const text = String(value || '').trim();
  return text ? text.toLowerCase() : undefined;
}

function buildXaiVideoBody(originalBody, body, req) {
  const references = contentImageReferences(body.content, req);
  const prompt = contentText(body.content) || String(originalBody.prompt || originalBody.text || '').trim();
  const requestBody = {
    model: body.model,
    prompt,
  };
  const mode = originalBody.mode || originalBody.__workbenchMode || '';

  if (Number.isFinite(Number(body.duration))) requestBody.duration = Number(body.duration);
  if (body.ratio) requestBody.aspect_ratio = body.ratio;
  if (body.resolution) requestBody.resolution = normalizeXaiResolution(body.resolution);

  if (references.length === 1 && mode === 'image-to-video') {
    requestBody.image = references[0];
  } else if (references.length > 0) {
    requestBody.reference_images = references;
  }

  return requestBody;
}

const adapters = {
  seedance: {
    id: 'seedance',
    defaultBaseUrl(secrets = {}) {
      return secrets.videoBaseUrl || secrets.arkBaseUrl || 'https://ark.cn-beijing.volces.com';
    },
    buildCapabilityBody({ body, req }) {
      return commonArkBody(body, Array.isArray(body.content) ? body.content : normalizeArkContent(body, req));
    },
    buildCreateRequest({ body, apiKey }) {
      return {
        endpoint: '/api/v3/contents/generations/tasks',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body,
      };
    },
    buildQueryRequest({ taskId, apiKey }) {
      return {
        endpoint: `/api/v3/contents/generations/tasks/${taskId}`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      };
    },
    extractVideoUrl: findFirstVideoUrl,
    normalizeStatus: normalizeVideoStatus,
    summarizeUpstream: summarizeVideoUpstream,
  },
  'aliyun-bailian': {
    id: 'aliyun-bailian',
    defaultBaseUrl(secrets = {}) {
      return secrets.bailianBaseUrl || 'https://dashscope.aliyuncs.com';
    },
    buildCapabilityBody({ body }) {
      return commonArkBody(body, buildBailianContentForValidation(body));
    },
    buildCreateRequest({ originalBody, body, req, apiKey }) {
      return {
        endpoint: '/api/v1/services/aigc/video-generation/video-synthesis',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-DashScope-Async': 'enable',
        },
        body: buildBailianVideoBody({
          ...originalBody,
          ratio: body.ratio,
          resolution: body.resolution,
          duration: body.duration,
          watermark: body.watermark,
          prompt_extend: body.prompt_extend,
          seed: body.seed,
          negative_prompt: body.negative_prompt,
        }, req),
      };
    },
    buildQueryRequest({ taskId, apiKey }) {
      return {
        endpoint: `/api/v1/tasks/${taskId}`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      };
    },
    extractVideoUrl: findFirstVideoUrl,
    normalizeStatus: normalizeVideoStatus,
    summarizeUpstream: summarizeVideoUpstream,
  },
  xai: {
    id: 'xai',
    defaultBaseUrl(secrets = {}) {
      return secrets.xaiBaseUrl || 'https://api.x.ai';
    },
    buildCapabilityBody({ body, req }) {
      return commonArkBody(body, Array.isArray(body.content) ? body.content : normalizeArkContent(body, req));
    },
    buildCreateRequest({ originalBody, body, req, apiKey }) {
      return {
        endpoint: '/v1/videos/generations',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: buildXaiVideoBody(originalBody || {}, body, req),
      };
    },
    buildQueryRequest({ taskId, apiKey }) {
      return {
        endpoint: `/v1/videos/${encodeURIComponent(taskId)}`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      };
    },
    extractVideoUrl: findFirstVideoUrl,
    normalizeStatus: normalizeVideoStatus,
    summarizeUpstream: summarizeVideoUpstream,
  },
};

function getVideoProviderAdapter(providerId, adapterId = '') {
  if (adapterId === 'xai-video') return adapters.xai;
  if (adapterId === 'dashscope-video') return adapters['aliyun-bailian'];
  if (adapterId === 'seedance-video') return adapters.seedance;
  return adapters[providerId] || adapters.seedance;
}

module.exports = {
  buildBailianContentForValidation,
  buildBailianVideoBody,
  buildXaiVideoBody,
  findFirstVideoUrl,
  getVideoProviderAdapter,
  normalizeArkContent,
  normalizeVideoStatus,
  summarizeVideoUpstream,
};
