import { toText } from '../workflowValues';
import type { ExecutionContext } from '../executionTypes';
import type { NodeConfig, NodeInputs, NodeOutputs } from '../../types/nodes';
import { errorMessage } from '../errors';
import { generateTextWithMetadata, makeModelContext, resolveTextGenerationOptions } from './textGeneration';

export async function executeTextModel(
  config: NodeConfig,
  inputs: NodeInputs,
  context: ExecutionContext
): Promise<NodeOutputs> {
  const prompt = toText(inputs.prompt ?? inputs.text ?? config.prompt ?? '').trim();
  const system = toText(inputs.system ?? '').trim();

  if (!prompt) return { text: '', reasoning: '', error: '文本模型需要 prompt 输入' };

  const resolved = resolveTextGenerationOptions(config, context, {
    model: 'gpt-4o',
    system,
    prompt,
    temperature: 0.7,
    maxTokens: 2000,
  });

  if (!resolved) {
    return { text: '', reasoning: '', error: '文本模型需要可用 API 实例。请选择 API 实例，或配置全局默认模型。' };
  }

  try {
    const result = await generateTextWithMetadata(resolved);
    return {
      text: result.text,
      reasoning: '',
      task: result.task,
      modelContext: makeModelContext(
        { instanceId: resolved.instanceId, model: resolved.model },
        { sourceNodeType: 'textModel' }
      ),
      modelSourceUsed: resolved.source,
    };
  } catch (error) {
    return { text: '', reasoning: '', error: errorMessage(error, 'API 调用失败') };
  }
}
