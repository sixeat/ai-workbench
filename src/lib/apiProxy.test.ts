import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWorkbenchApiUrl,
  proxyAddAssetToCollection,
  proxyGetVideoTask,
  proxyRemoveAssetFromCollection,
  proxyRetryTask,
  proxyTestApiKey,
  resolveWorkbenchProxyUrl,
} from './apiProxy';

test('resolveWorkbenchProxyUrl uses an explicit API origin when configured', () => {
  const config = resolveWorkbenchProxyUrl({
    VITE_PROXY_URL: 'https://api.example.com/',
    MODE: 'production',
    PROD: true,
  });

  assert.equal(config.baseUrl, 'https://api.example.com');
  assert.equal(config.explicit, true);
  assert.equal(config.production, true);
  assert.equal(buildWorkbenchApiUrl('/api/health', config.baseUrl), 'https://api.example.com/api/health');
});

test('resolveWorkbenchProxyUrl supports explicit same-origin deployment', () => {
  const config = resolveWorkbenchProxyUrl({
    VITE_PROXY_URL: '/',
    MODE: 'production',
    PROD: true,
  });

  assert.equal(config.baseUrl, '');
  assert.equal(config.explicit, true);
  assert.equal(buildWorkbenchApiUrl('/api/health', config.baseUrl), '/api/health');
});

test('resolveWorkbenchProxyUrl defaults local development to the Node API server', () => {
  const config = resolveWorkbenchProxyUrl({
    MODE: 'development',
    DEV: true,
  });

  assert.equal(config.baseUrl, 'http://127.0.0.1:3000');
  assert.equal(config.explicit, false);
  assert.equal(config.production, false);
  assert.equal(buildWorkbenchApiUrl('api/health', config.baseUrl), 'http://127.0.0.1:3000/api/health');
});

test('resolveWorkbenchProxyUrl detects missing production API configuration', () => {
  const config = resolveWorkbenchProxyUrl({
    MODE: 'production',
    PROD: true,
  });

  assert.equal(config.baseUrl, '');
  assert.equal(config.explicit, false);
  assert.equal(config.production, true);
});

test('proxy path parameters are URL encoded before requests are sent', async () => {
  const urls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({
      task: {},
      collection: {},
      result: {},
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await proxyGetVideoTask('video/id with space');
    await proxyRetryTask('task/id with space');
    await proxyAddAssetToCollection('collection/id with space', { assetId: 'asset-a' });
    await proxyRemoveAssetFromCollection('collection/id with space', 'asset/id with space');
    await proxyTestApiKey('key/id with space');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(urls[0].endsWith('/api/videos/video%2Fid%20with%20space'), true);
  assert.equal(urls[1].endsWith('/api/tasks/task%2Fid%20with%20space/retry'), true);
  assert.equal(urls[2].endsWith('/api/asset-collections/collection%2Fid%20with%20space/assets'), true);
  assert.equal(urls[3].endsWith('/api/asset-collections/collection%2Fid%20with%20space/assets/asset%2Fid%20with%20space'), true);
  assert.equal(urls[4].endsWith('/api/api-keys/key%2Fid%20with%20space/test'), true);
});
