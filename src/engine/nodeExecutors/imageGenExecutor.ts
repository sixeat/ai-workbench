import { proxyAssetUrl, proxyOpenAIImage } from '../../lib/apiProxy';
import { getInstanceRuntimeConfig } from '../../stores/apiStore';
import type { ImageAsset, NodeConfig, NodeInputs, NodeOutputs, Shot, ShotList } from '../../types/nodes';
import type { ExecutionContext } from '../executionTypes';
import { errorMessage } from '../errors';
import { collectImageAssets, getParameter, getPromptFromValue, isShotList, makeWorkflowId, toText } from '../workflowValues';

interface ImageResponseItem {
  id?: string;
  url?: string;
  b64_json?: string;
  fileName?: string;
  createdAt?: string;
}

interface ImageGenerationMeta {
  model: string;
  size: string;
  quality: string;
  seed: string | number | boolean;
  count: number;
  negativePrompt: string;
  referenceImages: ImageAsset[];
  strength: number;
  responseFormat: string;
  apiKeyId?: string;
  platformModelId?: string;
  providerId?: string;
  promptExtend: boolean;
  enableSequential: boolean;
  thinkingMode: boolean;
  watermark: boolean;
  upstreamTaskIds?: string[];
}

function parseSize(size: string): { width?: number; height?: number } {
  const match = String(size).match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return {};
  return { width: Number(match[1]), height: Number(match[2]) };
}

function styleToPrompt(style: string): string {
  const map: Record<string, string> = {
    cinematic: 'cinematic film still, dramatic composition',
    realistic: 'photorealistic, natural texture, real-world lighting',
    anime: 'anime style, expressive character design, clean line art',
    'chinese-style': 'modern Chinese aesthetic, elegant oriental details',
    'product-photo': 'premium product photography, studio lighting',
  };
  return map[style] || '';
}

function withStyle(prompt: string, stylePrompt: string): string {
  return [stylePrompt, prompt].filter(Boolean).join(', ');
}

function assetFromResponseItem(item: ImageResponseItem, prompt: string, meta: ImageGenerationMeta): ImageAsset | null {
  if (!item?.url && !item?.b64_json) return null;
  const url = item.url ? proxyAssetUrl(item.url) : `data:image/png;base64,${item.b64_json}`;
  const { width, height } = parseSize(meta.size);

  return {
    type: 'image',
    id: item.id || makeWorkflowId('image'),
    url,
    fileName: item.fileName || url.split('/').pop() || 'generated.png',
    prompt,
    negativePrompt: meta.negativePrompt,
    width,
    height,
    seed: meta.seed ? Number(meta.seed) : undefined,
    model: meta.model,
    createdAt: item.createdAt || new Date().toISOString(),
  };
}

async function generateOne(
  baseUrl: string,
  apiKey: string,
  prompt: string,
  meta: ImageGenerationMeta
): Promise<{ images: ImageAsset[]; task?: unknown }> {
  const body: Record<string, unknown> = {
    model: meta.model,
    prompt,
    n: meta.count,
    size: meta.size,
    quality: meta.quality,
    response_format: meta.responseFormat,
    providerId: meta.providerId,
  };

  if (meta.seed) body.seed = Number(meta.seed);
  if (meta.negativePrompt) body.negative_prompt = meta.negativePrompt;
  if (meta.referenceImages?.length === 1) body.reference_image = meta.referenceImages[0].url;
  if (meta.referenceImages?.length > 1) body.reference_images = meta.referenceImages.map((image: ImageAsset) => image.url);
  if (meta.referenceImages?.length > 0) body.reference_strength = meta.strength;
  if (meta.promptExtend) body.promptExtend = true;
  if (meta.enableSequential) body.enableSequential = true;
  if (meta.thinkingMode) body.thinkingMode = true;
  if (meta.watermark) body.watermark = true;
  if (meta.upstreamTaskIds?.length) body.upstreamTaskIds = meta.upstreamTaskIds;

  const data = await proxyOpenAIImage(baseUrl, apiKey, body, {
    apiKeyId: meta.apiKeyId,
    platformModelId: meta.platformModelId,
    providerId: meta.providerId,
  });
  const items = Array.isArray(data.data) ? data.data : [];
  return {
    images: items.map((item: ImageResponseItem) => assetFromResponseItem(item, prompt, meta)).filter(Boolean) as ImageAsset[],
    task: data.task,
  };
}

