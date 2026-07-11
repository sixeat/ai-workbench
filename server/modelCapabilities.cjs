const {
  modelCapabilityRepository: defaultModelCapabilityRepository,
} = require('./repositories/modelCapabilityRepository.cjs');

const BASE_CAPABILITIES = {
  chat: true,
  imageGeneration: false,
  imageReference: false,
  multiImageReference: false,
  negativePrompt: false,
  seed: false,
  quality: false,
  responseFormatB64: true,
  responseFormatUrl: true,
  videoGeneration: false,
  image: {},
  video: {},
};

const DEFAULT_CAPABILITY_RULES = [
  {
    label: 'OpenAI 兼容通用',
    description: '适用于 OpenAI 兼容网关的默认文本能力。图片能力必须由 gpt-image、dall-e 等明确规则声明。',
    providerId: 'openai-compatible',
    modelPattern: '*',
    capabilities: {
      chat: true,
      imageGeneration: false,
      imageReference: false,
      multiImageReference: false,
      negativePrompt: false,
      seed: false,
      quality: true,
      responseFormatB64: true,
      responseFormatUrl: true,
      videoGeneration: false,
    },
  },
  {
    label: 'OpenAI GPT Image',
    description: '适用于 gpt-image 系列图片模型，支持参考图和多参考图。',
    providerId: 'openai-compatible',
    modelPattern: 'gpt-image-*',
    capabilities: {
      imageGeneration: true,
      imageReference: true,
      multiImageReference: true,
      negativePrompt: false,
      seed: false,
      quality: true,
      responseFormatB64: true,
      responseFormatUrl: true,
      image: {
        maxImages: 1,
        maxReferenceImages: 16,
      },
    },
  },
  {
    label: 'OpenAI GPT Image 2',
    description: '适用于 gpt-image-2 系列，支持 1K/2K/4K、自定义合法尺寸、多参考图和 b64 返回。',
    providerId: 'openai-compatible',
    modelPattern: 'gpt-image-2*',
    capabilities: {
      chat: false,
      imageGeneration: true,
      imageReference: true,
      multiImageReference: true,
      negativePrompt: false,
      seed: false,
      quality: true,
      responseFormatB64: true,
      responseFormatUrl: false,
      videoGeneration: false,
      image: {
        sizeAliases: ['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840'],
        minPixels: 655360,
        maxPixels: 8294400,
        minAspectRatio: 1 / 3,
        maxAspectRatio: 3,
        maxImages: 1,
        maxReferenceImages: 16,
        imageFormats: ['png', 'jpg', 'jpeg', 'webp'],
        maxImageFileMb: 50,
        maskMaxFileMb: 4,
        outputFormats: ['png', 'jpeg', 'webp'],
        supportsTransparentBackground: false,
      },
    },
  },
  {
    label: 'OpenAI DALL-E',
    description: '适用于 DALL-E 系列图片生成模型，不声明参考图能力。',
    providerId: 'openai-compatible',
    modelPattern: 'dall-e-*',
    capabilities: {
      imageGeneration: true,
      imageReference: false,
      multiImageReference: false,
      negativePrompt: false,
      seed: false,
      quality: true,
      responseFormatB64: true,
      responseFormatUrl: true,
    },
  },
  {
    label: '火山 Seedance 通用视频',
    description: '适用于火山方舟 Seedance 视频任务接口的通用能力。',
    providerId: 'seedance',
    modelPattern: '*',
    capabilities: {
      chat: false,
      imageGeneration: false,
      imageReference: true,
      multiImageReference: true,
      videoGeneration: true,
      video: {
        modes: ['text-to-video', 'image-to-video', 'images-to-video', 'video-editing', 'video-extension'],
        supportsAudioGeneration: true,
        supportsReferenceImage: true,
        supportsReferenceVideo: true,
        supportsReferenceAudio: true,
        maxReferenceImages: 9,
        maxReferenceVideos: 3,
        maxReferenceAudios: 3,
        maxMediaFiles: 12,
        durationMin: 4,
        durationMax: 15,
        resolutions: ['480P', '720P'],
        mediaTypes: ['text', 'image', 'video', 'audio'],
      },
    },
  },
  {
    label: '豆包 Seedance 2.0 Mini',
    description: '按火山方舟 doubao-seedance-2-0-mini 系列维护的视频生成限制。',
    providerId: 'seedance',
    modelPattern: 'doubao-seedance-2-0-mini-*',
    capabilities: {
      chat: false,
      imageGeneration: false,
      imageReference: true,
      multiImageReference: true,
      videoGeneration: true,
      video: {
        durationMin: 4,
        durationMax: 15,
        fps: 24,
        resolutions: ['480P', '720P'],
        ratios: ['16:9', '9:16', '1:1'],
        concurrency: 3,
        rpm: 180,
        supportsAudioGeneration: true,
        supportsReferenceImage: true,
        supportsReferenceVideo: true,
        supportsReferenceAudio: true,
        maxReferenceImages: 9,
        maxReferenceVideos: 3,
        maxReferenceAudios: 3,
        maxMediaFiles: 12,
        supportsVideoEditing: true,
        supportsVideoExtension: true,
        modes: ['text-to-video', 'image-to-video', 'images-to-video', 'video-editing', 'video-extension'],
        taskTypes: ['multimodal_video_generation', 'video_editing', 'video_extension'],
        mediaTypes: ['text', 'image', 'video', 'audio'],
      },
    },
  },
  {
    label: '阿里云百炼通用',
    description: '适用于 DashScope / 百炼兼容模型的默认能力。',
    providerId: 'xai',
    modelPattern: 'grok-imagine-video*',
    capabilities: {
      chat: false,
      imageGeneration: false,
      imageReference: true,
      multiImageReference: true,
      negativePrompt: false,
      seed: false,
      quality: false,
      responseFormatB64: false,
      responseFormatUrl: true,
      videoGeneration: true,
      video: {
        endpointType: 'xai_video_generation',
        modes: ['text-to-video', 'image-to-video', 'images-to-video'],
        durationMin: 6,
        durationMax: 15,
        fps: 24,
        ratios: ['16:9', '9:16'],
        resolutions: ['480P', '720P', '1080P'],
        supportsAudioGeneration: true,
        supportsReferenceImage: true,
        supportsReferenceVideo: false,
        supportsReferenceAudio: false,
        maxReferenceImages: 7,
        supportsNegativePrompt: false,
        supportsPromptExtend: false,
        supportsSeed: false,
        supportsWatermark: false,
        resultUrlTtlHours: 24,
        outputFormats: ['mp4'],
        mediaTypes: ['text', 'image'],
      },
    },
  },
  {
    label: 'Aliyun Bailian General',
    description: 'General DashScope / Bailian fallback capabilities.',
    providerId: 'aliyun-bailian',
    modelPattern: '*',
    capabilities: {
      chat: true,
      imageGeneration: false,
      imageReference: false,
      multiImageReference: false,
      negativePrompt: false,
      seed: false,
      quality: false,
      responseFormatB64: false,
      responseFormatUrl: true,
      videoGeneration: false,
    },
  },
  {
    label: '万相 2.7 图片',
    description: '适用于 wan2.7-image 系列，支持多参考图、seed、水印和顺序生成。',
    providerId: 'aliyun-bailian',
    modelPattern: 'wan2.7-image*',
    capabilities: {
      chat: false,
      imageGeneration: true,
      imageReference: true,
      multiImageReference: true,
      negativePrompt: false,
      seed: true,
      quality: false,
      responseFormatB64: false,
      responseFormatUrl: true,
      image: {
        endpointType: 'dashscope_multimodal_generation',
        sizeAliases: ['1K', '2K'],
        minPixels: 768 * 768,
        maxPixels: 2048 * 2048,
        minAspectRatio: 1 / 8,
        maxAspectRatio: 8,
        maxImages: 12,
        supportsSequential: true,
        supportsThinkingMode: true,
        supportsWatermark: true,
      },
    },
  },
  {
    label: '万相 2.7 图片 Pro',
    description: '适用于 wan2.7-image-pro，扩展到 4K 输出限制。',
    providerId: 'aliyun-bailian',
    modelPattern: 'wan2.7-image-pro',
    capabilities: {
      image: {
        sizeAliases: ['1K', '2K', '4K'],
        maxPixels: 4096 * 4096,
      },
    },
  },
  {
    label: '万相 2.6 图片',
    description: '适用于 wan2.6-image，支持反向词、seed 和提示词改写。',
    providerId: 'aliyun-bailian',
    modelPattern: 'wan2.6-image',
    capabilities: {
      chat: false,
      imageGeneration: true,
      imageReference: true,
      multiImageReference: true,
      negativePrompt: true,
      seed: true,
      quality: false,
      responseFormatB64: false,
      responseFormatUrl: true,
      image: {
        endpointType: 'dashscope_multimodal_generation',
        sizeAliases: ['1K', '2K'],
        minPixels: 768 * 768,
        maxPixels: 2048 * 2048,
        minAspectRatio: 1 / 4,
        maxAspectRatio: 4,
        maxImages: 4,
        supportsPromptExtend: true,
        supportsWatermark: true,
      },
    },
  },
  {
    label: '万相文生视频',
    description: '适用于 wan*-t2v* 文生视频模型，限制时长、比例、分辨率和音频能力。',
    providerId: 'aliyun-bailian',
    modelPattern: 'wan*-t2v*',
    capabilities: {
      chat: false,
      imageGeneration: false,
      imageReference: false,
      multiImageReference: false,
      videoGeneration: true,
      video: {
        endpointType: 'dashscope_video_synthesis',
        modes: ['text-to-video'],
        durationMin: 2,
        durationMax: 15,
        fps: 30,
        ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        resolutions: ['720P', '1080P'],
        supportsAudioGeneration: false,
        supportsReferenceImage: false,
        supportsReferenceVideo: false,
        supportsReferenceAudio: true,
        supportsNegativePrompt: true,
        supportsPromptExtend: true,
        supportsSeed: true,
        supportsWatermark: true,
      },
    },
  },
  {
    label: '万相 2.7 文生视频',
    description: '适用于 wan2.7-t2v 系列，补充官方文档里的自定义音频、提示词和结果链接限制。',
    providerId: 'aliyun-bailian',
    modelPattern: 'wan2.7-t2v*',
    capabilities: {
      chat: false,
      imageGeneration: false,
      imageReference: false,
      multiImageReference: false,
      videoGeneration: true,
      video: {
        endpointType: 'dashscope_video_synthesis',
        modes: ['text-to-video'],
        durationMin: 2,
        durationMax: 15,
        fps: 30,
        ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        resolutions: ['720P', '1080P'],
        supportsAudioGeneration: false,
        autoAudioByDefault: true,
        supportsReferenceImage: false,
        supportsReferenceVideo: false,
        supportsReferenceAudio: true,
        maxReferenceAudios: 1,
        supportsNegativePrompt: true,
        supportsPromptExtend: true,
        supportsSeed: true,
        supportsWatermark: true,
        promptMaxChars: 800,
        negativePromptMaxChars: 500,
        audioFormats: ['mp3', 'wav'],
        audioDurationMin: 2,
        audioDurationMax: 30,
        audioMaxFileMb: 15,
        resultUrlTtlHours: 24,
        queryRps: 20,
        outputFormats: ['mp4', 'H.264'],
        mediaTypes: ['text', 'audio_url'],
      },
    },
  },
  {
    label: '万相图生视频',
    description: '适用于 wan*-i2v* 图生视频和首尾帧视频模型，限制最多参考图数量。',
    providerId: 'aliyun-bailian',
    modelPattern: 'wan*-i2v*',
    capabilities: {
      chat: false,
      imageGeneration: false,
      imageReference: true,
      multiImageReference: true,
      videoGeneration: true,
      video: {
        endpointType: 'dashscope_video_synthesis',
        protocol: 'media',
        modes: ['image-to-video', 'images-to-video', 'video-extension'],
        durationMin: 2,
        durationMax: 15,
        fps: 30,
        resolutions: ['720P', '1080P'],
        supportsAudioGeneration: false,
        supportsReferenceImage: true,
        supportsReferenceVideo: true,
        supportsReferenceAudio: true,
        maxReferenceImages: 2,
        supportsNegativePrompt: true,
        supportsPromptExtend: true,
        supportsSeed: true,
        supportsWatermark: true,
        mediaTypes: ['first_frame', 'last_frame', 'driving_audio', 'first_clip'],
      },
    },
  },
  {
    label: '万相 2.7 图生视频',
    description: '适用于 wan2.7-i2v 系列，补充首尾帧、驱动音频和首段视频续写限制。',
    providerId: 'aliyun-bailian',
    modelPattern: 'wan2.7-*-i2v*',
    capabilities: {
      chat: false,
      imageGeneration: false,
      imageReference: true,
      multiImageReference: true,
      videoGeneration: true,
      video: {
        endpointType: 'dashscope_video_synthesis',
        protocol: 'media',
        modes: ['image-to-video', 'images-to-video', 'video-extension'],
        durationMin: 2,
        durationMax: 15,
        fps: 30,
        resolutions: ['720P', '1080P'],
        supportsAudioGeneration: false,
        autoAudioByDefault: true,
        supportsReferenceImage: true,
        supportsReferenceVideo: true,
        supportsReferenceAudio: true,
        maxReferenceImages: 2,
        maxReferenceVideos: 1,
        maxReferenceAudios: 1,
        supportsNegativePrompt: true,
        supportsPromptExtend: true,
        supportsSeed: true,
        supportsWatermark: true,
        promptMaxChars: 800,
        negativePromptMaxChars: 500,
        imageFormats: ['jpg', 'jpeg', 'png', 'webp'],
        imageMaxFileMb: 10,
        imageMinSide: 300,
        imageMaxSide: 5000,
        audioFormats: ['mp3', 'wav'],
        audioDurationMin: 2,
        audioDurationMax: 30,
        audioMaxFileMb: 15,
        videoFormats: ['mp4'],
        videoMaxFileMb: 100,
        resultUrlTtlHours: 24,
        queryRps: 20,
        outputFormats: ['mp4', 'H.264'],
        mediaTypes: ['first_frame', 'last_frame', 'driving_audio', 'first_clip'],
      },
    },
  },
  {
    label: 'Wanx 2.1 Text to Image',
    description: 'DashScope Wanx 2.1 text-to-image models using the image synthesis protocol.',
    providerId: 'aliyun-bailian',
    modelPattern: 'wanx2.1-t2i-*',
    capabilities: {
      chat: false,
      imageGeneration: true,
      imageReference: false,
      multiImageReference: false,
      negativePrompt: true,
      seed: true,
      quality: false,
      responseFormatB64: false,
      responseFormatUrl: true,
      videoGeneration: false,
      image: {
        endpointType: 'dashscope_image_synthesis',
        maxImages: 4,
      },
    },
  },
];

