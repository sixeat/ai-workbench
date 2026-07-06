import test from 'node:test';
import assert from 'node:assert/strict';
import { describeModelCapabilityFieldHint } from './modelCapabilities';

test('model capability field hints explain image generation limits', () => {
  const capabilities = {
    imageGeneration: true,
    imageReference: true,
    negativePrompt: false,
    seed: true,
    quality: false,
    responseFormatB64: false,
    responseFormatUrl: true,
    image: {
      maxImages: 4,
      maxReferenceImages: 2,
      sizeAliases: ['1K', '2K'],
      supportsPromptExtend: false,
    },
  };

  assert.deepEqual(describeModelCapabilityFieldHint('imageGen', 'n', capabilities), {
    text: '当前模型单次最多生成 4 张。',
    tone: 'neutral',
  });
  assert.deepEqual(describeModelCapabilityFieldHint('imageGen', 'negativePrompt', capabilities), {
    text: '当前模型不支持反向词，运行时会忽略。',
    tone: 'warning',
  });
  assert.deepEqual(describeModelCapabilityFieldHint('imageGen', 'seed', capabilities), {
    text: '当前模型支持固定 Seed。',
    tone: 'success',
  });
  assert.deepEqual(describeModelCapabilityFieldHint('imageGen', 'responseFormat', capabilities), {
    text: '支持返回格式：url。',
    tone: 'neutral',
  });
  assert.deepEqual(describeModelCapabilityFieldHint('imageGen', 'promptExtend', capabilities), {
    text: '当前模型不支持智能改写 Prompt，运行时会忽略。',
    tone: 'warning',
  });
});

test('model capability field hints explain video generation limits', () => {
  const capabilities = {
    videoGeneration: true,
    video: {
      modes: ['text-to-video', 'image-to-video'],
      durationMin: 4,
      durationMax: 15,
      ratios: ['16:9', '9:16'],
      resolutions: ['480P', '720P'],
      maxReferenceImages: 2,
      maxReferenceVideos: 1,
      maxReferenceAudios: 1,
      supportsReferenceVideo: false,
      supportsReferenceAudio: true,
      supportsAudioGeneration: false,
      supportsPromptExtend: true,
      supportsSeed: false,
      supportsNegativePrompt: true,
      supportsWatermark: false,
    },
  };

  assert.deepEqual(describeModelCapabilityFieldHint('videoGen', 'duration', capabilities), {
    text: '当前模型支持时长：4-15 秒。',
    tone: 'neutral',
  });
  assert.deepEqual(describeModelCapabilityFieldHint('videoGen', 'mode', capabilities), {
    text: '当前模型支持模式：text-to-video / image-to-video。',
    tone: 'neutral',
  });
  assert.deepEqual(describeModelCapabilityFieldHint('videoGen', 'aspectRatio', capabilities), {
    text: '当前模型支持比例：16:9 / 9:16。',
    tone: 'neutral',
  });
  assert.deepEqual(describeModelCapabilityFieldHint('videoGen', 'referenceVideoUrl', capabilities), {
    text: '当前模型不支持参考视频。',
    tone: 'warning',
  });
  assert.deepEqual(describeModelCapabilityFieldHint('videoGen', 'referenceAudioUrl', capabilities), {
    text: '当前模型支持参考音频，最多 1 个。',
    tone: 'success',
  });
  assert.deepEqual(describeModelCapabilityFieldHint('videoGen', 'promptExtend', capabilities), {
    text: '当前模型支持智能改写 Prompt。',
    tone: 'success',
  });
});
