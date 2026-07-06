import type { NodeConfig, NodeInputs, NodeOutputs, NodeType } from '../../types/nodes';
import { executeImageGen } from './imageGenExecutor';
import { executeImageInput, executeMultiImageInput } from './inputExecutors';
import { executeImageToImage } from './imageToImageExecutor';
import { executeMultiImageVideo } from './multiImageVideoExecutor';
import {
  executeCountParam,
  executeNegativePromptParam,
  executePromptParam,
  executeQualityParam,
  executeReferenceStrengthParam,
  executeSeedParam,
  executeShotParam,
  executeSizeParam,
  executeStyleParam,
} from './parameterExecutors';
import { executePromptOptimize } from './promptOptimizeExecutor';
import { executeScript } from './scriptExecutor';
import { executeShotSplit } from './shotSplitExecutor';
import { executeTextModel } from './textModelExecutor';
import { executeVideoGen } from './videoGenExecutor';
import { isImageAsset, isShotList, toText } from '../workflowValues';
import type { ExecutionContext } from '../executionTypes';

export type NodeExecutor<
  TConfig extends NodeConfig = NodeConfig,
  TInputs extends NodeInputs = NodeInputs,
  TOutputs extends NodeOutputs = NodeOutputs,
> = (
  config: TConfig,
  inputs: TInputs,
  context: ExecutionContext
) => Promise<TOutputs> | TOutputs;

const executors: Record<string, NodeExecutor> = {
  imageInput: executeImageInput,
  multiImageInput: executeMultiImageInput,
  promptParam: executePromptParam,
  negativePromptParam: executeNegativePromptParam,
  styleParam: executeStyleParam,
  sizeParam: executeSizeParam,
  qualityParam: executeQualityParam,
  seedParam: executeSeedParam,
  countParam: executeCountParam,
  referenceStrengthParam: executeReferenceStrengthParam,
  shotParam: executeShotParam,
  textModel: executeTextModel,
  script: executeScript,
  shotSplit: executeShotSplit,
  promptOptimize: executePromptOptimize,
  imageGen: executeImageGen,
  imageToImage: executeImageToImage,
  videoGen: executeVideoGen,
  multiImageVideo: executeMultiImageVideo,
};

export function getExecutor(type: NodeType): NodeExecutor | undefined {
  return executors[type];
}

export function hasExecutor(type: NodeType): boolean {
  return type in executors;
}

export function executeTextInput(config: NodeConfig): NodeOutputs {
  const text = String(config.content || '');
  return { text, value: { type: 'text', text } };
}

export function executeMerge(
  config: NodeConfig,
  inputs: NodeInputs
): NodeOutputs {
  const separator = config.separator || '\n\n';
  const a = toText(inputs.a || '');
  const b = toText(inputs.b || '');
  return {
    merged: `${config.prefix || ''}${a}${separator}${b}${config.suffix || ''}`,
  };
}

export function executePreview(inputs: NodeInputs): NodeOutputs {
  const content = inputs.content ?? inputs.image ?? inputs.images ?? inputs.shotList ?? inputs.text ?? inputs.url ?? '';
  const images = collectPreviewImages(content);
  const text = toText(content);
  const firstImage = images[0]?.url || '';

  return {
    displayed: true,
    content,
    text,
    images,
    ...(firstImage ? { image: firstImage, url: firstImage } : {}),
  };
}

function collectPreviewImages(value: unknown): Array<{ url: string; fileName?: string }> {
  if (!value) return [];
  if (isImageAsset(value)) return [{ url: value.url, fileName: value.fileName }];
  if (isShotList(value)) {
    return value.items
      .map((shot) => shot.image)
      .filter(Boolean)
      .map((image) => ({ url: image!.url, fileName: image!.fileName }));
  }
  if (Array.isArray(value)) return value.flatMap(collectPreviewImages);
  if (typeof value === 'string' && (value.startsWith('http') || value.startsWith('data:image') || value.startsWith('/api/'))) {
    return [{ url: value }];
  }
  return [];
}
