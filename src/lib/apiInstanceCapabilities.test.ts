import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apiInstanceSupportsNode,
  completeApiKeyAllowedCapabilities,
  summarizeAllowedCapabilities,
} from './apiInstanceCapabilities';
import type { ApiInstance } from '../types/api';

function apiInstance(allowedCapabilities: ApiInstance['allowedCapabilities']): ApiInstance {
  return {
    id: 'server-key',
    name: 'Server Key',
    providerId: 'openai-compatible',
    apiKey: '',
    allowedCapabilities,
    models: [],
    modelFetchMode: 'manual',
    isEnabled: true,
    createdAt: '',
    updatedAt: '',
  };
}

test('completeApiKeyAllowedCapabilities keeps partial saved policies restrictive', () => {
  assert.deepEqual(
    completeApiKeyAllowedCapabilities({ imageGeneration: true }),
    {
      chat: false,
      imageGeneration: true,
      videoGeneration: false,
    }
  );
});

test('completeApiKeyAllowedCapabilities treats empty policies as default all enabled', () => {
  assert.deepEqual(
    completeApiKeyAllowedCapabilities({}),
    {
      chat: true,
      imageGeneration: true,
      videoGeneration: true,
    }
  );
});

test('apiInstanceSupportsNode respects key-level capability limits', () => {
  const instance = apiInstance({ imageGeneration: true });

  assert.equal(apiInstanceSupportsNode(instance, 'imageGen'), true);
  assert.equal(apiInstanceSupportsNode(instance, 'imageToImage'), true);
  assert.equal(apiInstanceSupportsNode(instance, 'textModel'), false);
  assert.equal(apiInstanceSupportsNode(instance, 'videoGen'), false);
});

test('summarizeAllowedCapabilities shows only enabled capabilities', () => {
  assert.equal(summarizeAllowedCapabilities({ imageGeneration: true }), '图片');
  assert.equal(summarizeAllowedCapabilities({}), '全部能力');
});
