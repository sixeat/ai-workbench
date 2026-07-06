const assert = require('node:assert/strict');
const test = require('node:test');

const { createGenericProxyService } = require('./services/genericProxyService.cjs');

function createService(options = {}) {
  const calls = [];
  const service = createGenericProxyService({
    enableGenericProxy: options.enableGenericProxy ?? true,
    proxyAllowlist: options.proxyAllowlist || ['https://api.example.com'],
    proxyRequest: async (url, requestOptions) => {
      calls.push({ requestOptions, url });
      return options.proxyResult || {
        data: { ok: true },
        status: 207,
      };
    },
  });
  return { calls, service };
}

test('generic proxy service rejects missing URL before proxying', async () => {
  const { calls, service } = createService();

  await assert.rejects(
    () => service.proxy({ method: 'GET' }),
    /URL is required/
  );
  assert.equal(calls.length, 0);
});

test('generic proxy service rejects requests when disabled', async () => {
  const { calls, service } = createService({ enableGenericProxy: false });

  await assert.rejects(
    () => service.proxy({ url: 'https://api.example.com/v1/models' }),
    /Generic proxy is disabled/
  );
  assert.equal(calls.length, 0);
});

test('generic proxy service enforces the configured allowlist', async () => {
  const { calls, service } = createService({
    proxyAllowlist: ['https://safe.example.com'],
  });

  await assert.rejects(
    () => service.proxy({ url: 'https://unsafe.example.com/v1/models' }),
    /not allowed/
  );
  assert.equal(calls.length, 0);
});

test('generic proxy service forwards allowed request options', async () => {
  const { calls, service } = createService({
    proxyAllowlist: ['https://api.example.com'],
    proxyResult: {
      data: { models: [] },
      status: 201,
    },
  });

  const response = await service.proxy({
    body: { prompt: 'hello' },
    headers: { 'x-demo': '1' },
    method: 'POST',
    url: 'https://api.example.com/v1/chat',
  });

  assert.deepEqual(response, {
    data: { models: [] },
    status: 201,
  });
  assert.equal(calls[0].url, 'https://api.example.com/v1/chat');
  assert.deepEqual(calls[0].requestOptions, {
    body: { prompt: 'hello' },
    headers: { 'x-demo': '1' },
    method: 'POST',
  });
});
