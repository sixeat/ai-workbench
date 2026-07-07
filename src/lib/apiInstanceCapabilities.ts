import { getProviderTemplate } from '../data/providerRegistry';
import type { ApiInstance, ApiKeyAllowedCapabilities } from '../types/api';
import type { NodeType } from '../types/nodes';

export const API_KEY_CAPABILITY_OPTIONS: Array<{
  description: string;
  key: keyof ApiKeyAllowedCapabilities;
  label: string;
}> = [
  { key: 'chat', label: '文本', description: '文本模型、剧本、分镜、提示词优化。' },
  { key: 'imageGeneration', label: '图片', description: '文生图、图生图和图片参考。' },
  { key: 'videoGeneration', label: '视频', description: '文生视频、多图生视频。' },
];

export function nodeCapabilityKey(type: NodeType): keyof ApiKeyAllowedCapabilities | null {
  if (type === 'textModel' || type === 'script' || type === 'shotSplit' || type === 'promptOptimize') return 'chat';
  if (type === 'imageGen' || type === 'imageToImage') return 'imageGeneration';
  if (type === 'videoGen' || type === 'multiImageVideo') return 'videoGeneration';
  return null;
}

export function apiKeyCapabilitiesRestrict(capabilities?: ApiKeyAllowedCapabilities | null): boolean {
  return Boolean(capabilities && Object.keys(capabilities).length > 0);
}

export function completeApiKeyAllowedCapabilities(
  capabilities?: ApiKeyAllowedCapabilities | null,
  defaultEnabled = true
): ApiKeyAllowedCapabilities {
  const hasPolicy = apiKeyCapabilitiesRestrict(capabilities);
  return Object.fromEntries(
    API_KEY_CAPABILITY_OPTIONS.map((item) => [
      item.key,
      hasPolicy ? capabilities?.[item.key] === true : defaultEnabled,
    ])
  ) as ApiKeyAllowedCapabilities;
}

export function apiInstanceAllowsNode(instance: ApiInstance, type: NodeType): boolean {
  const capabilityKey = nodeCapabilityKey(type);
  if (!capabilityKey || !apiKeyCapabilitiesRestrict(instance.allowedCapabilities)) return true;
  return Boolean(instance.allowedCapabilities?.[capabilityKey]);
}

export function providerSupportsNode(providerId: string, type: NodeType): boolean {
  if (providerId === 'custom') return true;
  const provider = getProviderTemplate(providerId);
  if (!provider) return false;
  if (type === 'shotSplit' || type === 'promptOptimize') return true;
  if (type === 'imageToImage') return provider.supportedNodes.includes('imageGen');
  if (type === 'multiImageVideo') return provider.supportedNodes.includes('videoGen');
  return provider.supportedNodes.includes(type);
}

export function apiInstanceSupportsNode(instance: ApiInstance, type: NodeType): boolean {
  return providerSupportsNode(instance.providerId, type) && apiInstanceAllowsNode(instance, type);
}

export function summarizeAllowedCapabilities(capabilities?: ApiKeyAllowedCapabilities | null): string {
  if (!apiKeyCapabilitiesRestrict(capabilities)) return '全部能力';
  const labels = API_KEY_CAPABILITY_OPTIONS
    .filter((item) => Boolean(capabilities?.[item.key]))
    .map((item) => item.label);
  return labels.length ? labels.join(' / ') : '未开放能力';
}
