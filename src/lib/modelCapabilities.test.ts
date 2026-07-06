import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeModelCapabilities,
  summarizeModelCapabilityBadges,
  summarizeModelCapabilityUsage,
  validateNodeCapabilityUsage,
} from './modelCapabilities';

const imageA = {
  type: 'image',
  id: 'image-a',
  url: 'https://example.com/a.png',
  fileName: 'a.png',
  createdAt: '2026-07-05T00:00:00.000Z',
};

const imageB = {
  ...imageA,
  id: 'image-b',
  url: 'https://example.com/b.png',
  fileName: 'b.png',
};

const imageC = {
  ...imageA,
  id: 'image-c',
  url: 'https://example.com/c.png',
  fileName: 'c.png',
};

test('model capability badges summarize image model limits', () => {
  const badges = summarizeModelCapabilityBadges('imageGen', {
    imageGeneration: true,
    imageReference: true,
    multiImageReference: true,
    negativePrompt: false,
    seed: true,
    image: {
      maxImages: 4,
      maxReferenceImages: 2,
    },
  }, 5);

  assert.deepEqual(badges.map((item) => item.label), ['图片生成', '参考图≤2', '单次≤4张', '反向词', 'Seed']);
  assert.equal(badges[3].tone, 'warning');
});

test('model capability badges summarize video duration and references', () => {
  const badges = summarizeModelCapabilityBadges('videoGen', {
    videoGeneration: true,
    video: {
      durationMin: 3,
      durationMax: 12,
      maxReferenceImages: 3,
      supportsReferenceImage: true,
      supportsSeed: false,
      supportsNegativePrompt: true,
    },
  }, 4);

  assert.deepEqual(badges.map((item) => item.label), ['视频生成', '3-12秒', '参考图≤3', 'Seed']);
  assert.equal(badges[3].tone, 'warning');
});

test('model capability descriptions expose image pixel and aspect ratio limits', () => {
  const rows = describeModelCapabilities('imageGen', {
    imageGeneration: true,
    imageReference: true,
    multiImageReference: true,
    negativePrompt: false,
    seed: true,
    quality: false,
    responseFormatB64: false,
    responseFormatUrl: true,
    image: {
      maxImages: 12,
      maxReferenceImages: 4,
      sizeAliases: ['1K', '2K'],
      minPixels: 768 * 768,
      maxPixels: 2048 * 2048,
      minAspectRatio: 1 / 8,
      maxAspectRatio: 8,
    },
  });

  assert.deepEqual(
    rows.filter((row) => ['最多生成', '尺寸', '像素范围', '宽高比'].includes(row.label)),
    [
      { label: '最多生成', value: '12 张 / 次' },
      { label: '尺寸', value: '1K / 2K' },
      { label: '像素范围', value: '589824-4194304 像素' },
      { label: '宽高比', value: '1:8-8:1' },
    ]
  );
});

test('model capability descriptions expose video modes, fps, rate limits, and task types', () => {
  const rows = describeModelCapabilities('videoGen', {
    videoGeneration: true,
    video: {
      modes: ['image-to-video', 'video-extension'],
      durationMin: 4,
      durationMax: 15,
      fps: 24,
      ratios: ['16:9', '9:16'],
      resolutions: ['480P', '720P'],
      maxReferenceImages: 2,
      maxReferenceVideos: 1,
      maxReferenceAudios: 1,
      supportsReferenceImage: true,
      supportsReferenceVideo: true,
      supportsReferenceAudio: true,
      supportsAudioGeneration: true,
      supportsPromptExtend: false,
      supportsSeed: true,
      supportsNegativePrompt: false,
      supportsWatermark: true,
      concurrency: 3,
      rpm: 180,
      taskTypes: ['multimodal_video_generation', 'video_extension'],
      mediaTypes: ['first_frame', 'last_frame'],
    },
  });

  assert.deepEqual(
    rows.filter((row) => ['模式', '帧率', '参考视频', '参考音频', '频控', '任务类型', '媒体类型'].includes(row.label)),
    [
      { label: '模式', value: 'image-to-video / video-extension' },
      { label: '帧率', value: '24 fps' },
      { label: '参考视频', value: '支持，最多 1 个' },
      { label: '参考音频', value: '支持，最多 1 个' },
      { label: '频控', value: '并发 3 / RPM 180' },
      { label: '任务类型', value: 'multimodal_video_generation / video_extension' },
      { label: '媒体类型', value: 'first_frame / last_frame' },
    ]
  );
});

