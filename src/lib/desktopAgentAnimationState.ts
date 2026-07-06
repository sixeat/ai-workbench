import type { DesktopAnimationManifest, DesktopAnimationState } from './desktopAgentsClient';
import type { DesktopAgentChatStatus } from './desktopAgentChatState';

export type DesktopAnimationAssetKind = 'rive' | 'gif' | 'frames' | 'none';
export type DesktopAnimationInputValue = string | number | boolean;
export type DesktopAnimationInputs = Record<string, DesktopAnimationInputValue>;

export interface DesktopAnimationAssetSelection {
  assetKind: DesktopAnimationAssetKind;
  assetUrl: string;
  assetUrls: string[];
}

export interface DesktopAnimationSelection extends DesktopAnimationAssetSelection {
  state: string;
  requestedState: string;
  mood?: string;
  speaking: boolean;
  inputs: DesktopAnimationInputs;
  fallback: boolean;
}

const DEFAULT_STATUS: DesktopAgentChatStatus = { state: 'idle', speaking: false };

const MOOD_TO_STATE: Record<string, string> = {
  normal: 'idle',
  happy: 'happy',
  sad: 'sad',
  sleepy: 'sleep',
  surprised: 'surprise',
  angry: 'sad',
};

const STATE_FALLBACKS: Record<string, string[]> = {
  talk: ['idle'],
  listen: ['idle'],
  think: ['idle'],
  look_left: ['idle'],
  look_right: ['idle'],
  run_left: ['idle'],
  run_right: ['idle'],
  wave: ['happy', 'idle'],
  happy: ['idle'],
  sad: ['idle'],
  surprise: ['idle'],
  sleep: ['idle'],
};

export function selectDesktopAnimationState(
  manifest?: DesktopAnimationManifest | null,
  status: DesktopAgentChatStatus = DEFAULT_STATUS
): DesktopAnimationSelection {
  const requestedState = resolveRequestedAnimationState(status);
  const { state, asset, fallback } = findManifestState(manifest, requestedState);
  const selectedAsset = selectDesktopAnimationAsset(asset);
  return {
    ...selectedAsset,
    state,
    requestedState,
    mood: status.mood,
    speaking: status.speaking || state === 'talk',
    inputs: resolveDesktopAnimationInputs(status, state, asset),
    fallback,
  };
}

export function selectDesktopAnimationAsset(state?: DesktopAnimationState | null): DesktopAnimationAssetSelection {
  if (state?.rive?.src) {
    return {
      assetKind: 'rive',
      assetUrl: state.rive.src,
      assetUrls: [state.rive.src],
    };
  }
  if (state?.gif) {
    return {
      assetKind: 'gif',
      assetUrl: state.gif,
      assetUrls: [state.gif],
    };
  }
  if (state?.frames?.length) {
    return {
      assetKind: 'frames',
      assetUrl: state.frames[0],
      assetUrls: [...state.frames],
    };
  }
  return {
    assetKind: 'none',
    assetUrl: '',
    assetUrls: [],
  };
}

export function resolveDesktopAnimationInputs(
  status: DesktopAgentChatStatus = DEFAULT_STATUS,
  selectedState = status.state || 'idle',
  stateAsset?: DesktopAnimationState | null
): DesktopAnimationInputs {
  const baseInputs = safeInputs(stateAsset?.rive?.inputs);
  return {
    ...baseInputs,
    mood: status.mood || stringInput(baseInputs.mood) || moodForState(selectedState),
    activity: selectedState,
    speaking: status.speaking || selectedState === 'talk',
    sleeping: selectedState === 'sleep',
    direction: stringInput(baseInputs.direction) || directionForState(selectedState),
    intensity: numberInput(baseInputs.intensity, intensityForState(selectedState)),
  };
}

function resolveRequestedAnimationState(status: DesktopAgentChatStatus): string {
  if (status.speaking) return 'talk';
  if (status.state && status.state !== 'idle') return status.state;
  if (status.mood && MOOD_TO_STATE[status.mood]) return MOOD_TO_STATE[status.mood];
  return status.state || 'idle';
}

function findManifestState(
  manifest: DesktopAnimationManifest | null | undefined,
  requestedState: string
): { state: string; asset?: DesktopAnimationState; fallback: boolean } {
  const states = manifest?.states || {};
  if (states[requestedState]) {
    return { state: requestedState, asset: states[requestedState], fallback: false };
  }
  for (const fallbackState of STATE_FALLBACKS[requestedState] || ['idle']) {
    if (states[fallbackState]) {
      return { state: fallbackState, asset: states[fallbackState], fallback: true };
    }
  }
  const firstState = Object.keys(states)[0];
  if (firstState) {
    return { state: firstState, asset: states[firstState], fallback: true };
  }
  return { state: requestedState || 'idle', fallback: true };
}

function safeInputs(inputs: unknown): DesktopAnimationInputs {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return {};
  const result: DesktopAnimationInputs = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    }
  }
  return result;
}

function stringInput(value: DesktopAnimationInputValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function numberInput(value: DesktopAnimationInputValue | undefined, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function moodForState(state: string): string {
  if (state === 'happy') return 'happy';
  if (state === 'sad') return 'sad';
  if (state === 'sleep') return 'sleepy';
  if (state === 'surprise') return 'surprised';
  return 'normal';
}

function directionForState(state: string): string {
  if (state.endsWith('_left')) return 'left';
  if (state.endsWith('_right')) return 'right';
  return 'none';
}

function intensityForState(state: string): number {
  if (state === 'idle' || state === 'sleep') return 0.0;
  if (state === 'listen' || state === 'think') return 0.4;
  if (state === 'look_left' || state === 'look_right' || state === 'wave') return 0.6;
  if (state === 'talk') return 0.7;
  return 1.0;
}
