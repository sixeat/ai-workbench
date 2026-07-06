import { executeVideoGen } from './videoGenExecutor';
import type { ExecutionContext } from '../executionTypes';
import type { NodeConfig, NodeInputs, NodeOutputs } from '../../types/nodes';

export async function executeMultiImageVideo(
  config: NodeConfig,
  inputs: NodeInputs,
  context: ExecutionContext
): Promise<NodeOutputs> {
  return executeVideoGen(
    { ...config, mode: config.mode || 'images-to-video' },
    {
      ...inputs,
      images: inputs.images ?? inputs.shotList ?? inputs.image,
    },
    context
  );
}