function mergeCapabilities(base, patch) {
  return {
    ...base,
    ...patch,
    video: {
      ...(base.video || {}),
      ...(patch.video || {}),
    },
    image: {
      ...(base.image || {}),
      ...(patch.image || {}),
    },
  };
}

function seedDefaultCapabilities(repository = defaultModelCapabilityRepository) {
  for (const rule of DEFAULT_CAPABILITY_RULES) {
    repository.upsertModelCapability(
      rule.providerId,
      rule.modelPattern,
      mergeCapabilities(BASE_CAPABILITIES, rule.capabilities)
    );
  }
}

function listModelCapabilityPresets() {
  return DEFAULT_CAPABILITY_RULES.map((rule) => ({
    id: `${rule.providerId}:${rule.modelPattern}`,
    label: rule.label || `${rule.providerId} ${rule.modelPattern}`,
    description: rule.description || '',
    providerId: rule.providerId,
    modelPattern: rule.modelPattern,
    capabilities: mergeCapabilities(BASE_CAPABILITIES, rule.capabilities),
  }));
}

function wildcardToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 'i');
}

function resolveModelCapabilitiesDetailed(providerId = 'openai-compatible', model = '', repository = defaultModelCapabilityRepository) {
  const rules = repository.listModelCapabilities().filter((rule) => rule.providerId === providerId);
  let resolved = { ...BASE_CAPABILITIES };
  const matchedRules = [];

  for (const rule of rules) {
    if (rule.modelPattern === '*' || wildcardToRegExp(rule.modelPattern).test(model)) {
      resolved = mergeCapabilities(resolved, rule.capabilities);
      matchedRules.push({
        id: rule.id || `${rule.providerId}:${rule.modelPattern}`,
        providerId: rule.providerId,
        modelPattern: rule.modelPattern,
      });
    }
  }

  return {
    capabilities: resolved,
    matchedRules,
    source: matchedRules.length > 0 ? 'matched-rules' : 'fallback',
  };
}

