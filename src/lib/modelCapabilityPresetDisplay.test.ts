import test from 'node:test';
import assert from 'node:assert/strict';
import { groupModelCapabilityPresetsByProvider, summarizeModelCapabilityPresetPreview } from './modelCapabilityPresetDisplay';
import type { ProxyModelCapabilityPreset } from './apiProxy';

function preset(id: string, providerId: string): ProxyModelCapabilityPreset {
  return {
    id,
    label: id,
    description: '',
    providerId,
    modelPattern: '*',
    capabilities: {},
  };
}

test('groupModelCapabilityPresetsByProvider keeps current provider presets separate', () => {
  const grouped = groupModelCapabilityPresetsByProvider([
    preset('openai-default', 'openai-compatible'),
    preset('seedance-video', 'seedance'),
    preset('bailian-image', 'aliyun-bailian'),
  ], 'seedance');

  assert.deepEqual(grouped.matching.map((item) => item.id), ['seedance-video']);
  assert.deepEqual(grouped.others.map((item) => item.id), ['openai-default', 'bailian-image']);
});

test('summarizeModelCapabilityPresetPreview keeps advanced model limits visible', () => {
  const rows = summarizeModelCapabilityPresetPreview({
    ...preset('seedance-video', 'seedance'),
    capabilities: {
      chat: false,
      imageGeneration: false,
      videoGeneration: true,
      imageReference: true,
      seed: true,
      video: {
        modes: ['text-to-video', 'image-to-video', 'images-to-video'],
        durationMin: 3,
        durationMax: 15,
        maxReferenceImages: 4,
        supportsReferenceImage: true,
        supportsReferenceVideo: true,
        supportsReferenceAudio: true,
        supportsAudioGeneration: true,
        supportsPromptExtend: true,
        supportsSeed: true,
        supportsWatermark: false,
        fps: 24,
        concurrency: 3,
        rpm: 180,
        ratios: ['16:9', '9:16'],
        resolutions: ['720P', '1080P'],
        taskTypes: ['text2video', 'image2video'],
        mediaTypes: ['image', 'video', 'audio'],
      },
    },
  });

  assert.ok(rows.length > 12);
  assert.equal(rows.find((row) => row.label === '视频参考图')?.value, '支持，最多 4 张');
  assert.equal(rows.find((row) => row.label === '视频参考视频')?.value, '支持，未声明上限');
  assert.equal(rows.find((row) => row.label === '视频参考音频')?.value, '支持，未声明上限');
  assert.equal(rows.find((row) => row.label === '视频任务类型')?.value, 'text2video / image2video');
  assert.equal(rows.find((row) => row.label === '视频媒体类型')?.value, 'image / video / audio');
});
