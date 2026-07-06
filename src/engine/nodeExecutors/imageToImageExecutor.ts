import { executeImageGen } from './imageGenExecutor';
import { getParameter, normalizeImageAsset, toText } from '../workflowValues';
import type { ExecutionContext } from '../executionTypes';
import type { NodeConfig, NodeInputs, NodeOutputs } from '../../types/nodes';

export async function executeImageToImage(
  config: NodeConfig,
  inputs: NodeInputs,
  context: ExecutionContext
): Promise<NodeOutputs> {
  const referenceImage = normalizeImageAsset(inputs.image ?? config.imageUrl);
  if (!referenceImage) return { image: null, url: '', error: '图生图需要参考图片' };

  const strength = getParameter(inputs, 'strength', Number(config.strength ?? 0.65));
  const prompt = toText(inputs.prompt ?? config.prompt ?? '').trim();
  const mergedPrompt = [
    prompt,
    `Use the reference image as visual guidance. Reference strength: ${strength}.`,
  ].filter(Boolean).join('\n');

  return executeImageGen(
    {
      ...config,
      prompt: mergedPrompt,
      n: 1,
    },
    {
      ...inputs,
      prompt: mergedPrompt,
      referenceImage,
    },
    context
  );
}
