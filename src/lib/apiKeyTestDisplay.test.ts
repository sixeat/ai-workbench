import test from 'node:test';
import assert from 'node:assert/strict';
import { formatApiKeyTestReason, summarizeApiKeyTestChecks, summarizeApiKeyTestLimits } from './apiKeyTestDisplay';

test('formatApiKeyTestReason translates known provider test reasons', () => {
  assert.equal(
    formatApiKeyTestReason('Selected model is not marked as supporting image generation.'),
    '当前模型能力表未标记为图片生成模型。'
  );
  assert.equal(formatApiKeyTestReason('custom provider detail'), 'custom provider detail');
});

test('summarizeApiKeyTestLimits exposes image and video model limits', () => {
  const rows = summarizeApiKeyTestLimits({
    chat: true,
    imageGeneration: true,
    videoGeneration: true,
    imageReference: true,
    negativePrompt: false,
    seed: true,
    responseFormatB64: false,
    responseFormatUrl: true,
    image: {
      maxImages: 4,
      maxReferenceImages: 2,
      sizeAliases: ['1K', '2K'],
      minPixels: 1024,
      maxPixels: 4194304,
      minAspectRatio: 0.125,
      maxAspectRatio: 8,
      supportsPromptExtend: true,
      supportsSequential: false,
      supportsThinkingMode: true,
      supportsWatermark: false,
    },
    video: {
      modes: ['text-to-video', 'image-to-video'],
      durationMin: 3,
      durationMax: 12,
      maxReferenceImages: 3,
      maxReferenceVideos: 1,
      maxReferenceAudios: 1,
      ratios: ['16:9', '9:16'],
      resolutions: ['720P'],
      supportsReferenceImage: true,
      supportsReferenceVideo: true,
      supportsReferenceAudio: true,
      supportsAudioGeneration: false,
      supportsPromptExtend: true,
      supportsSeed: true,
      supportsNegativePrompt: true,
      supportsWatermark: false,
      fps: 24,
      concurrency: 3,
      rpm: 180,
      taskTypes: ['text2video', 'image2video'],
      mediaTypes: ['image', 'video', 'audio'],
    },
  });

  assert.deepEqual(
    rows.map((row) => [row.label, row.value]),
    [
      ['文本', '支持'],
      ['图片生成', '支持'],
      ['视频生成', '支持'],
      ['参考图', '支持'],
      ['反向词', '支持'],
      ['Seed', '支持'],
      ['图片单次数量', '4 张'],
      ['图片参考图', '2 张'],
      ['图片尺寸', '1K / 2K'],
      ['图片像素范围', '1024-4194304 像素'],
      ['图片宽高比', '1:8-8:1'],
      ['图片返回格式', 'url'],
      ['图片智能改写', '支持'],
      ['图片组图连续性', '不支持'],
      ['图片思考模式', '支持'],
      ['图片水印', '不支持'],
      ['视频模式', 'text-to-video / image-to-video'],
      ['视频时长', '3-12 秒'],
      ['视频参考图', '支持，最多 3 张'],
      ['视频参考视频数量', '1 个'],
      ['视频参考音频数量', '1 个'],
      ['视频参考视频', '支持'],
      ['视频参考音频', '支持'],
      ['视频生成音频', '不支持'],
      ['视频智能改写', '支持'],
      ['视频 Seed', '支持'],
      ['视频反向词', '支持'],
      ['视频水印', '不支持'],
      ['视频 FPS', '24'],
      ['视频并发', '3'],
      ['视频 RPM', '180'],
      ['视频比例', '16:9 / 9:16'],
      ['视频分辨率', '720P'],
      ['视频任务类型', 'text2video / image2video'],
      ['视频媒体类型', 'image / video / audio'],
    ]
  );
});

test('summarizeApiKeyTestChecks explains test method and billing risk', () => {
  const rows = summarizeApiKeyTestChecks({
    apiKeyId: 'key-1',
    providerId: 'openai-compatible',
    baseUrl: 'https://api.example.com',
    selectedModel: 'gpt-image-1',
    models: {
      ok: true,
      method: 'model_list',
      networkRequest: true,
      billable: false,
      count: 2,
      models: [{ id: 'gpt-image-1' }],
    },
    capabilities: {},
    tests: {
      credentials: { ok: true },
      text: {
        ok: true,
        method: 'text_ping',
        networkRequest: true,
        billable: true,
        status: 200,
      },
      image: {
        ok: true,
        skipped: true,
        method: 'capability_table',
        networkRequest: false,
        billable: false,
        reason: 'Image capability check passed from the model capability table. No paid image generation was started.',
      },
      video: {
        ok: false,
        skipped: true,
        method: 'not_requested',
        networkRequest: false,
        billable: false,
        reason: 'Video capability check was not requested.',
      },
    },
  });

  assert.deepEqual(
    rows.map((row) => [row.label, row.methodLabel, row.billingLabel, row.detail]),
    [
      ['Key / 模型列表', '模型列表请求', '会访问厂商接口，不生成素材', '2 个模型'],
      ['文本能力', '极短文本实测', '会访问厂商接口，可能产生极少文本费用', 'HTTP 200'],
      ['图片能力', '能力表判断', '只查本地能力表，不生成素材', '能力表显示支持图片生成，未发起付费图片生成。'],
      ['视频能力', '未请求', '本次未执行', '未请求视频能力检测。'],
    ]
  );
  assert.equal(rows[2].tone, 'success');
  assert.equal(rows[3].tone, 'warning');
});
