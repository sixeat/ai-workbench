const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildBailianContentForValidation,
  buildBailianVideoBody,
  findFirstVideoUrl,
  getVideoProviderAdapter,
  normalizeArkContent,
  normalizeVideoStatus,
  summarizeVideoUpstream,
} = require('./services/videoProviderAdapters.cjs');

const req = {
  headers: { host: 'workbench.example' },
  protocol: 'https',
};

test('seedance adapter normalizes text, image, video and audio content', () => {
  const content = normalizeArkContent({
    prompt: 'make tea ad',
    images: ['/api/assets/a', { url: 'https://cdn.example/b.png' }],
    referenceVideoUrl: '/api/assets/ref-video',
    referenceAudioUrl: 'https://cdn.example/music.mp3',
  }, req);

  assert.deepEqual(content, [
    { type: 'text', text: 'make tea ad' },
    { type: 'image_url', image_url: { url: 'https://workbench.example/api/assets/a' }, role: 'reference_image' },
    { type: 'image_url', image_url: { url: 'https://cdn.example/b.png' }, role: 'reference_image' },
    { type: 'video_url', video_url: { url: 'https://workbench.example/api/assets/ref-video' }, role: 'reference_video' },
    { type: 'audio_url', audio_url: { url: 'https://cdn.example/music.mp3' }, role: 'reference_audio' },
  ]);
});

test('bailian adapter builds media body for wan image-to-video models', () => {
  const body = buildBailianVideoBody({
    model: 'wan2.7-i2v',
    prompt: 'animate character',
    images: ['/api/assets/first', '/api/assets/last'],
    referenceAudioUrl: '/api/assets/audio',
    referenceVideoUrl: 'https://cdn.example/start.mp4',
    ratio: '16:9',
    duration: 5,
    seed: 42,
    watermark: false,
    prompt_extend: true,
    negative_prompt: 'low quality',
  }, req);

  assert.equal(body.model, 'wan2.7-i2v');
  assert.equal(body.input.prompt, 'animate character');
  assert.equal(body.input.negative_prompt, 'low quality');
  assert.deepEqual(body.input.media, [
    { type: 'first_frame', url: 'https://workbench.example/api/assets/first' },
    { type: 'last_frame', url: 'https://workbench.example/api/assets/last' },
    { type: 'driving_audio', url: 'https://workbench.example/api/assets/audio' },
    { type: 'first_clip', url: 'https://cdn.example/start.mp4' },
  ]);
  assert.deepEqual(body.parameters, {
    ratio: '16:9',
    duration: 5,
    seed: 42,
    watermark: false,
    prompt_extend: true,
  });
});

test('bailian validation content keeps only media type markers', () => {
  assert.deepEqual(
    buildBailianContentForValidation({
      prompt: 'video prompt',
      images: ['/api/assets/a'],
      referenceVideoUrl: '/api/assets/v',
      referenceAudioUrl: '/api/assets/aud',
    }),
    [
      { type: 'text' },
      { type: 'image_url' },
      { type: 'video_url' },
      { type: 'audio_url' },
    ]
  );
});

test('video adapter parses upstream task state and video URLs', () => {
  assert.deepEqual(summarizeVideoUpstream({ output: { task_id: 'task-1', task_status: 'SUCCEEDED' } }), {
    taskId: 'task-1',
    status: 'SUCCEEDED',
  });
  assert.equal(normalizeVideoStatus({ output: { task_status: 'SUCCEEDED' } }), 'succeeded');
  assert.equal(normalizeVideoStatus({ output: { task_status: 'FAILED' } }), 'failed');
  assert.equal(findFirstVideoUrl({ output: { video_url: { url: 'https://cdn.example/result.mp4' } } }), 'https://cdn.example/result.mp4');
});

test('video provider registry returns provider specific endpoints', () => {
  assert.equal(getVideoProviderAdapter('seedance').buildQueryRequest({ taskId: 'a', apiKey: 'k' }).endpoint, '/api/v3/contents/generations/tasks/a');
  assert.equal(getVideoProviderAdapter('aliyun-bailian').buildQueryRequest({ taskId: 'a', apiKey: 'k' }).endpoint, '/api/v1/tasks/a');
  assert.equal(getVideoProviderAdapter('unknown').id, 'seedance');
});
