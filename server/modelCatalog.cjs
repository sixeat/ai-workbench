const { resolveModelCapabilitiesDetailed } = require('./modelCapabilities.cjs');
const { getProviderTemplate } = require('./providerRegistry.cjs');

const BOOLEAN_CAPABILITIES = [
  'chat',
  'imageGeneration',
  'imageReference',
  'multiImageReference',
  'negativePrompt',
  'quality',
  'responseFormatB64',
  'responseFormatUrl',
  'seed',
  'videoGeneration',
];

const SECTION_LIST_FIELDS = {
  image: ['imageFormats', 'outputFormats', 'sizeAliases', 'sizes'],
  video: ['audioFormats', 'imageFormats', 'mediaTypes', 'modes', 'outputFormats', 'ratios', 'resolutions', 'taskTypes', 'videoFormats'],
};

const SECTION_BOOLEAN_FIELDS = {
  image: [
    'supportsPromptExtend',
    'supportsSequential',
    'supportsThinkingMode',
    'supportsTransparentBackground',
    'supportsWatermark',
  ],
  text: ['supportsVisionInput'],
  video: [
    'supportsAudioGeneration',
    'supportsNegativePrompt',
    'supportsPromptExtend',
    'supportsReferenceAudio',
    'supportsReferenceImage',
    'supportsReferenceVideo',
    'supportsSeed',
    'supportsVideoEditing',
    'supportsVideoExtension',
    'supportsWatermark',
  ],
};

const SECTION_MAX_FIELDS = {
  image: ['maxAspectRatio', 'maxImageFileMb', 'maxImages', 'maxPixels', 'maxReferenceImages'],
  video: [
    'audioDurationMax',
    'audioMaxFileMb',
    'durationMax',
    'imageMaxFileMb',
    'imageMaxSide',
    'maxMediaFiles',
    'maxReferenceAudios',
    'maxReferenceImages',
    'maxReferenceVideos',
    'negativePromptMaxChars',
    'promptMaxChars',
    'videoMaxFileMb',
  ],
  text: ['contextWindow', 'maxOutputTokens'],
};

const SECTION_MIN_FIELDS = {
  image: ['minAspectRatio', 'minPixels'],
  video: ['audioDurationMin', 'durationMin', 'imageMinSide'],
};

function hasDeclaredOperation(capabilities = {}) {
  return Boolean(capabilities.chat || capabilities.imageGeneration || capabilities.videoGeneration);
}

function operationForCapabilities(capabilities = {}) {
  if (capabilities.videoGeneration) return 'videoGeneration';
  if (capabilities.imageGeneration) return 'imageGeneration';
  if (capabilities.chat) return 'chat';
  return '';
}

function fallbackCapabilities(providerId) {
  const provider = getProviderTemplate(providerId);
  if (provider?.category === 'text') {
    return { chat: true, imageGeneration: false, videoGeneration: false, image: {}, video: {} };
  }
  if (provider?.category === 'image') {
    return { chat: false, imageGeneration: true, videoGeneration: false, image: {}, video: {} };
  }
  if (providerId === 'xai') {
    return { chat: true, imageGeneration: false, videoGeneration: false, image: {}, video: {} };
  }
  return null;
}

const ADAPTER_OPERATIONS = Object.freeze({
  'anthropic-messages': 'chat',
  'dashscope-image': 'imageGeneration',
  'dashscope-video': 'videoGeneration',
  'openai-chat': 'chat',
  'openai-image': 'imageGeneration',
  'seedance-video': 'videoGeneration',
  'xai-video': 'videoGeneration',
});

function isSupportedAdapterId(adapterId) {
  return Boolean(ADAPTER_OPERATIONS[String(adapterId || '').trim()]);
}

function adapterSupportsCapabilities(adapterId, capabilities = {}) {
  const operation = ADAPTER_OPERATIONS[String(adapterId || '').trim()];
  return Boolean(operation && capabilities[operation] === true);
}

function adapterIdForModel(providerId, capabilities = {}) {
  const provider = getProviderTemplate(providerId);
  if (capabilities.videoGeneration) {
    if (providerId === 'xai') return 'xai-video';
    if (providerId === 'aliyun-bailian') return 'dashscope-video';
    if (providerId === 'seedance') return 'seedance-video';
    return '';
  }
  if (capabilities.imageGeneration) {
    if (providerId === 'aliyun-bailian') return 'dashscope-image';
    if (provider?.requestFormat === 'openai' && provider?.endpoints?.image) return 'openai-image';
    return '';
  }
  if (providerId === 'anthropic') return 'anthropic-messages';
  if (provider?.requestFormat === 'openai' || provider?.requestFormat === 'dashscope') return 'openai-chat';
  return '';
}

function looksLikeMediaModel(upstreamModel) {
  return /(?:image|imagine|video|dall-e|diffusion|seedance|t2i|i2v|t2v|wanx)/i.test(String(upstreamModel || ''));
}

