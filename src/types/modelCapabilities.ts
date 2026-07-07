export interface ModelImageCapabilities {
  imageFormats?: string[];
  maxImageFileMb?: number;
  maxImages?: number;
  maxPixels?: number;
  maxReferenceImages?: number;
  minAspectRatio?: number;
  minPixels?: number;
  maxAspectRatio?: number;
  maskMaxFileMb?: number;
  outputFormats?: string[];
  sizeAliases?: string[];
  sizes?: string[];
  supportsPromptExtend?: boolean;
  supportsSequential?: boolean;
  supportsThinkingMode?: boolean;
  supportsTransparentBackground?: boolean;
  supportsWatermark?: boolean;
  [key: string]: unknown;
}

export interface ModelVideoCapabilities {
  audioDurationMax?: number;
  audioDurationMin?: number;
  audioFormats?: string[];
  audioMaxFileMb?: number;
  autoAudioByDefault?: boolean;
  concurrency?: number;
  durationMax?: number;
  durationMin?: number;
  fps?: number;
  imageFormats?: string[];
  imageMaxFileMb?: number;
  imageMaxSide?: number;
  imageMinSide?: number;
  maxMediaFiles?: number;
  maxReferenceAudios?: number;
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  mediaTypes?: string[];
  modes?: string[];
  negativePromptMaxChars?: number;
  outputFormats?: string[];
  promptMaxChars?: number;
  queryRps?: number;
  ratios?: string[];
  resolutions?: string[];
  resultUrlTtlHours?: number;
  rpm?: number;
  supportsAudioGeneration?: boolean;
  supportsNegativePrompt?: boolean;
  supportsPromptExtend?: boolean;
  supportsReferenceAudio?: boolean;
  supportsReferenceImage?: boolean;
  supportsReferenceVideo?: boolean;
  supportsSeed?: boolean;
  supportsWatermark?: boolean;
  taskTypes?: string[];
  videoFormats?: string[];
  videoMaxFileMb?: number;
  [key: string]: unknown;
}

export interface ModelTextCapabilities {
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsVisionInput?: boolean;
  [key: string]: unknown;
}

export interface ModelCapabilities {
  chat?: boolean;
  image?: ModelImageCapabilities;
  imageGeneration?: boolean;
  imageReference?: boolean;
  multiImageReference?: boolean;
  negativePrompt?: boolean;
  quality?: boolean;
  responseFormatB64?: boolean;
  responseFormatUrl?: boolean;
  seed?: boolean;
  text?: ModelTextCapabilities;
  video?: ModelVideoCapabilities;
  videoGeneration?: boolean;
  [key: string]: unknown;
}

export type ModelCapabilitySource = 'route-inferred' | 'platform-override' | 'fallback' | 'matched-rules';

export interface ModelCapabilityRuleMatch {
  id: string;
  providerId: string;
  modelPattern: string;
}