function getModelCapabilities(providerId = 'openai-compatible', model = '', repository = defaultModelCapabilityRepository) {
  return resolveModelCapabilitiesDetailed(providerId, model, repository).capabilities;
}

function filterImageBodyByCapabilities(body, capabilities) {
  const filtered = { ...body };
  const warnings = [];
  const image = capabilities.image || {};

  if (!capabilities.imageGeneration) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: 'The selected model is not marked as supporting image generation.',
    };
  }

  if (filtered.negative_prompt && !capabilities.negativePrompt) {
    delete filtered.negative_prompt;
    warnings.push('negative_prompt is not supported by this model and was omitted.');
  }

  if (filtered.seed && !capabilities.seed) {
    delete filtered.seed;
    warnings.push('seed is not supported by this model and was omitted.');
  }

  if (filtered.quality && !capabilities.quality) {
    delete filtered.quality;
    warnings.push('quality is not supported by this model and was omitted.');
  }

  const sizeError = filtered.size ? validateImageSize(filtered.size, image) : null;
  if (sizeError) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: sizeError,
    };
  }

  const n = Number(filtered.n || 1);
  if (image.maxImages && Number.isFinite(n) && n > image.maxImages) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: `This model supports at most ${image.maxImages} images per request.`,
    };
  }

  if (filtered.watermark != null && image.supportsWatermark === false) {
    delete filtered.watermark;
    warnings.push('watermark is not supported by this model and was omitted.');
  }

  if (filtered.prompt_extend != null && !image.supportsPromptExtend) {
    delete filtered.prompt_extend;
    warnings.push('prompt_extend is not supported by this model and was omitted.');
  }

  if (filtered.enable_sequential != null && !image.supportsSequential) {
    delete filtered.enable_sequential;
    warnings.push('enable_sequential is not supported by this model and was omitted.');
  }

  if (filtered.thinking_mode != null && !image.supportsThinkingMode) {
    delete filtered.thinking_mode;
    warnings.push('thinking_mode is not supported by this model and was omitted.');
  }

  if (filtered.reference_image && !capabilities.imageReference) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: 'The selected model does not support reference images.',
    };
  }

  if (filtered.reference_images && !capabilities.multiImageReference) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: 'The selected model does not support multiple reference images.',
    };
  }

  if (filtered.response_format === 'b64_json' && !capabilities.responseFormatB64) {
    if (capabilities.responseFormatUrl) {
      filtered.response_format = 'url';
      warnings.push('b64_json response_format is not supported; switched to url.');
    } else {
      delete filtered.response_format;
      warnings.push('response_format is not supported by this model and was omitted.');
    }
  }

  if (filtered.response_format === 'url' && !capabilities.responseFormatUrl) {
    if (capabilities.responseFormatB64) {
      filtered.response_format = 'b64_json';
      warnings.push('url response_format is not supported; switched to b64_json.');
    } else {
      delete filtered.response_format;
      warnings.push('response_format is not supported by this model and was omitted.');
    }
  }

  return { ok: true, body: filtered, warnings };
}