function classifyApiKeyModel(providerId, upstreamModel, rawMetadata = {}, existing = null) {
  if (existing?.capabilitySource === 'manual' && hasDeclaredOperation(existing.capabilities)) {
    return {
      adapterId: existing.adapterId || adapterIdForModel(existing.modelProviderId || providerId, existing.capabilities),
      capabilities: existing.capabilities,
      capabilitySource: 'manual',
      discoveryStatus: 'active',
      modelProviderId: existing.modelProviderId || providerId,
    };
  }

  const resolved = resolveModelCapabilitiesDetailed(providerId, upstreamModel);
  const fallback = resolved.matchedRules.length === 0 ? fallbackCapabilities(providerId) : null;
  const capabilities = fallback || resolved.capabilities;
  const hasSpecificRule = resolved.matchedRules.some((rule) => rule.modelPattern !== '*');
  const inferredAdapterId = adapterIdForModel(providerId, capabilities);
  const mediaModelUsingTextFallback = looksLikeMediaModel(upstreamModel)
    && !hasSpecificRule
    && capabilities.chat
    && !capabilities.imageGeneration
    && !capabilities.videoGeneration;
  const known = !mediaModelUsingTextFallback
    && hasDeclaredOperation(capabilities)
    && adapterSupportsCapabilities(inferredAdapterId, capabilities);
  return {
    adapterId: known ? inferredAdapterId : '',
    capabilities: known ? capabilities : {},
    capabilitySource: resolved.matchedRules.length > 0 ? 'matched-rules' : fallback ? 'provider-default' : 'fallback',
    discoveryStatus: known ? 'active' : 'unknown',
    modelProviderId: String(rawMetadata.providerId || providerId).trim() || providerId,
  };
}

function capabilityContractIssues(offering = {}, contract = {}) {
  const issues = [];
  for (const key of BOOLEAN_CAPABILITIES) {
    if (contract[key] === true && offering[key] !== true) issues.push(`${key} is required`);
  }

  for (const section of ['image', 'video', 'text']) {
    const routeSection = offering[section] && typeof offering[section] === 'object' ? offering[section] : {};
    const contractSection = contract[section] && typeof contract[section] === 'object' ? contract[section] : {};

    for (const field of SECTION_BOOLEAN_FIELDS[section] || []) {
      if (contractSection[field] === true && routeSection[field] !== true) {
        issues.push(`${section}.${field} is required`);
      }
    }

    for (const field of SECTION_LIST_FIELDS[section] || []) {
      const required = Array.isArray(contractSection[field]) ? contractSection[field] : [];
      const supported = new Set(Array.isArray(routeSection[field]) ? routeSection[field].map(String) : []);
      for (const item of required) {
        if (!supported.has(String(item))) issues.push(`${section}.${field} does not support ${item}`);
      }
    }

    for (const field of SECTION_MAX_FIELDS[section] || []) {
      const required = Number(contractSection[field] || 0);
      const supported = Number(routeSection[field] || 0);
      if (required > 0 && (supported <= 0 || supported < required)) {
        issues.push(`${section}.${field} must be at least ${required}`);
      }
    }

    for (const field of SECTION_MIN_FIELDS[section] || []) {
      const required = Number(contractSection[field] || 0);
      const supported = Number(routeSection[field] || 0);
      if (required > 0 && (supported <= 0 || supported > required)) {
        issues.push(`${section}.${field} must be no more than ${required}`);
      }
    }
  }

  return issues;
}

function keyAllowsCapability(apiKey, capability) {
  const allowed = apiKey?.allowedCapabilities;
  if (!allowed || typeof allowed !== 'object' || Object.keys(allowed).length === 0) return true;
  return allowed[capability] === true;
}

function modelSupportsNodeType(model, nodeType) {
  const capabilities = model?.capabilities || {};
  if (['textModel', 'script', 'shotSplit', 'promptOptimize'].includes(nodeType)) {
    return Boolean(capabilities.chat && keyAllowsCapability(model.apiKey, 'chat'));
  }
  if (nodeType === 'imageGen') {
    return Boolean(capabilities.imageGeneration && keyAllowsCapability(model.apiKey, 'imageGeneration'));
  }
  if (nodeType === 'imageToImage') {
    return Boolean(
      capabilities.imageGeneration
      && capabilities.imageReference
      && keyAllowsCapability(model.apiKey, 'imageGeneration')
      && keyAllowsCapability(model.apiKey, 'imageReference')
    );
  }
  if (nodeType === 'videoGen') {
    return Boolean(capabilities.videoGeneration && keyAllowsCapability(model.apiKey, 'videoGeneration'));
  }
  if (nodeType === 'multiImageVideo') {
    return Boolean(
      capabilities.videoGeneration
      && (capabilities.multiImageReference || capabilities.video?.maxReferenceImages > 1)
      && keyAllowsCapability(model.apiKey, 'videoGeneration')
      && keyAllowsCapability(model.apiKey, 'multiImageReference')
    );
  }
  return true;
}

module.exports = {
  ADAPTER_OPERATIONS,
  adapterSupportsCapabilities,
  adapterIdForModel,
  capabilityContractIssues,
  classifyApiKeyModel,
  hasDeclaredOperation,
  isSupportedAdapterId,
  keyAllowsCapability,
  modelSupportsNodeType,
  operationForCapabilities,
};
