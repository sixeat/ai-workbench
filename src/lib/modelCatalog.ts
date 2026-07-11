import type { ProxyApiKeyModel } from './apiProxy';
import type { NodeType } from '../types/nodes';

export function personalModelSupportsNode(model: ProxyApiKeyModel, type: NodeType): boolean {
  const capabilities = model.capabilities || {};
  const allowed = model.apiKey?.allowedCapabilities || {};
  const allows = (capability: string) => Object.keys(allowed).length === 0
    || allowed[capability as keyof typeof allowed] === true;
  if (['textModel', 'script', 'shotSplit', 'promptOptimize'].includes(type)) {
    return Boolean(capabilities.chat && allows('chat'));
  }
  if (type === 'imageGen') return Boolean(capabilities.imageGeneration && allows('imageGeneration'));
  if (type === 'imageToImage') {
    return Boolean(capabilities.imageGeneration && capabilities.imageReference && allows('imageGeneration') && allows('imageReference'));
  }
  if (type === 'videoGen') return Boolean(capabilities.videoGeneration && allows('videoGeneration'));
  if (type === 'multiImageVideo') {
    return Boolean(
      capabilities.videoGeneration
      && (capabilities.multiImageReference || Number(capabilities.video?.maxReferenceImages || 0) > 1)
      && allows('videoGeneration')
      && allows('multiImageReference')
    );
  }
  return false;
}

export function personalModelKeyName(model: ProxyApiKeyModel): string {
  return model.apiKey?.name || model.apiKey?.providerId || model.modelProviderId;
}

export function personalModelDisplayName(model: ProxyApiKeyModel): string {
  return `${model.displayName || model.upstreamModel} · ${personalModelKeyName(model)}`;
}
