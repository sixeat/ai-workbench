import type { NodeConfig, NodeOutputs, ParameterValue } from '../../types/nodes';

function parameter(key: string, value: string | number | boolean, label?: string): ParameterValue {
  return { type: 'parameter', key, value, label };
}

export function executePromptParam(config: NodeConfig): NodeOutputs {
  const prompt = String(config.prompt || '').trim();
  return {
    prompt: { type: 'prompt', prompt },
    text: prompt,
  };
}

export function executeNegativePromptParam(config: NodeConfig): NodeOutputs {
  const value = String(config.negativePrompt || '').trim();
  return { negativePrompt: parameter('negativePrompt', value, '反向提示词'), text: value };
}

export function executeStyleParam(config: NodeConfig): NodeOutputs {
  const value = String(config.style || 'cinematic');
  return { style: parameter('style', value, '风格'), text: value };
}

export function executeSizeParam(config: NodeConfig): NodeOutputs {
  const value = String(config.size || '1024x1024');
  return { size: parameter('size', value, '尺寸'), text: value };
}

export function executeQualityParam(config: NodeConfig): NodeOutputs {
  const value = String(config.quality || 'auto');
  return { quality: parameter('quality', value, '质量'), text: value };
}

export function executeSeedParam(config: NodeConfig): NodeOutputs {
  const value = Number(config.seed || 0);
  return { seed: parameter('seed', value, 'Seed'), value };
}

export function executeCountParam(config: NodeConfig): NodeOutputs {
  const value = Math.max(1, Number(config.count || 1));
  return { count: parameter('count', value, '数量'), value };
}

export function executeReferenceStrengthParam(config: NodeConfig): NodeOutputs {
  const value = Math.max(0, Math.min(1, Number(config.strength ?? 0.65)));
  return { strength: parameter('strength', value, '参考强度'), value };
}

export function executeShotParam(config: NodeConfig): NodeOutputs {
  const value = {
    camera: String(config.camera || ''),
    lighting: String(config.lighting || ''),
    character: String(config.character || ''),
  };
  return { shotParams: parameter('shotParams', JSON.stringify(value), '镜头参数'), value };
}
