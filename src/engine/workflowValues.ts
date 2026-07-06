import type { ImageAsset, ParameterValue, PromptValue, ScriptValue, ShotList, VideoAsset, WorkflowValue } from '../types/nodes';

export function makeWorkflowId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isParameterValue(value: unknown): value is ParameterValue {
  return isRecord(value) && value.type === 'parameter' && typeof value.key === 'string';
}

export function isPromptValue(value: unknown): value is PromptValue {
  return isRecord(value) && value.type === 'prompt' && typeof value.prompt === 'string';
}

export function isImageAsset(value: unknown): value is ImageAsset {
  return isRecord(value) && value.type === 'image' && typeof value.url === 'string';
}

export function isVideoAsset(value: unknown): value is VideoAsset {
  return isRecord(value) && value.type === 'video' && typeof value.url === 'string';
}

export function isScriptValue(value: unknown): value is ScriptValue {
  return isRecord(value) && value.type === 'script' && typeof value.text === 'string';
}

export function isShotList(value: unknown): value is ShotList {
  return isRecord(value) && value.type === 'shotList' && Array.isArray(value.items);
}

export function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (isPromptValue(value)) return value.prompt;
  if (isScriptValue(value)) return value.text;
  if (isImageAsset(value)) return value.url;
  if (isParameterValue(value)) return String(value.value ?? '');
  if (isShotList(value)) {
    return value.items
      .map((shot) => `${shot.index}. ${shot.title}\n${shot.visualPrompt || shot.description}`)
      .join('\n\n');
  }
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join('\n\n');
  return JSON.stringify(value, null, 2);
}

export function getParameter(
  inputs: Record<string, unknown>,
  key: string,
  fallback: string | number | boolean
): string | number | boolean {
  const direct = inputs[key];
  if (isParameterValue(direct)) return direct.value;
  if (
    direct !== undefined &&
    direct !== null &&
    direct !== '' &&
    ['string', 'number', 'boolean'].includes(typeof direct)
  ) {
    return direct as string | number | boolean;
  }

  for (const value of Object.values(inputs)) {
    if (isParameterValue(value) && value.key === key) return value.value;
  }

  return fallback;
}

export function getPromptFromValue(value: unknown): PromptValue {
  if (isPromptValue(value)) return value;
  if (isShotList(value)) {
    return {
      type: 'prompt',
      prompt: value.items.map((shot) => shot.visualPrompt || shot.description).join('\n\n'),
      negativePrompt: value.items.find((shot) => shot.negativePrompt)?.negativePrompt,
    };
  }
  return { type: 'prompt', prompt: toText(value) };
}

export function normalizeImageAsset(value: unknown, fallbackPrompt = ''): ImageAsset | null {
  if (isImageAsset(value)) return value;

  if (typeof value === 'string' && value.trim()) {
    const url = value.trim();
    const fileName = url.split('/').pop() || 'image';
    return {
      type: 'image',
      id: makeWorkflowId('image'),
      url,
      fileName,
      prompt: fallbackPrompt,
      createdAt: new Date().toISOString(),
    };
  }

  if (isRecord(value) && typeof value.url === 'string') {
    return {
      type: 'image',
      id: String(value.id || makeWorkflowId('image')),
      url: value.url,
      fileName: String(value.fileName || value.url.split('/').pop() || 'image'),
      prompt: typeof value.prompt === 'string' ? value.prompt : fallbackPrompt,
      negativePrompt: typeof value.negativePrompt === 'string' ? value.negativePrompt : undefined,
      width: typeof value.width === 'number' ? value.width : undefined,
      height: typeof value.height === 'number' ? value.height : undefined,
      seed: typeof value.seed === 'number' ? value.seed : undefined,
      model: typeof value.model === 'string' ? value.model : undefined,
      createdAt: String(value.createdAt || new Date().toISOString()),
    };
  }

  return null;
}

export function collectImageAssets(value: unknown): ImageAsset[] {
  if (!value) return [];
  if (isImageAsset(value)) return [value];
  if (isShotList(value)) return value.items.map((shot) => shot.image).filter(Boolean) as ImageAsset[];
  if (Array.isArray(value)) return value.flatMap(collectImageAssets);
  const normalized = normalizeImageAsset(value);
  return normalized ? [normalized] : [];
}

export function unwrapWorkflowValue(value: WorkflowValue): unknown {
  return value;
}