function contentTypeCount(content, type) {
  return Array.isArray(content) ? content.filter((item) => item?.type === type).length : 0;
}

function inferVideoMode(body) {
  const explicitMode = String(body.__workbenchMode || body.mode || '').trim();
  if (explicitMode && explicitMode !== 'auto') return explicitMode;

  if (videoHasReferenceVideo(body)) return 'video-extension';

  const imageCount = videoReferenceImageCount(body);
  if (imageCount > 1) return 'images-to-video';
  if (imageCount === 1) return 'image-to-video';
  return 'text-to-video';
}

function arrayCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function directVideoReferenceImageCount(body) {
  return arrayCount(body.images) +
    arrayCount(body.reference_images) +
    arrayCount(body.referenceImages) +
    (body.reference_image ? 1 : 0) +
    (body.referenceImage ? 1 : 0);
}

function videoReferenceImageCount(body) {
  return Math.max(
    contentTypeCount(body.content, 'image_url'),
    directVideoReferenceImageCount(body)
  );
}

function directVideoReferenceVideoCount(body) {
  return arrayCount(body.videos) +
    arrayCount(body.reference_videos) +
    arrayCount(body.referenceVideos) +
    (body.referenceVideoUrl || body.reference_video_url ? 1 : 0);
}

function videoReferenceVideoCount(body) {
  return Math.max(
    contentTypeCount(body.content, 'video_url'),
    directVideoReferenceVideoCount(body)
  );
}

