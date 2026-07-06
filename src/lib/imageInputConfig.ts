import type { ProxyAsset } from './apiProxy';
import type { NodeConfig } from '../types/nodes';

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function fallbackFileName(asset: ProxyAsset): string {
  const fromUrl = stringValue(asset.url).split('/').filter(Boolean).pop() || '';
  return stringValue(asset.fileName || asset.prompt || asset.id || fromUrl || 'image');
}

export function imageInputConfigFromAsset(currentConfig: NodeConfig, asset: ProxyAsset): NodeConfig {
  const currentPrompt = stringValue(currentConfig.prompt);
  return {
    ...currentConfig,
    url: asset.url,
    fileName: fallbackFileName(asset),
    assetId: asset.id,
    prompt: currentPrompt.trim() ? currentPrompt : stringValue(asset.prompt),
  };
}

export function clearImageInputConfig(currentConfig: NodeConfig): NodeConfig {
  return {
    ...currentConfig,
    url: '',
    fileName: '',
    assetId: '',
  };
}
