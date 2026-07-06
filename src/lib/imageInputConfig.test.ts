import test from 'node:test';
import assert from 'node:assert/strict';
import { clearImageInputConfig, imageInputConfigFromAsset } from './imageInputConfig';
import type { ProxyAsset } from './apiProxy';

function imageAsset(overrides: Partial<ProxyAsset> = {}): ProxyAsset {
  return {
    id: 'asset-1',
    type: 'image',
    url: '/api/assets/asset-1',
    fileName: 'front-view.png',
    prompt: 'asset prompt',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('imageInputConfigFromAsset writes reusable asset identity into image input config', () => {
  const config = imageInputConfigFromAsset({ prompt: '' }, imageAsset());

  assert.equal(config.url, '/api/assets/asset-1');
  assert.equal(config.fileName, 'front-view.png');
  assert.equal(config.assetId, 'asset-1');
  assert.equal(config.prompt, 'asset prompt');
});

test('imageInputConfigFromAsset preserves user prompt over asset prompt', () => {
  const config = imageInputConfigFromAsset({ prompt: 'manual prompt' }, imageAsset({ prompt: 'asset prompt' }));

  assert.equal(config.prompt, 'manual prompt');
});

test('imageInputConfigFromAsset falls back to useful file names', () => {
  const fromPrompt = imageInputConfigFromAsset({}, imageAsset({ fileName: '', prompt: 'portrait prompt' }));
  assert.equal(fromPrompt.fileName, 'portrait prompt');

  const fromUrl = imageInputConfigFromAsset({}, imageAsset({
    id: '',
    fileName: '',
    prompt: '',
    url: 'https://example.com/reference.webp',
  }));
  assert.equal(fromUrl.fileName, 'reference.webp');
});

test('clearImageInputConfig removes selected asset but keeps other node settings', () => {
  const config = clearImageInputConfig({
    url: '/api/assets/asset-1',
    fileName: 'front-view.png',
    assetId: 'asset-1',
    prompt: 'manual prompt',
    quality: 'high',
  });

  assert.deepEqual(config, {
    url: '',
    fileName: '',
    assetId: '',
    prompt: 'manual prompt',
    quality: 'high',
  });
});