function directVideoReferenceAudioCount(body) {
  return arrayCount(body.audios) +
    arrayCount(body.reference_audios) +
    arrayCount(body.referenceAudios) +
    (body.referenceAudioUrl || body.reference_audio_url ? 1 : 0);
}

function videoReferenceAudioCount(body) {
  return Math.max(
    contentTypeCount(body.content, 'audio_url'),
    directVideoReferenceAudioCount(body)
  );
}

function videoHasReferenceVideo(body) {
  return videoReferenceVideoCount(body) > 0;
}

function videoHasReferenceAudio(body) {
  return videoReferenceAudioCount(body) > 0;
}

function normalizeListValue(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

function parseImageSize(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d+)\s*[*x]\s*(\d+)$/i);
  if (!match) return null;
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function validateImageSize(size, image) {
  const aliases = normalizeListValue(image.sizeAliases);
  if (aliases.includes(String(size))) return null;

  const allowedSizes = normalizeListValue(image.sizes);
  if (allowedSizes.length > 0 && !allowedSizes.includes(String(size))) {
    return `This model only supports these image sizes: ${allowedSizes.join(', ')}.`;
  }

  const parsed = parseImageSize(size);
  if (!parsed) {
    if (aliases.length > 0) {
      return `This model supports ${aliases.join(', ')} or custom sizes like 2048*2048.`;
    }
    return null;
  }

  const pixels = parsed.width * parsed.height;
  const ratio = parsed.width / parsed.height;
  if (image.minPixels && pixels < image.minPixels) {
    return `This model requires at least ${image.minPixels} total pixels.`;
  }
  if (image.maxPixels && pixels > image.maxPixels) {
    return `This model supports at most ${image.maxPixels} total pixels.`;
  }
  if (image.minAspectRatio && ratio < image.minAspectRatio) {
    return 'This model requires image aspect ratio within 1:8 to 8:1.';
  }
  if (image.maxAspectRatio && ratio > image.maxAspectRatio) {
    return 'This model requires image aspect ratio within 1:8 to 8:1.';
  }
  return null;
}

