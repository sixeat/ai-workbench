import type { ProviderTemplate } from '../types/api';
import type { NodeType } from '../types/nodes';

export const FALLBACK_PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'openai-compatible',
    name: 'OpenAI 兼容',
    description: '适用于 OpenAI 官方、OneAPI、中转站，以及兼容 OpenAI 格式的模型服务。',
    category: 'multi',
    authType: 'bearer',
    defaultBaseUrl: '',
    endpoints: {
      chat: '/v1/chat/completions',
      image: '/v1/images/generations',
      models: '/v1/models',
    },
    requestFormat: 'openai',
    supportedNodes: ['textModel', 'imageGen', 'imageToImage', 'script', 'shotSplit', 'promptOptimize'],
    defaultModels: [
      'gpt-image-1',
      'gpt-image-2',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-3.5-turbo',
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Anthropic 官方 API，适合文本、剧本和提示词处理。',
    category: 'text',
    authType: 'apiKey',
    defaultBaseUrl: 'https://api.anthropic.com',
    endpoints: {
      chat: '/v1/messages',
      models: '/v1/models',
    },
    headers: {
      'anthropic-version': '2023-06-01',
    },
    requestFormat: 'anthropic',
    supportedNodes: ['textModel', 'script', 'shotSplit', 'promptOptimize'],
    defaultModels: [
      'claude-3-5-sonnet-20241022',
      'claude-3-opus-20240229',
      'claude-3-haiku-20240307',
    ],
  },
  {
    id: 'seedance',
    name: '火山方舟 Seedance',
    description: '火山方舟视频生成 API，支持文本、参考图、参考视频和参考音频。',
    category: 'video',
    authType: 'bearer',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com',
    endpoints: {
      video: '/api/v3/contents/generations/tasks',
    },
    requestFormat: 'custom',
    supportedNodes: ['videoGen', 'multiImageVideo'],
    defaultModels: ['doubao-seedance-2-0-mini-260615'],
  },
  {
    id: 'aliyun-bailian',
    name: '阿里云百炼',
    description: '百炼 / DashScope API，支持通义千问文本、视觉理解、万相图片和视频生成。',
    category: 'multi',
    authType: 'apiKey',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com',
    endpoints: {
      chat: '/compatible-mode/v1/chat/completions',
      image: '/api/v1/services/aigc/multimodal-generation/generation',
      video: '/api/v1/services/aigc/video-generation/video-synthesis',
      models: '',
    },
    requestFormat: 'dashscope',
    supportedNodes: ['textModel', 'imageGen', 'imageToImage', 'videoGen', 'multiImageVideo', 'script', 'shotSplit', 'promptOptimize'],
    defaultModels: [
      'qwen-plus',
      'qwen-vl-plus',
      'wan2.7-image-pro',
      'wan2.7-image',
      'wan2.7-t2v',
      'wan2.7-i2v-2026-04-25',
      'wan2.7-i2v',
      'wan2.6-image',
    ],
  },
  {
    id: 'stability',
    name: 'Stability AI',
    description: 'Stability AI 图像生成 API。',
    category: 'image',
    authType: 'bearer',
    defaultBaseUrl: 'https://api.stability.ai',
    endpoints: {
      image: '/v2beta/stable-image/generate/sd3',
    },
    requestFormat: 'custom',
    supportedNodes: ['imageGen', 'imageToImage'],
    defaultModels: ['sd3-medium', 'stable-image-ultra', 'stable-image-core'],
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    description: '硅基流动平台，支持多种文本和图像模型。',
    category: 'multi',
    authType: 'bearer',
    defaultBaseUrl: 'https://api.siliconflow.cn',
    endpoints: {
      chat: '/v1/chat/completions',
      image: '/v1/images/generations',
      models: '/v1/models',
    },
    requestFormat: 'openai',
    supportedNodes: ['textModel', 'imageGen', 'imageToImage', 'script', 'shotSplit', 'promptOptimize'],
    defaultModels: [
      'Qwen/Qwen2.5-72B-Instruct',
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'stabilityai/stable-diffusion-3-5-large',
    ],
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    description: 'Moonshot AI 官方 API，适合长文本和剧本处理。',
    category: 'text',
    authType: 'bearer',
    defaultBaseUrl: 'https://api.moonshot.cn',
    endpoints: {
      chat: '/v1/chat/completions',
      models: '/v1/models',
    },
    requestFormat: 'openai',
    supportedNodes: ['textModel', 'script', 'shotSplit', 'promptOptimize'],
    defaultModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  },
  {
    id: 'custom',
    name: '自定义',
    description: '手动配置任意 API 服务。适合高级用法和实验服务。',
    category: 'multi',
    authType: 'custom',
    defaultBaseUrl: '',
    endpoints: {},
    requestFormat: 'custom',
    supportedNodes: ['textModel', 'imageGen', 'imageToImage', 'videoGen', 'multiImageVideo', 'script', 'shotSplit', 'promptOptimize'],
    defaultModels: [],
  },
];

export let PROVIDER_TEMPLATES: ProviderTemplate[] = [...FALLBACK_PROVIDER_TEMPLATES];

export function setProviderTemplates(providers: ProviderTemplate[]): void {
  if (!providers.length) return;
  PROVIDER_TEMPLATES = providers.map((provider) => ({
    ...provider,
    endpoints: { ...provider.endpoints },
    headers: provider.headers ? { ...provider.headers } : undefined,
    supportedNodes: [...provider.supportedNodes],
    defaultModels: [...(provider.defaultModels || [])],
  }));
}

export function resetProviderTemplates(): void {
  PROVIDER_TEMPLATES = [...FALLBACK_PROVIDER_TEMPLATES];
}

export function getProviderTemplate(id: string): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find((provider) => provider.id === id);
}

export function getAllProviderTemplates(): ProviderTemplate[] {
  return PROVIDER_TEMPLATES;
}

export function getProvidersByNodeType(nodeType: NodeType): ProviderTemplate[] {
  return PROVIDER_TEMPLATES.filter((provider) => provider.supportedNodes.includes(nodeType));
}

export function getCategoryLabel(category: ProviderTemplate['category'] | string): string {
  const labels: Record<string, string> = {
    text: '文本',
    image: '图片',
    video: '视频',
    multi: '多模态',
    other: '其他',
  };
  return labels[category] || category;
}

export function getProviderDefaultModels(providerId: string): string[] {
  return getProviderTemplate(providerId)?.defaultModels || [];
}
