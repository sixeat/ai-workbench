import type { NodeConfig, NodeInputs, NodeOutputs, Shot, ShotList } from '../../types/nodes';
import { isShotList, makeWorkflowId, toText } from '../workflowValues';
import type { ExecutionContext } from '../executionTypes';
import { errorMessage } from '../errors';
import { generateTextWithMetadata, makeModelContext, parseJsonObject, resolveTextGenerationOptions } from './textGeneration';

interface ShotSplitResponse {
  items?: Array<Partial<Shot>>;
}

function splitIntoParts(text: string, count: number): string[] {
  const paragraphs = text
    .split(/\n{2,}|(?=第[一二三四五六七八九十\d]+[场幕镜])|(?=场景\s*\d+)/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (paragraphs.length >= count) return paragraphs.slice(0, count);

  const sentences = text
    .split(/(?<=[。！？!?])\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (sentences.length > 0) return sentences.slice(0, count);
  return Array.from({ length: count }, (_, index) => `镜头 ${index + 1}: ${text || '待补充分镜描述'}`);
}

function normalizeShots(items: Array<Partial<Shot>>, fallbackDuration: number, sourceText: string): ShotList {
  const normalizedItems = items
    .map((item, index) => {
      const description = String(item.description || item.visualPrompt || '').trim();
      const title = String(item.title || description.split(/\r?\n/)[0] || `镜头 ${index + 1}`).slice(0, 40);
      return {
        id: item.id || makeWorkflowId('shot'),
        index: Number(item.index || index + 1),
        title,
        description: description || sourceText,
        visualPrompt: item.visualPrompt,
        negativePrompt: item.negativePrompt,
        camera: item.camera,
        duration: Number(item.duration || fallbackDuration),
      };
    })
    .filter((item) => item.description.trim());

  return { type: 'shotList', items: normalizedItems };
}

function localShotSplit(text: string, count: number, duration: number): ShotList {
  const parts = splitIntoParts(text, count);
  const items: Shot[] = parts.map((part, index) => {
    const firstLine = part.split(/\r?\n/)[0] || `镜头 ${index + 1}`;
    return {
      id: makeWorkflowId('shot'),
      index: index + 1,
      title: firstLine.slice(0, 28),
      description: part,
      duration,
    };
  });
  return { type: 'shotList', items };
}

function buildShotSplitPrompt(text: string, count: number, duration: number): string {
  return [
    `请把下面内容拆成 ${count} 个适合图像或视频生成的分镜。`,
    `每个镜头默认时长约 ${duration} 秒。`,
    '请只输出 JSON，不要 Markdown，不要解释。',
    'JSON 格式：',
    '{"items":[{"index":1,"title":"镜头标题","description":"镜头叙事描述","visualPrompt":"画面生成提示词","camera":"景别/镜头运动","duration":4}]}',
    '',
    '原始内容：',
    text,
  ].join('\n');
}

export async function executeShotSplit(
  config: NodeConfig,
  inputs: NodeInputs,
  context: ExecutionContext
): Promise<NodeOutputs> {
  const source = inputs.script ?? inputs.text ?? inputs.content ?? config.text ?? '';
  if (isShotList(source)) return { shotList: source, text: toText(source) };

  const text = toText(source).trim();
  if (!text) return { shotList: { type: 'shotList', items: [] }, text: '', error: '分镜拆解需要剧本或文本输入' };

  const count = Math.max(1, Number(config.count || 5));
  const duration = Math.max(1, Number(config.defaultDuration || 4));
  const fallbackShotList = localShotSplit(text, count, duration);

  const resolved = resolveTextGenerationOptions(config, context, {
    model: 'gpt-4o',
    system: '你是专业分镜师。你的任务是把文本拆成结构清晰、可用于生成图片和视频的分镜 JSON。',
    prompt: buildShotSplitPrompt(text, count, duration),
    temperature: 0.5,
    maxTokens: 2500,
  });

  if (!resolved) {
    return { shotList: fallbackShotList, text: toText(fallbackShotList), mode: 'local' };
  }

  try {
    const result = await generateTextWithMetadata(resolved);
    const rawText = result.text;
    const parsed = parseJsonObject<ShotSplitResponse>(rawText);
    if (!parsed?.items?.length) {
      return {
        shotList: fallbackShotList,
        text: toText(fallbackShotList),
        rawText,
        warning: '模型返回的分镜 JSON 解析失败，已使用本地拆分兜底。',
        mode: 'fallback',
        modelSourceUsed: resolved.source,
      };
    }

    const shotList = normalizeShots(parsed.items.slice(0, count), duration, text);
    return {
      shotList,
      text: toText(shotList),
      rawText,
      task: result.task,
      mode: 'model',
      modelSourceUsed: resolved.source,
      modelContext: makeModelContext(
        { instanceId: resolved.instanceId, platformModelId: resolved.platformModelId, model: resolved.model },
        { sourceNodeType: 'shotSplit' }
      ),
    };
  } catch (error) {
    return {
      shotList: fallbackShotList,
      text: toText(fallbackShotList),
      warning: errorMessage(error, '模型分镜失败，已使用本地拆分兜底。'),
      mode: 'fallback',
      modelSourceUsed: resolved.source,
    };
  }
}