function filterVideoBodyByCapabilities(body, capabilities) {
  const filtered = { ...body };
  const warnings = [];
  const video = capabilities.video || {};
  const mode = inferVideoMode(filtered);
  delete filtered.__workbenchMode;
  delete filtered.mode;

  if (!capabilities.videoGeneration) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: 'The selected model is not marked as supporting video generation.',
    };
  }

  const modes = normalizeListValue(video.modes);
  if (modes.length > 0 && !modes.includes(mode)) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: `This model only supports these video modes: ${modes.join(', ')}.`,
    };
  }

  const duration = Number(filtered.duration);
  if (Number.isFinite(duration)) {
    if (video.durationMin && duration < video.durationMin) {
      return {
        ok: false,
        body: filtered,
        warnings,
        error: `This model only supports video duration from ${video.durationMin}s to ${video.durationMax || 'unlimited'}s.`,
      };
    }
    if (video.durationMax && duration > video.durationMax) {
      return {
        ok: false,
        body: filtered,
        warnings,
        error: `This model only supports video duration from ${video.durationMin || 0}s to ${video.durationMax}s.`,
      };
    }
  }

  const ratios = normalizeListValue(video.ratios);
  if (filtered.ratio && ratios.length > 0 && !ratios.includes(String(filtered.ratio))) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: `This model only supports these aspect ratios: ${ratios.join(', ')}.`,
    };
  }

  const resolutions = normalizeListValue(video.resolutions);
  if (filtered.resolution && resolutions.length > 0 && !resolutions.includes(String(filtered.resolution))) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: `This model only supports these resolutions: ${resolutions.join(', ')}.`,
    };
  }

  if (filtered.generate_audio && video.supportsAudioGeneration === false) {
    delete filtered.generate_audio;
    warnings.push('generate_audio is not supported by this model and was omitted.');
  }

  if (filtered.watermark != null && video.supportsWatermark === false) {
    delete filtered.watermark;
    warnings.push('watermark is not supported by this model and was omitted.');
  }

  if (filtered.prompt_extend != null && !video.supportsPromptExtend) {
    delete filtered.prompt_extend;
    warnings.push('prompt_extend is not supported by this model and was omitted.');
  }

  if (filtered.seed != null && !video.supportsSeed) {
    delete filtered.seed;
    warnings.push('seed is not supported by this model and was omitted.');
  }

  if (filtered.negative_prompt && !video.supportsNegativePrompt) {
    delete filtered.negative_prompt;
    warnings.push('negative_prompt is not supported by this model and was omitted.');
  }

  const referenceImageCount = videoReferenceImageCount(filtered);

  if (referenceImageCount > 0 && video.supportsReferenceImage === false) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: 'The selected model does not support reference images for video generation.',
    };
  }

  if (video.maxReferenceImages && referenceImageCount > video.maxReferenceImages) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: `This model supports at most ${video.maxReferenceImages} reference images.`,
    };
  }

  if (videoHasReferenceVideo(filtered) && video.supportsReferenceVideo === false) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: 'The selected model does not support reference videos.',
    };
  }

  const referenceVideoCount = videoReferenceVideoCount(filtered);
  if (video.maxReferenceVideos && referenceVideoCount > video.maxReferenceVideos) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: `This model supports at most ${video.maxReferenceVideos} reference videos.`,
    };
  }

  if (videoHasReferenceAudio(filtered) && video.supportsReferenceAudio === false) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: 'The selected model does not support reference audio.',
    };
  }

  const referenceAudioCount = videoReferenceAudioCount(filtered);
  if (video.maxReferenceAudios && referenceAudioCount > video.maxReferenceAudios) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: `This model supports at most ${video.maxReferenceAudios} reference audio files.`,
    };
  }

  const referenceMediaCount = referenceImageCount + referenceVideoCount + referenceAudioCount;
  if (video.maxMediaFiles && referenceMediaCount > video.maxMediaFiles) {
    return {
      ok: false,
      body: filtered,
      warnings,
      error: `This model supports at most ${video.maxMediaFiles} reference media files.`,
    };
  }

  return { ok: true, body: filtered, warnings };
}

seedDefaultCapabilities();

module.exports = {
  BASE_CAPABILITIES,
  resolveModelCapabilitiesDetailed,
  getModelCapabilities,
  filterImageBodyByCapabilities,
  filterVideoBodyByCapabilities,
  listModelCapabilityPresets,
};
