import type { ProxyModelCapabilityPreset } from './apiProxy';
import { summarizeApiKeyTestLimits, type ApiKeyTestLimitRow } from './apiKeyTestDisplay';

export interface GroupedModelCapabilityPresets {
  matching: ProxyModelCapabilityPreset[];
  others: ProxyModelCapabilityPreset[];
}

export function groupModelCapabilityPresetsByProvider(
  presets: ProxyModelCapabilityPreset[],
  providerId: string
): GroupedModelCapabilityPresets {
  const normalizedProviderId = providerId.trim();
  const matching: ProxyModelCapabilityPreset[] = [];
  const others: ProxyModelCapabilityPreset[] = [];

  for (const preset of presets) {
    if (preset.providerId === normalizedProviderId) {
      matching.push(preset);
    } else {
      others.push(preset);
    }
  }

  return { matching, others };
}

export function summarizeModelCapabilityPresetPreview(
  preset: ProxyModelCapabilityPreset
): ApiKeyTestLimitRow[] {
  return summarizeApiKeyTestLimits(preset.capabilities);
}
