import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  resolveDesktopAnimationInputs,
  selectDesktopAnimationAsset,
  selectDesktopAnimationState,
} from './desktopAgentAnimationState';
import type { DesktopAnimationManifest } from './desktopAgentsClient';

const manifest: DesktopAnimationManifest = {
  character_id: 'fox',
  states: {
    idle: {
      rive: {
        src: '/assets/characters/fox/character.riv',
        state_machine: 'PetState',
        inputs: { mood: 'normal', intensity: 0 },
      },
      gif: '/assets/characters/fox/fallback/idle.gif',
      frames: ['/assets/characters/fox/fallback/idle.png'],
    },
    talk: {
      gif: '/assets/characters/fox/fallback/talk.gif',
      frames: ['/assets/characters/fox/fallback/talk.png'],
    },
    happy: {
      frames: ['/assets/characters/fox/fallback/happy-1.png', '/assets/characters/fox/fallback/happy-2.png'],
    },
  },
};

test('selectDesktopAnimationAsset prefers Rive, then GIF, then frames', () => {
  assert.deepEqual(selectDesktopAnimationAsset(manifest.states.idle), {
    assetKind: 'rive',
    assetUrl: '/assets/characters/fox/character.riv',
    assetUrls: ['/assets/characters/fox/character.riv'],
  });
  assert.deepEqual(selectDesktopAnimationAsset(manifest.states.talk), {
    assetKind: 'gif',
    assetUrl: '/assets/characters/fox/fallback/talk.gif',
    assetUrls: ['/assets/characters/fox/fallback/talk.gif'],
  });
  assert.deepEqual(selectDesktopAnimationAsset(manifest.states.happy), {
    assetKind: 'frames',
    assetUrl: '/assets/characters/fox/fallback/happy-1.png',
    assetUrls: ['/assets/characters/fox/fallback/happy-1.png', '/assets/characters/fox/fallback/happy-2.png'],
  });
});

test('selectDesktopAnimationState maps speaking status to talk assets', () => {
  const selected = selectDesktopAnimationState(manifest, { state: 'idle', speaking: true, mood: 'happy' });

  assert.equal(selected.requestedState, 'talk');
  assert.equal(selected.state, 'talk');
  assert.equal(selected.assetKind, 'gif');
  assert.equal(selected.assetUrl, '/assets/characters/fox/fallback/talk.gif');
  assert.equal(selected.inputs.activity, 'talk');
  assert.equal(selected.inputs.mood, 'happy');
  assert.equal(selected.inputs.speaking, true);
});

test('selectDesktopAnimationState maps idle mood to mood state when available', () => {
  const selected = selectDesktopAnimationState(manifest, { state: 'idle', mood: 'happy', speaking: false });

  assert.equal(selected.requestedState, 'happy');
  assert.equal(selected.state, 'happy');
  assert.equal(selected.assetKind, 'frames');
  assert.equal(selected.inputs.mood, 'happy');
});

test('selectDesktopAnimationState falls back to idle when requested state is missing', () => {
  const selected = selectDesktopAnimationState(manifest, { state: 'look_left', speaking: false });

  assert.equal(selected.requestedState, 'look_left');
  assert.equal(selected.state, 'idle');
  assert.equal(selected.fallback, true);
  assert.equal(selected.assetKind, 'rive');
});

test('resolveDesktopAnimationInputs keeps manifest inputs and fills shared status fields', () => {
  const inputs = resolveDesktopAnimationInputs(
    { state: 'look_right', mood: 'normal', speaking: false },
    'look_right',
    { rive: { src: '/character.riv', inputs: { custom: true } } }
  );

  assert.equal(inputs.custom, true);
  assert.equal(inputs.activity, 'look_right');
  assert.equal(inputs.direction, 'right');
  assert.equal(inputs.intensity, 0.6);
  assert.equal(inputs.speaking, false);
});

test('selectDesktopAnimationState returns none without a manifest', () => {
  const selected = selectDesktopAnimationState(null, { state: 'idle', speaking: false });

  assert.equal(selected.assetKind, 'none');
  assert.equal(selected.assetUrl, '');
  assert.deepEqual(selected.assetUrls, []);
});