test('model capability usage summarizes current image request limits', () => {
  const rows = summarizeModelCapabilityUsage(
    'imageGen',
    {
      n: 5,
      size: '2048x2048',
      responseFormat: 'url',
    },
    {
      referenceImages: [imageA, imageB, imageC],
    },
    {
      imageGeneration: true,
      imageReference: true,
      multiImageReference: true,
      responseFormatUrl: false,
      image: {
        maxImages: 4,
        maxReferenceImages: 2,
        sizes: ['1024x1024'],
      },
    }
  );

  assert.deepEqual(rows, [
    { label: '生成数量', value: '5 / 4 张', tone: 'warning' },
    { label: '参考图', value: '3 / 2 张', tone: 'warning' },
    { label: '尺寸', value: '2048x2048', tone: 'warning' },
    { label: '返回格式', value: 'url', tone: 'warning' },
  ]);
});

test('model capability usage summarizes current video request limits', () => {
  const rows = summarizeModelCapabilityUsage(
    'videoGen',
    {
      duration: 20,
      aspectRatio: '4:3',
      resolution: '1080P',
    },
    {
      images: [imageA, imageB],
    },
    {
      videoGeneration: true,
      video: {
        durationMin: 3,
        durationMax: 12,
        ratios: ['16:9'],
        resolutions: ['720P'],
        maxReferenceImages: 3,
        maxReferenceVideos: 1,
        maxReferenceAudios: 1,
        supportsReferenceImage: true,
        supportsReferenceVideo: true,
        supportsReferenceAudio: true,
      },
    }
  );

  assert.deepEqual(rows, [
    { label: '生成模式', value: 'images-to-video', tone: 'neutral' },
    { label: '时长', value: '20 秒 / 3-12 秒', tone: 'warning' },
    { label: '参考图', value: '2 / 3 张', tone: 'success' },
    { label: '比例', value: '4:3', tone: 'warning' },
    { label: '分辨率', value: '1080P', tone: 'warning' },
    { label: '参考视频', value: '0 / 1 个', tone: 'neutral' },
    { label: '参考音频', value: '0 / 1 个', tone: 'neutral' },
  ]);
});

test('model capability validation catches unsupported explicit and inferred video modes', () => {
  const capabilities = {
    videoGeneration: true,
    video: {
      modes: ['text-to-video'],
      supportsReferenceImage: true,
    },
  };

  assert.deepEqual(
    validateNodeCapabilityUsage('videoGen', { mode: 'image-to-video' }, {}, capabilities),
    ['生成模式不支持：当前是 image-to-video，可选 text-to-video。']
  );

  assert.deepEqual(
    validateNodeCapabilityUsage('videoGen', { mode: 'auto' }, { image: imageA }, capabilities),
    ['生成模式不支持：当前是 image-to-video，可选 text-to-video。']
  );

  assert.deepEqual(
    summarizeModelCapabilityUsage('videoGen', { mode: 'auto' }, { image: imageA }, capabilities)[0],
    { label: '生成模式', value: 'image-to-video', tone: 'warning' }
  );
});

test('model capability validation catches image limits from config and connected parameter nodes', () => {
  const issues = validateNodeCapabilityUsage(
    'imageGen',
    {
      n: 1,
      size: '2048x2048',
      responseFormat: 'url',
      watermark: true,
      promptExtend: true,
      enableSequential: true,
      thinkingMode: true,
    },
    {
      count: { type: 'parameter', key: 'count', value: 5 },
      negativePrompt: { type: 'parameter', key: 'negativePrompt', value: 'low quality' },
      seed: { type: 'parameter', key: 'seed', value: 42 },
      quality: { type: 'parameter', key: 'quality', value: 'high' },
      referenceImages: [imageA, imageB, imageC],
    },
    {
      imageGeneration: true,
      imageReference: true,
      multiImageReference: true,
      negativePrompt: false,
      seed: false,
      quality: false,
      responseFormatB64: true,
      responseFormatUrl: false,
      image: {
        maxImages: 4,
        maxReferenceImages: 2,
        sizes: ['1024x1024'],
        supportsWatermark: false,
        supportsPromptExtend: false,
        supportsSequential: false,
        supportsThinkingMode: false,
      },
    }
  );

  assert.deepEqual(issues, [
    '数量超过限制：最多 4 张。',
    '尺寸不支持：可选 1024x1024。',
    '当前模型不支持反向词，运行时会忽略。',
    '当前模型不支持 Seed，运行时会忽略。',
    '当前模型不支持质量参数，运行时会忽略。',
    '当前模型不支持 URL 返回，请改用 b64_json。',
    '参考图超过限制：最多 2 张。',
    '当前模型不支持水印参数，运行时会忽略。',
    '当前模型不支持智能改写 Prompt，运行时会忽略。',
    '当前模型不支持组图连续性，运行时会忽略。',
    '当前模型不支持思考模式，运行时会忽略。',
  ]);
});

