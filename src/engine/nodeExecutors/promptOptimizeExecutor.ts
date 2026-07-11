import type { NodeConfig, NodeInputs, NodeOutputs, PromptValue, ShotList } from '../../types/nodes';
import { getParameter, isShotList, toText } from '../workflowValues';
import type { ExecutionContext } from '../executionTypes';
import { errorMessage } from '../errors';
import { generateTextWithMetadata, makeModelContext, parseJsonObject, resolveTextGenerationOptions } from './textGeneration';

interface PromptOptimizeResponse {
  prompt?: string;
  negativePrompt?: string;
  items?: Array<{
    index?: number;
    visualPrompt?: string;
    negativePrompt?: string;
  }>;
}

function styleText(value: string | number | boolean): string {
  const map: Record<string, string> = {
    cinematic: 'cinematic film still, dramatic composition',
    realistic: 'photorealistic, natural texture, real-world lighting',
    anime: 'anime style, expressive character design, clean line art',
    'chinese-style': 'modern Chinese aesthetic, elegant oriental details',
    'product-photo': 'premium product photography, studio lighting',
  };
  return map[String(value)] || String(value || '');
}

function shotParamsText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return [parsed.camera, parsed.lighting, parsed.character].filter(Boolean).join(', ');
    } catch {
      return value;
    }
  }
  if (typeof value === 'object') {
    const data = value as Record<string, unknown>;
    return [data.camera, data.lighting, data.character].filter(Boolean).join(', ');
  }
  return String(value);
}

function localOptimize(
  content: unknown,
  prefix: string,
  negativePrompt: string,
  style: string,
  shotParams: string
): NodeOutputs {
  if (isShotList(content)) {
    const shotList: ShotList = {
      type: 'shotList',
      items: content.items.map((shot) => ({
        ...shot,
        visualPrompt: [prefix, style, shotParams, shot.visualPrompt || shot.description]
          .filter(Boolean)
          .join(', '),
        negativePrompt: shot.negativePrompt || negativePrompt,
      })),
    };
    return { shotList, text: toText(shotList), prompt: { type: 'prompt', prompt: toText(shotList), negativePrompt } };
  }

  const text = toText(content).trim();
  const prompt: PromptValue = {
    type: 'prompt',
    prompt: [prefix, style, shotParams, text].filter(Boolean).join(', '),
    negativePrompt,
    style: style || undefined,
  };
  return { prompt, text: prompt.prompt };
}

function buildPromptOptimizePrompt(content: unknown, prefix: string, negativePrompt: string, style: string, shotParams: string): string {
  if (isShotList(content)) {
    return [
      '请把下面 ShotList 里的每个镜头改写成适合图片生成的 visualPrompt。',
      '要求画面具体、可执行，保留角色、主体、动作、场景、构图、镜头、光照和风格。',
      '请只输出 JSON，不要 Markdown，不要解释。',
      'JSON 格式：',
      '{"items":[{"index":1,"visualPrompt":"英文或中英混合图像提示词","negativePrompt":"反向提示词"}]}',
      '',
      `统一前缀：${prefix || '无'}`,
      `统一风格：${style || '无'}`,
      `镜头参数：${shotParams || '无'}`,
      `默认反向词：${negativePrompt || '无'}`,
      '',
      'ShotList：',
      JSON.stringify(content, null, 2),
    ].join('\n');
  }

  return [
    '请把下面文本改写成适合图片生成模型的 prompt。',
    '要求画面具体、主体明确、构图清晰、风格稳定。',
    '请只输出 JSON，不要 Markdown，不要解释。',
    'JSON 格式：',
    '{"prompt":"图像提示词","negativePrompt":"反向提示词"}',
    '',
    `统一前缀：${prefix || '无'}`,
    `统一风格：${style || '无'}`,
    `镜头参数：${shotParams || '无'}`,
    `默认反向词：${negativePrompt || '无'}`,
    '',
    '原始文本：',
    toText(content),
  ].join('\n');
}

export async function executePromptOptimize(
  config: NodeConfig,
  inputs: NodeInputs,
  context: ExecutionContext
): Promise<NodeOutputs> {
  const content = inputs.content ?? inputs.script ?? inputs.text ?? inputs.prompt ?? '';
  const prefix = String(config.prefix || '').trim();
  const negativePrompt = String(config.negativePrompt || '').trim();
  const style = styleText(getParameter(inputs, 'style', ''));
  const shotParams = shotParamsText(getParameter(inputs, 'shotParams', ''));
  const fallback = localOptimize(content, prefix, negativePrompt, style, shotParams);
  const resolved = resolveTextGenerationOptions(config, context, {
    model: 'gpt-4o',
    system: '你是专业图像提示词工程师。你只输出可解析 JSON。',
    prompt: buildPromptOptimizePrompt(content, prefix, negativePrompt, style, shotParams),
    temperature: 0.6,
    maxTokens: 2500,
  });

  if (!resolved) return { ...fallback, mode: 'local' };

  try {
    const result = await generateTextWithMetadata(resolved);
    const rawText = result.text;
    const parsed = parseJsonObject<PromptOptimizeResponse>(rawText);

    if (isShotList(content)) {
      if (!parsed?.items?.length) {
        return { ...fallback, rawText, warning: '模型返回的提示词 JSON 解析失败，已使用本地拼接兜底。', mode: 'fallback', modelSourceUsed: resolved.source };
      }

      const shotList: ShotList = {
        type: 'shotList',
        items: content.items.map((shot, index) => {
          const optimized = parsed.items?.find((item) => Number(item.index) === shot.index) || parsed.items?.[index];
          return {
            ...shot,
            visualPrompt: optimized?.visualPrompt || shot.visualPrompt || shot.description,
            negativePrompt: optimized?.negativePrompt || shot.negativePrompt || negativePrompt,
          };
        }),
      };
      return {
        shotList,
        text: toText(shotList),
        prompt: { type: 'prompt', prompt: toText(shotList), negativePrompt },
        rawText,
        task: result.task,
        mode: 'model',
        modelSourceUsed: resolved.source,
        modelContext: makeModelContext(
          { instanceId: resolved.instanceId, apiKeyModelId: resolved.apiKeyModelId, platformModelId: resolved.platformModelId, model: resolved.model },
          { sourceNodeType: 'promptOptimize' }
        ),
      };
    }

    const prompt: PromptValue = {
      type: 'prompt',
      prompt: parsed?.prompt?.trim() || rawText.trim() || (
        typeof fallback.prompt === 'object' && fallback.prompt !== null && 'prompt' in fallback.prompt
          ? String(fallback.prompt.prompt || '')
          : ''
      ),
      negativePrompt: parsed?.negativePrompt || negativePrompt,
      style: style || undefined,
    };
    return {
      prompt,
      text: prompt.prompt,
      rawText,
      task: result.task,
      mode: 'model',
      modelSourceUsed: resolved.source,
      modelContext: makeModelContext(
        { instanceId: resolved.instanceId, apiKeyModelId: resolved.apiKeyModelId, platformModelId: resolved.platformModelId, model: resolved.model },
        { sourceNodeType: 'promptOptimize' }
      ),
    };
  } catch (error) {
    return {
      ...fallback,
      warning: errorMessage(error, '模型提示词优化失败，已使用本地拼接兜底。'),
      mode: 'fallback',
      modelSourceUsed: resolved.source,
    };
  }
}
