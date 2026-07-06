const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getProviderDefaultModels,
  getProviderTemplate,
  listProviderTemplates,
} = require('./providerRegistry.cjs');

test('provider registry exposes core provider templates', () => {
  const providers = listProviderTemplates();
  const ids = providers.map((provider) => provider.id);

  assert.ok(ids.includes('openai-compatible'));
  assert.ok(ids.includes('seedance'));
  assert.ok(ids.includes('aliyun-bailian'));
  assert.ok(ids.includes('custom'));
});

test('provider templates include default models and supported nodes', () => {
  const seedance = getProviderTemplate('seedance');
  const bailian = getProviderTemplate('aliyun-bailian');

  assert.ok(seedance);
  assert.ok(seedance.supportedNodes.includes('videoGen'));
  assert.deepEqual(getProviderDefaultModels('seedance'), ['doubao-seedance-2-0-mini-260615']);

  assert.ok(bailian);
  assert.ok(bailian.supportedNodes.includes('imageGen'));
  assert.ok(getProviderDefaultModels('aliyun-bailian').includes('wan2.7-image-pro'));
});

test('provider registry returns cloned templates', () => {
  const first = getProviderTemplate('openai-compatible');
  assert.ok(first);
  first.defaultModels.push('mutated-model');
  first.endpoints.models = '/changed';

  const second = getProviderTemplate('openai-compatible');
  assert.ok(second);
  assert.equal(second.defaultModels.includes('mutated-model'), false);
  assert.equal(second.endpoints.models, '/v1/models');
});