test('model capability validation catches image pixel and aspect ratio limits', () => {
  assert.deepEqual(
    validateNodeCapabilityUsage('imageGen', { size: '64x64' }, {}, {
      imageGeneration: true,
      image: { minPixels: 409_600 },
    }),
    ['尺寸太小：至少 409600 像素。']
  );

  assert.deepEqual(
    validateNodeCapabilityUsage('imageGen', { size: '4096x4096' }, {}, {
      imageGeneration: true,
      image: { maxPixels: 4_194_304 },
    }),
    ['尺寸太大：最多 4194304 像素。']
  );

  assert.deepEqual(
    validateNodeCapabilityUsage('imageGen', { size: '10000x500' }, {}, {
      imageGeneration: true,
      image: { minAspectRatio: 0.125, maxAspectRatio: 8 },
    }),
    ['尺寸比例不支持：需在 1:8 到 8:1 之间。']
  );
});

test('model capability validation catches video hard limits and unsupported options', () => {
  const capabilities = {
    videoGeneration: true,
    video: {
      durationMin: 4,
      durationMax: 15,
      ratios: ['16:9'],
      resolutions: ['720P'],
      supportsReferenceImage: true,
      maxReferenceImages: 2,
      maxReferenceVideos: 1,
      maxReferenceAudios: 1,
      supportsReferenceVideo: false,
      supportsReferenceAudio: false,
      supportsAudioGeneration: false,
      supportsPromptExtend: false,
      supportsSeed: false,
      supportsNegativePrompt: false,
      supportsWatermark: false,
    },
  };

  const issues = validateNodeCapabilityUsage(
    'videoGen',
    {
      duration: 5,
      ratio: '4:3',
      resolution: '1080P',
      referenceVideoUrl: 'https://example.com/ref.mp4',
      referenceAudioUrl: 'https://example.com/ref.mp3',
      generateAudio: true,
      promptExtend: true,
      seed: 123,
      negativePrompt: 'bad frame',
      watermark: true,
    },
    {
      duration: { type: 'parameter', key: 'duration', value: 2 },
      images: [imageA, imageB, imageC],
      referenceVideos: [
        { type: 'video', id: 'video-a', url: 'https://example.com/a.mp4', createdAt: '2026-07-05T00:00:00.000Z' },
        { type: 'video', id: 'video-b', url: 'https://example.com/b.mp4', createdAt: '2026-07-05T00:00:00.000Z' },
      ],
      referenceAudios: ['https://example.com/a.mp3', 'https://example.com/b.mp3'],
    },
    capabilities
  );

  assert.deepEqual(issues, [
    '时长太短：最短 4 秒。',
    '分辨率不支持：可选 720P。',
    '比例不支持：可选 16:9。',
    '参考图超过限制：最多 2 张。',
    '当前模型不支持参考视频。',
    '参考视频超过限制：最多 1 个。',
    '当前模型不支持参考音频。',
    '参考音频超过限制：最多 1 个。',
    '当前模型不支持生成音频。',
    '当前模型不支持智能改写 Prompt，运行时会忽略。',
    '当前模型不支持 Seed，运行时会忽略。',
    '当前模型不支持反向提示词，运行时会忽略。',
    '当前模型不支持水印参数，运行时会忽略。',
  ]);
});

test('model capability validation catches video duration max and unsupported reference images', () => {
  assert.deepEqual(
    validateNodeCapabilityUsage(
      'videoGen',
      { duration: 20, aspectRatio: '16:9', resolution: '720P' },
      { image: imageA },
      {
        videoGeneration: true,
        video: {
          durationMin: 4,
          durationMax: 15,
          ratios: ['16:9'],
          resolutions: ['720P'],
          supportsReferenceImage: false,
        },
      }
    ),
    [
      '时长太长：最长 15 秒。',
      '当前模型不支持参考图。',
    ]
  );
});
