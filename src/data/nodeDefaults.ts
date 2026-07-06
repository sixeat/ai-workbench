import type { NodeType } from '../types/nodes';

export function getDefaultConfig(type: NodeType): Record<string, any> {
  switch (type) {
    case 'textInput':
      return { content: '' };
    case 'imageInput':
      return { url: '', prompt: '' };
    case 'multiImageInput':
      return { urls: '' };
    case 'promptParam':
      return { prompt: '' };
    case 'negativePromptParam':
      return { negativePrompt: '' };
    case 'styleParam':
      return { style: 'cinematic' };
    case 'sizeParam':
      return { size: '1024x1024' };
    case 'qualityParam':
      return { quality: 'auto' };
    case 'seedParam':
      return { seed: 0 };
    case 'countParam':
      return { count: 1 };
    case 'referenceStrengthParam':
      return { strength: 0.65 };
    case 'shotParam':
      return { camera: 'medium shot, slow dolly in', lighting: 'soft cinematic lighting', character: '' };
    case 'textModel':
      return { prompt: '', instanceId: '', model: 'gpt-4o', temperature: 0.7, maxTokens: 2000 };
    case 'script':
      return { prompt: '', modelSource: 'inherit', instanceId: '', model: 'gpt-4o', scenes: 5, characters: 3, style: '电影感' };
    case 'shotSplit':
      return { count: 5, defaultDuration: 4, modelSource: 'inherit', instanceId: '', model: 'gpt-4o', temperature: 0.5, maxTokens: 2500 };
    case 'promptOptimize':
      return {
        modelSource: 'inherit',
        instanceId: '',
        model: 'gpt-4o',
        prefix: 'high quality, detailed, cinematic composition',
        negativePrompt: 'low quality, blurry, distorted',
        temperature: 0.6,
        maxTokens: 2500,
      };
    case 'imageGen':
      return {
        prompt: '',
        instanceId: '',
        model: 'gpt-image-1',
        size: '1024x1024',
        quality: 'auto',
        responseFormat: 'b64_json',
        n: 1,
        negativePrompt: '',
        style: 'none',
        seed: 0,
        strength: 0.65,
        promptExtend: false,
        enableSequential: false,
        thinkingMode: false,
        watermark: false,
      };
    case 'imageToImage':
      return { prompt: '', instanceId: '', model: 'gpt-image-1', strength: 0.65, size: '1024x1024', quality: 'auto' };
    case 'videoGen':
      return {
        prompt: '',
        instanceId: '',
        model: 'doubao-seedance-2-0-mini-260615',
        mode: 'auto',
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720P',
        motion: 'slow cinematic camera movement',
        referenceVideoUrl: '',
        referenceAudioUrl: '',
        generateAudio: false,
        promptExtend: true,
        seed: 0,
        negativePrompt: '',
        watermark: false,
      };
    case 'multiImageVideo':
      return { prompt: '', instanceId: '', model: 'doubao-seedance-2-0-mini-260615', mode: 'images-to-video', duration: 5, aspectRatio: '16:9', resolution: '720P' };
    case 'preview':
      return { showRaw: false };
    case 'merge':
      return { separator: '\n\n', prefix: '', suffix: '' };
    default:
      return {};
  }
}
