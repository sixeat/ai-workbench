import type { NodeConfig, NodeInputs, NodeOutputs, ScriptValue } from '../../types/nodes';
import { toText } from '../workflowValues';
import type { ExecutionContext } from '../executionTypes';
import { errorMessage } from '../errors';
import { generateTextWithMetadata, makeModelContext, resolveTextGenerationOptions } from './textGeneration';

export async function executeScript(
  config: NodeConfig,
  inputs: NodeInputs,
  context: ExecutionContext
): Promise<NodeOutputs> {
  const scenes = Number(config.scenes || 5);
  const characters = Number(config.characters || 3);
  const style = String(config.style || '电影感');
  const prompt = toText(inputs.prompt ?? inputs.text ?? config.prompt ?? '').trim();
  const outline = toText(inputs.outline ?? '').trim();

  if (!prompt) return { script: null, text: '', error: '剧本生成需要主题输入' };

  const systemPrompt = [
    '你是专业剧本创作助手。',
    `请创作一个 ${style} 风格的剧本。`,
    `剧本需要包含约 ${scenes} 个场景，${characters} 个主要角色。`,
    '输出要清晰分段，方便后续拆成分镜。',
  ].join('\n');
  const userPrompt = outline ? `主题：${prompt}\n\n大纲：${outline}` : prompt;
  const resolved = resolveTextGenerationOptions(config, context, {
    model: 'gpt-4o',
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.8,
    maxTokens: 4000,
  });

  if (!resolved) {
    return { script: null, text: '', error: '剧本生成需要可用文本模型。请选择 API 实例，或配置全局默认模型。' };
  }

  try {
    const result = await generateTextWithMetadata(resolved);
    const content = result.text;
    const script: ScriptValue = {
      type: 'script',
      title: prompt.slice(0, 40),
      text: content,
      scenes: content
        .split(/\n{2,}/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, scenes),
    };

    return {
      script,
      text: content,
      task: result.task,
      modelContext: makeModelContext(
        { instanceId: resolved.instanceId, platformModelId: resolved.platformModelId, model: resolved.model },
        { sourceNodeType: 'script' }
      ),
      modelSourceUsed: resolved.source,
    };
  } catch (error) {
    return { script: null, text: '', error: errorMessage(error, 'API 调用失败') };
  }
}