export async function executeImageGen(
  config: NodeConfig,
  inputs: NodeInputs,
  context?: ExecutionContext
): Promise<NodeOutputs> {
  const instanceId = String(config.instanceId || '');
  const platformModelId = String(config.platformModelId || '');
  const promptInput = Array.isArray(inputs.prompt)
    ? inputs.prompt.map((item) => item?.type === 'parameter' ? '' : toText(item)).filter(Boolean).join('\n')
    : inputs.prompt ?? inputs.text ?? config.prompt ?? '';
  const promptValue = getPromptFromValue(promptInput);
  const size = String(getParameter(inputs, 'size', String(config.size || '1024x1024')));
  const quality = String(getParameter(inputs, 'quality', String(config.quality || 'auto')));
  const seed = getParameter(inputs, 'seed', Number(config.seed || 0));
  const count = Math.max(1, Number(getParameter(inputs, 'count', Number(config.n || 1))));
  const style = String(getParameter(inputs, 'style', String(config.style || 'none')));
  const strength = Number(getParameter(inputs, 'strength', Number(config.strength ?? 0.65)));
  const negativePrompt = String(
    getParameter(inputs, 'negativePrompt', String(promptValue.negativePrompt || config.negativePrompt || ''))
  );
  const referenceImages = [
    ...collectImageAssets(inputs.referenceImage),
    ...collectImageAssets(inputs.referenceImages),
  ];
  const responseFormat = String(config.responseFormat || 'b64_json');
  const model = String(config.model || 'gpt-image-1');

  if (!instanceId && !platformModelId) return { image: null, images: [], url: '', error: '请选择 API 实例' };

  const runtimeConfig = instanceId ? getInstanceRuntimeConfig(instanceId) : null;
  if (!platformModelId && !runtimeConfig) return { image: null, images: [], url: '', error: 'API 实例配置无效' };

  const { baseUrl, apiKey, apiKeyId, provider } = runtimeConfig || { baseUrl: '', apiKey: '', apiKeyId: undefined, provider: undefined };
  const meta = {
    model,
    size,
    quality,
    seed,
    count,
    negativePrompt,
    referenceImages,
    strength,
    responseFormat,
    apiKeyId,
    platformModelId: platformModelId || undefined,
    providerId: provider?.id,
    promptExtend: Boolean(config.promptExtend),
    enableSequential: Boolean(config.enableSequential),
    thinkingMode: Boolean(config.thinkingMode),
    watermark: Boolean(config.watermark),
    upstreamTaskIds: context?.upstreamTaskIds || [],
  };
  const stylePrompt = styleToPrompt(style);

  try {
    if (isShotList(promptInput)) {
      const generatedShots: Shot[] = [];
      const allImages: ImageAsset[] = [];
      const generatedTasks: unknown[] = [];

      for (const shot of promptInput.items) {
        const shotPrompt = withStyle(String(shot.visualPrompt || shot.description || '').trim(), stylePrompt);
        if (!shotPrompt) {
          generatedShots.push({ ...shot, error: '镜头缺少 visualPrompt 或 description' });
          continue;
        }

        try {
          const generated = await generateOne(baseUrl, apiKey, shotPrompt, {
            ...meta,
            negativePrompt: shot.negativePrompt || negativePrompt,
          });
          const images = generated.images;
          allImages.push(...images);
          if (generated.task) generatedTasks.push(generated.task);
          generatedShots.push({ ...shot, image: images[0] });
        } catch (error) {
          generatedShots.push({ ...shot, error: errorMessage(error, '图片生成失败') });
        }
      }

      const shotList: ShotList = { type: 'shotList', items: generatedShots };
      const firstImage = allImages[0] || null;
      return {
        image: firstImage,
        images: allImages,
        task: generatedTasks[0],
        tasks: generatedTasks,
        shotList,
        url: firstImage?.url || '',
        text: toText(shotList),
      };
    }

    const prompt = withStyle(promptValue.prompt.trim(), stylePrompt);
    if (!prompt) return { image: null, images: [], url: '', error: 'prompt is required' };

    const generated = await generateOne(baseUrl, apiKey, prompt, meta);
    const images = generated.images;
    const firstImage = images[0] || null;

    if (!firstImage) {
      return { image: null, images: [], url: '', error: '图片接口没有返回 image/url 数据' };
    }

    return {
      image: firstImage,
      images,
      task: generated.task,
      url: firstImage.url,
      text: prompt,
    };
  } catch (error) {
    return { image: null, images: [], url: '', error: errorMessage(error, 'API 调用失败') };
  }
}
