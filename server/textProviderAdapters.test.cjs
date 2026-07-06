const assert = require('node:assert/strict');
const test = require('node:test');
const {
  getTextProviderAdapter,
  stripInternalFields,
} = require('./services/textProviderAdapters.cjs');

test('text adapter strips local internal fields from upstream bodies', () => {
  assert.deepEqual(stripInternalFields({
    baseUrl: 'https://example.com',
    apiKey: 'secret',
    apiKeyId: 'key-1',
    hasSystem: true,
    messageCount: 1,
    publicBaseUrl: 'https://workbench.example.com',
    providerId: 'openai-compatible',
    requestKind: 'chat',
    retryOf: 'old-task',
    upstreamTaskIds: ['upstream-task'],
    userId: 'user-1',
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hello' }],
  }), {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hello' }],
  });
});

test('openai compatible text adapter uses provider chat endpoints', () => {
  const adapter = getTextProviderAdapter('aliyun-bailian');
  const request = adapter.buildRequest({
    apiKey: 'dashscope-key',
    body: {
      providerId: 'aliyun-bailian',
      model: 'qwen-plus',
      messages: [{ role: 'user', content: 'hello' }],
    },
  });

  assert.equal(adapter.endpoint('aliyun-bailian'), '/compatible-mode/v1/chat/completions');
  assert.equal(request.headers.Authorization, 'Bearer dashscope-key');
  assert.equal(request.body.providerId, undefined);
  assert.equal(request.body.model, 'qwen-plus');
});

test('anthropic text adapter uses Claude headers and endpoint', () => {
  const adapter = getTextProviderAdapter('anthropic');
  const request = adapter.buildRequest({
    apiKey: 'claude-key',
    body: {
      providerId: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hello' }],
    },
  });

  assert.equal(adapter.endpoint('anthropic'), '/v1/messages');
  assert.equal(request.headers['x-api-key'], 'claude-key');
  assert.equal(request.headers['anthropic-version'], '2023-06-01');
  assert.equal(request.body.providerId, undefined);
  assert.equal(request.body.max_tokens, 1024);
});
