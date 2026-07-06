const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildBailianImageBody,
  extractBailianImageItems,
  extractOpenAiImageItems,
  getImageProviderAdapter,
  normalizeOpenAiImageBody,
} = require('./services/imageProviderAdapters.cjs');

const req = {
  headers: { host: 'workbench.example' },
  protocol: 'https',
};

test('openai image adapter normalizes local reference image URLs', () => {
  const body = normalizeOpenAiImageBody({
    model: 'gpt-image-1',
    prompt: 'portrait',
    reference_image: '/api/assets/ref-1',
    reference_images: ['/api/assets/ref-2'],
  }, req);

  assert.equal(body.reference_image, 'https://workbench.example/api/assets/ref-1');
  assert.deepEqual(body.reference_images, ['https://workbench.example/api/assets/ref-2']);
});

test('bailian image adapter builds DashScope multimodal request body', () => {
  const body = buildBailianImageBody({
    model: 'wan2.7-image-pro',
    prompt: 'product shot',
    reference_images: ['/api/assets/ref-1', 'https://cdn.example/ref-2.png'],
    size: '2K',
    n: 2,
    seed: 123,
    watermark: false,
    prompt_extend: true,
    enable_sequential: true,
    thinking_mode: true,
  }, req);

  assert.equal(body.model, 'wan2.7-image-pro');
  assert.deepEqual(body.parameters, {
    size: '2K',
    n: 2,
    seed: 123,
    watermark: false,
    prompt_extend: true,
    enable_sequential: true,
    thinking_mode: true,
  });
  assert.deepEqual(body.input.messages[0].content, [
    { text: 'product shot' },
    { image: 'https://workbench.example/api/assets/ref-1' },
    { image: 'https://cdn.example/ref-2.png' },
  ]);
});

test('image adapters extract provider specific image result items', () => {
  assert.deepEqual(
    extractOpenAiImageItems({ data: [{ b64_json: 'abc' }, { url: 'https://cdn.example/a.png' }] }),
    [{ b64_json: 'abc' }, { url: 'https://cdn.example/a.png' }]
  );

  assert.deepEqual(
    extractBailianImageItems({
      output: {
        choices: [
          { message: { content: [{ image: 'https://cdn.example/choice.png' }] } },
        ],
        results: [{ url: 'https://cdn.example/result.png' }],
      },
    }),
    [
      { url: 'https://cdn.example/choice.png' },
      { url: 'https://cdn.example/result.png' },
    ]
  );
});

test('image provider registry falls back to openai compatible adapter', () => {
  assert.equal(getImageProviderAdapter('aliyun-bailian').endpoint, '/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal(getImageProviderAdapter('unknown-provider').endpoint, '/v1/images/generations');
});
