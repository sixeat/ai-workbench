const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildBailianContentForValidation,
  buildBailianVideoBody,
  buildXaiVideoBody,
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

// 适配器解析：提交与查询必须解析到同一个适配器。
//
// 真实踩过的坑：提交时用 credentials.adapterId 解析（正确），
// 查询时只传了 providerId，漏了 adapterId。两侧靠不同的输入各推一次，
// 一旦凭据结构变化就会推出不同的适配器——协议不匹配，任务永远查不到。
// 修复是把 adapterId 存进凭据产物，查询时显式复用。
test('getVideoProviderAdapter 带 adapterId 时精确解析到对应适配器', () => {
  assert.equal(getVideoProviderAdapter('aliyun-bailian', 'dashscope-video').id, 'aliyun-bailian');
  assert.equal(getVideoProviderAdapter('seedance', 'seedance-video').id, 'seedance');
  assert.equal(getVideoProviderAdapter('xai', 'xai-video').id, 'xai');

  // adapterId 优先于 providerId：即使 providerId 认不出来，也能靠 adapterId 定位
  assert.equal(
    getVideoProviderAdapter('unknown-provider', 'dashscope-video').id,
    'aliyun-bailian',
    'adapterId 应当能独立定位适配器'
  );
});

test('百炼与火山的查询路径不同，混用会查不到任务', () => {
  const bailianQuery = getVideoProviderAdapter('aliyun-bailian', 'dashscope-video')
    .buildQueryRequest({ taskId: 't1', apiKey: 'k' });
  const arkQuery = getVideoProviderAdapter('seedance', 'seedance-video')
    .buildQueryRequest({ taskId: 't1', apiKey: 'k' });

  assert.equal(bailianQuery.endpoint, '/api/v1/tasks/t1');
  assert.equal(arkQuery.endpoint, '/api/v3/contents/generations/tasks/t1');
});

test('summarizeVideoUpstream 取任务号而不是请求编号', () => {
  // 百炼真实响应：request_id 与 output.task_id 同时存在
  const bailian = summarizeVideoUpstream({
    request_id: 'req-not-a-task',
    output: { task_id: 'real-task-id', task_status: 'PENDING' },
  });
  assert.equal(bailian.taskId, 'real-task-id', '不能把 request_id 当成任务号');
  assert.equal(bailian.status, 'PENDING');

  // 火山方舟形状
  assert.equal(summarizeVideoUpstream({ id: 'ark-1', status: 'queued' }).taskId, 'ark-1');
  // 只有在没有任务号时才退到 request_id
  assert.equal(summarizeVideoUpstream({ request_id: 'only-req' }).taskId, 'only-req');
});

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

test('xai adapter builds video generation body and normalizes resolution', () => {
  const adapter = getVideoProviderAdapter('xai');
  const capabilityBody = adapter.buildCapabilityBody({
    body: {
      model: 'grok-imagine-video-1.5',
      prompt: 'cinematic dragon fight',
      mode: 'image-to-video',
      images: ['/api/assets/first'],
      ratio: '16:9',
      resolution: '720P',
      duration: 6,
      generateAudio: true,
    },
    req,
  });
  const requestBody = buildXaiVideoBody(
    { mode: 'image-to-video' },
    capabilityBody,
    req
  );

  assert.deepEqual(requestBody, {
    model: 'grok-imagine-video-1.5',
    prompt: 'cinematic dragon fight',
    duration: 6,
    aspect_ratio: '16:9',
    resolution: '720p',
    image: { url: 'https://workbench.example/api/assets/first' },
  });
});

test('video adapter parses upstream task state and video URLs', () => {
  assert.deepEqual(summarizeVideoUpstream({ output: { task_id: 'task-1', task_status: 'SUCCEEDED' } }), {
    taskId: 'task-1',
    status: 'SUCCEEDED',
  });
  assert.deepEqual(summarizeVideoUpstream({ request_id: 'xai-task', status: 'pending' }), {
    taskId: 'xai-task',
    status: 'pending',
  });
  assert.equal(normalizeVideoStatus({ output: { task_status: 'SUCCEEDED' } }), 'succeeded');
  assert.equal(normalizeVideoStatus({ output: { task_status: 'FAILED' } }), 'failed');
  assert.equal(normalizeVideoStatus({ status: 'done' }), 'succeeded');
  assert.equal(findFirstVideoUrl({ output: { video_url: { url: 'https://cdn.example/result.mp4' } } }), 'https://cdn.example/result.mp4');
  assert.equal(findFirstVideoUrl({ video: { url: 'https://cdn.example/xai-result.mp4' } }), 'https://cdn.example/xai-result.mp4');
});

test('video provider registry returns provider specific endpoints', () => {
  assert.equal(getVideoProviderAdapter('seedance').buildQueryRequest({ taskId: 'a', apiKey: 'k' }).endpoint, '/api/v3/contents/generations/tasks/a');
  assert.equal(getVideoProviderAdapter('aliyun-bailian').buildQueryRequest({ taskId: 'a', apiKey: 'k' }).endpoint, '/api/v1/tasks/a');
  assert.equal(getVideoProviderAdapter('xai').buildQueryRequest({ taskId: 'a b', apiKey: 'k' }).endpoint, '/v1/videos/a%20b');
  assert.equal(getVideoProviderAdapter('unknown').id, 'seedance');
});
