const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { LocalAssetStorage } = require('./assetStorage.cjs');
const {
  assertPublicHttpUrl,
  fetchWithTimeout,
  isPrivateIp,
} = require('./services/networkGuard.cjs');
const { proxyRequest } = require('./services/proxyService.cjs');

test('asset storage sanitizes uploaded file names and keeps writes inside output dir', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-asset-storage-test-'));
  try {
    const storage = new LocalAssetStorage(tempDir);
    const asset = await storage.save(Buffer.from('test'), {
      fileName: '../outside.html',
      mime: 'image/png',
      type: 'image',
    });

    assert.equal(asset.fileName, 'outside.png');
    assert.equal(path.dirname(path.resolve(asset.filePath)), path.resolve(tempDir));
    assert.equal(fs.existsSync(path.join(tempDir, 'outside.png')), true);
    assert.equal(fs.existsSync(path.join(tempDir, '..', 'outside.html')), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('network guard rejects local and private image download targets', async () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('10.0.0.1'), true);
  assert.equal(isPrivateIp('172.16.0.1'), true);
  assert.equal(isPrivateIp('192.168.1.1'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);

  await assert.rejects(() => assertPublicHttpUrl('http://127.0.0.1/image.png'), /Private or local/);
  await assert.rejects(() => assertPublicHttpUrl('file:///etc/passwd'), /Only http and https/);
});

test('proxy request blocks private upstreams in server mode', async () => {
  const previous = process.env.WORKBENCH_DEPLOYMENT_MODE;
  process.env.WORKBENCH_DEPLOYMENT_MODE = 'server';
  try {
    await assert.rejects(() => proxyRequest('http://127.0.0.1:12345'), /Private or local/);
  } finally {
    if (previous === undefined) {
      delete process.env.WORKBENCH_DEPLOYMENT_MODE;
    } else {
      process.env.WORKBENCH_DEPLOYMENT_MODE = previous;
    }
  }
});

test('fetchWithTimeout validates every redirect target', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('', {
    status: 302,
    headers: { location: 'http://127.0.0.1/private' },
  });

  try {
    await assert.rejects(
      () => fetchWithTimeout('https://safe.example/start', {
        validateRedirectUrl: assertPublicHttpUrl,
      }),
      /Private or local/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchWithTimeout strips sensitive headers on cross-origin redirects', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, headers: Object.fromEntries(new Headers(options.headers || {}).entries()) });
    if (requests.length === 1) {
      return new Response('', {
        status: 302,
        headers: { location: 'https://cdn.example/result' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const response = await fetchWithTimeout('https://api.example/start', {
      headers: {
        Authorization: 'Bearer secret',
        'x-api-key': 'secret',
        'x-safe-header': 'kept',
      },
      validateRedirectUrl: async () => {},
    });

    assert.equal(response.status, 200);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].headers.authorization, 'Bearer secret');
    assert.equal(requests[1].headers.authorization, undefined);
    assert.equal(requests[1].headers['x-api-key'], undefined);
    assert.equal(requests[1].headers['x-safe-header'], 'kept');
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchWithTimeout does not attach an abort signal when timeout is zero', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, signal: options.signal });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const response = await fetchWithTimeout('https://api.example/slow-generation', {
      timeoutMs: 0,
    });

    assert.equal(response.status, 200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].signal, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});
