const assert = require('node:assert/strict');
const test = require('node:test');

const { getPublicBaseUrl, toPublicAssetUrl } = require('./services/mediaUrlService.cjs');

test('media URL service uses explicit public API base URL for relative assets', () => {
  const original = process.env.WORKBENCH_PUBLIC_BASE_URL;
  process.env.WORKBENCH_PUBLIC_BASE_URL = 'https://api.example.com/';

  try {
    assert.equal(getPublicBaseUrl({ headers: { host: 'internal.local' }, protocol: 'http' }), 'https://api.example.com');
    assert.equal(
      toPublicAssetUrl({ headers: { host: 'internal.local' }, protocol: 'http' }, '/api/assets/asset-1'),
      'https://api.example.com/api/assets/asset-1'
    );
  } finally {
    if (original === undefined) {
      delete process.env.WORKBENCH_PUBLIC_BASE_URL;
    } else {
      process.env.WORKBENCH_PUBLIC_BASE_URL = original;
    }
  }
});

test('media URL service falls back to forwarded public host when no explicit base URL is set', () => {
  const original = process.env.WORKBENCH_PUBLIC_BASE_URL;
  delete process.env.WORKBENCH_PUBLIC_BASE_URL;

  try {
    assert.equal(getPublicBaseUrl({
      headers: {
        host: '127.0.0.1:3000',
        'x-forwarded-host': 'api.example.com',
        'x-forwarded-proto': 'https',
      },
      protocol: 'http',
    }), 'https://api.example.com');
  } finally {
    if (original !== undefined) process.env.WORKBENCH_PUBLIC_BASE_URL = original;
  }
});
