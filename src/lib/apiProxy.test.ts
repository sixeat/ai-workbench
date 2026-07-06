import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWorkbenchApiUrl,
  proxyAddAssetToCollection,
  proxyGetVideoTask,
  proxyRequestPasswordReset,
  proxyRemoveAssetFromCollection,
  proxyRetryTask,
  proxyTestApiKey,
  proxyVerifyPasswordReset,
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
  assert.equal(config.sameOrigin, false);
  assert.equal(config.error, undefined);
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
  assert.equal(config.sameOrigin, true);
  assert.equal(config.error, undefined);
  assert.equal(buildWorkbenchApiUrl('/api/health', config.baseUrl), '/api/health');
});

test('resolveWorkbenchProxyUrl defaults local development to same-origin Vite proxy', () => {
  const config = resolveWorkbenchProxyUrl({
    MODE: 'development',
    DEV: true,
  });

  assert.equal(config.baseUrl, '');
  assert.equal(config.explicit, false);
  assert.equal(config.production, false);
  assert.equal(config.sameOrigin, true);
  assert.equal(config.error, undefined);
  assert.equal(buildWorkbenchApiUrl('api/health', config.baseUrl), '/api/health');
});

test('resolveWorkbenchProxyUrl detects missing production API configuration', () => {
  const config = resolveWorkbenchProxyUrl({
    MODE: 'production',
    PROD: true,
  });

  assert.equal(config.baseUrl, '');
  assert.equal(config.explicit, false);
  assert.equal(config.production, true);
  assert.equal(config.sameOrigin, true);
  assert.match(config.error || '', /VITE_PROXY_URL is required/);
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

test('password reset helpers call auth endpoints with safe JSON bodies', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify({
      ok: true,
      email: 'user@example.com',
      expiresAt: '2026-07-06T12:00:00.000Z',
      user: { id: 'user-1', username: 'user@example.com', email: 'user@example.com', name: 'User', role: 'user' },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await proxyRequestPasswordReset('user@example.com');
    await proxyVerifyPasswordReset('user@example.com', '123456', 'new-password-123');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests[0].url.endsWith('/api/auth/password-reset/request'), true);
  assert.deepEqual(requests[0].body, { email: 'user@example.com' });
  assert.equal(requests[1].url.endsWith('/api/auth/password-reset/verify'), true);
  assert.deepEqual(requests[1].body, {
    email: 'user@example.com',
    code: '123456',
    password: 'new-password-123',
  });
});
