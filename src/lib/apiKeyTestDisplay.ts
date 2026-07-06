import type { ProxyApiKeyTestResult } from './apiProxy';

type CapabilityMap = ProxyApiKeyTestResult['capabilities'];

export interface ApiKeyTestLimitRow {
  label: string;
  value: string;
}

export interface ApiKeyTestCheckRow {
  label: string;
  ok: boolean;
  detail: string;
  methodLabel: string;
  billingLabel: string;
  tone: 'success' | 'warning';
}

const REASON_LABELS: Record<string, string> = {
  'Provider does not expose a model-list endpoint template.': '当前厂商没有模型列表接口模板，已跳过自动拉取。',
  'No model was selected for text ping.': '没有选中用于文本测试的模型。',
  'Selected model is not marked as supporting chat.': '当前模型能力表未标记为文本模型。',
  'Text ping was not requested.': '未请求文本实测。',
  'Image capability check passed from the model capability table. No paid image generation was started.': '能力表显示支持图片生成，未发起付费图片生成。',
  'Selected model is not marked as supporting image generation.': '当前模型能力表未标记为图片生成模型。',
  'Image capability check was not requested.': '未请求图片能力检测。',
  'Video capability check passed from the model capability table. No paid video generation was started.': '能力表显示支持视频生成，未发起付费视频生成。',
  'Selected model is not marked as supporting video generation.': '当前模型能力表未标记为视频生成模型。',
  'Video capability check was not requested.': '未请求视频能力检测。',
};

const METHOD_LABELS: Record<string, string> = {
  capability_table: '能力表判断',
  model_list: '模型列表请求',
  not_available: '厂商未提供接口',
  not_requested: '未请求',
  text_ping: '极短文本实测',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boolLabel(value: unknown): string {
  return value ? '支持' : '不支持';
}

function listLabel(value: unknown): string {
  return Array.isArray(value) && value.length > 0 ? value.map(String).join(' / ') : '未声明';
}

function imageResponseFormatLabel(capabilities: CapabilityMap): string {
  const formats = [
    capabilities.responseFormatB64 && 'b64_json',
    capabilities.responseFormatUrl && 'url',
  ].filter(Boolean);
  return formats.length > 0 ? formats.join(' / ') : '未声明';
}

function scopedBoolLabel(enabled: unknown, scope: unknown): string {
  return scope ? boolLabel(enabled) : '未声明';
}

function numberLabel(value: unknown, suffix = ''): string {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? `${number}${suffix}` : '未声明';
}

function numberValue(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function formatAspectRatioLimit(value: number): string {
  if (!value) return '';
  if (value >= 1) return `${formatNumber(value)}:1`;
  return `1:${formatNumber(1 / value)}`;
}

function aspectRatioRangeLabel(min: unknown, max: unknown): string {
  const minValue = numberValue(min);
  const maxValue = numberValue(max);
  if (!minValue && !maxValue) return '未声明';
  return `${formatAspectRatioLimit(minValue) || '不限'}-${formatAspectRatioLimit(maxValue) || '不限'}`;
}

function pixelRangeLabel(min: unknown, max: unknown): string {
  const minValue = numberValue(min);
  const maxValue = numberValue(max);
  if (!minValue && !maxValue) return '未声明';
  return `${minValue || 0}-${maxValue || '不限'} 像素`;
}

function videoDurationLabel(video: Record<string, unknown>, videoGeneration: unknown): string {
  if (!videoGeneration) return '未声明';
  const durationMin = Number(video.durationMin || 0);
  const durationMax = Number(video.durationMax || 0);
  return durationMin || durationMax ? `${durationMin || 0}-${durationMax || '不限'} 秒` : '未声明';
}

function videoReferenceImageLabel(video: Record<string, unknown>, videoGeneration: unknown): string {
  return videoReferenceMediaLabel(video, videoGeneration, 'supportsReferenceImage', 'maxReferenceImages', '张');
}

function videoReferenceMediaLabel(
  video: Record<string, unknown>,
  videoGeneration: unknown,
  supportKey: string,
  maxKey: string,
  unit: string
): string {
  if (!videoGeneration) return '未声明';
  if (!video[supportKey]) return '不支持';
  const max = Number(video[maxKey] || 0);
  return max > 0 ? `支持，最多 ${max} ${unit}` : '支持，未声明上限';
}

function rangeLabel(min: unknown, max: unknown, suffix: string): string {
  const minValue = Number(min || 0);
  const maxValue = Number(max || 0);
  if (!minValue && !maxValue) return '未声明';
  return `${minValue || 0}-${maxValue || '不限'}${suffix}`;
}

export function formatApiKeyTestReason(reason?: string): string {
  if (!reason) return '';
  return REASON_LABELS[reason] || reason;
}

function formatMethodLabel(method?: string): string {
  if (!method) return '自动判断';
  return METHOD_LABELS[method] || method;
}

function formatBillingLabel(check: { method?: string; networkRequest?: boolean; billable?: boolean }): string {
  if (check.billable) return '会访问厂商接口，可能产生极少文本费用';
  if (check.method === 'capability_table') return '只查本地能力表，不生成素材';
  if (check.networkRequest) return '会访问厂商接口，不生成素材';
  if (check.method === 'not_requested') return '本次未执行';
  return '不会发起付费生成';
}

export function summarizeApiKeyTestChecks(result: ProxyApiKeyTestResult): ApiKeyTestCheckRow[] {
  const modelDetail = result.models.skipped
    ? result.models.reason
    : result.models.error || `${result.models.count} 个模型`;
  const checks = [
    {
      label: 'Key / 模型列表',
      ok: result.tests.credentials.ok,
      detail: modelDetail,
      method: result.models.method || (result.models.skipped ? 'not_available' : 'model_list'),
      networkRequest: result.models.networkRequest ?? !result.models.skipped,
      billable: result.models.billable ?? false,
    },
    {
      label: '文本能力',
      ok: result.tests.text.ok,
      detail: result.tests.text.skipped ? result.tests.text.reason : result.tests.text.error || `HTTP ${result.tests.text.status || 'OK'}`,
      method: result.tests.text.method || (result.tests.text.skipped ? 'capability_table' : 'text_ping'),
      networkRequest: result.tests.text.networkRequest ?? !result.tests.text.skipped,
      billable: result.tests.text.billable ?? !result.tests.text.skipped,
    },
    {
      label: '图片能力',
      ok: result.tests.image.ok,
      detail: result.tests.image.reason,
      method: result.tests.image.method || 'capability_table',
      networkRequest: result.tests.image.networkRequest ?? false,
      billable: result.tests.image.billable ?? false,
    },
    {
      label: '视频能力',
      ok: result.tests.video.ok,
      detail: result.tests.video.reason,
      method: result.tests.video.method || 'capability_table',
      networkRequest: result.tests.video.networkRequest ?? false,
      billable: result.tests.video.billable ?? false,
    },
  ];

  return checks.map((check) => ({
    label: check.label,
    ok: check.ok,
    detail: formatApiKeyTestReason(check.detail),
    methodLabel: formatMethodLabel(check.method),
    billingLabel: formatBillingLabel(check),
    tone: check.ok ? 'success' : 'warning',
  }));
}

export function summarizeApiKeyTestLimits(capabilities: CapabilityMap): ApiKeyTestLimitRow[] {
  const image = isRecord(capabilities.image) ? capabilities.image : {};
  const video = isRecord(capabilities.video) ? capabilities.video : {};
  const hasVideo = Boolean(capabilities.videoGeneration);

  const rows: ApiKeyTestLimitRow[] = [
    { label: '文本', value: boolLabel(capabilities.chat) },
    { label: '图片生成', value: boolLabel(capabilities.imageGeneration) },
    { label: '视频生成', value: boolLabel(capabilities.videoGeneration) },
    { label: '参考图', value: boolLabel(capabilities.imageReference || video.supportsReferenceImage) },
    { label: '反向词', value: boolLabel(capabilities.negativePrompt || video.supportsNegativePrompt) },
    { label: 'Seed', value: boolLabel(capabilities.seed || video.supportsSeed) },
    { label: '图片单次数量', value: numberLabel(image.maxImages, ' 张') },
    { label: '图片参考图', value: numberLabel(image.maxReferenceImages, ' 张') },
    { label: '图片尺寸', value: listLabel(image.sizeAliases || image.sizes) },
    { label: '图片像素范围', value: pixelRangeLabel(image.minPixels, image.maxPixels) },
    { label: '图片宽高比', value: aspectRatioRangeLabel(image.minAspectRatio, image.maxAspectRatio) },
    { label: '图片返回格式', value: capabilities.imageGeneration ? imageResponseFormatLabel(capabilities) : '未声明' },
    { label: '图片智能改写', value: scopedBoolLabel(image.supportsPromptExtend, capabilities.imageGeneration) },
    { label: '图片组图连续性', value: scopedBoolLabel(image.supportsSequential, capabilities.imageGeneration) },
    { label: '图片思考模式', value: scopedBoolLabel(image.supportsThinkingMode, capabilities.imageGeneration) },
    { label: '图片水印', value: scopedBoolLabel(image.supportsWatermark, capabilities.imageGeneration) },
    { label: '视频模式', value: hasVideo ? listLabel(video.modes) : '未声明' },
    { label: '视频时长', value: videoDurationLabel(video, hasVideo) },
    { label: '视频参考图', value: videoReferenceImageLabel(video, hasVideo) },
    { label: '视频参考视频', value: videoReferenceMediaLabel(video, hasVideo, 'supportsReferenceVideo', 'maxReferenceVideos', '个') },
    { label: '视频参考音频', value: videoReferenceMediaLabel(video, hasVideo, 'supportsReferenceAudio', 'maxReferenceAudios', '个') },
    { label: '视频参考素材总数', value: hasVideo ? numberLabel(video.maxMediaFiles, ' 个') : '未声明' },
    { label: '视频生成音频', value: scopedBoolLabel(video.supportsAudioGeneration, hasVideo) },
    { label: '视频智能改写', value: scopedBoolLabel(video.supportsPromptExtend, hasVideo) },
    { label: '视频 Seed', value: scopedBoolLabel(video.supportsSeed, hasVideo) },
    { label: '视频反向词', value: scopedBoolLabel(video.supportsNegativePrompt, hasVideo) },
    { label: '视频水印', value: scopedBoolLabel(video.supportsWatermark, hasVideo) },
    { label: '视频 FPS', value: hasVideo ? numberLabel(video.fps) : '未声明' },
    { label: '视频并发', value: hasVideo ? numberLabel(video.concurrency) : '未声明' },
    { label: '视频 RPM', value: hasVideo ? numberLabel(video.rpm) : '未声明' },
    { label: '视频比例', value: hasVideo ? listLabel(video.ratios) : '未声明' },
    { label: '视频分辨率', value: hasVideo ? listLabel(video.resolutions) : '未声明' },
    { label: '视频任务类型', value: hasVideo ? listLabel(video.taskTypes) : '未声明' },
    { label: '视频媒体类型', value: hasVideo ? listLabel(video.mediaTypes) : '未声明' },
    { label: '视频提示词长度', value: hasVideo ? numberLabel(video.promptMaxChars, ' 字') : '未声明' },
    { label: '视频反向词长度', value: hasVideo ? numberLabel(video.negativePromptMaxChars, ' 字') : '未声明' },
    { label: '视频自动音频', value: scopedBoolLabel(video.autoAudioByDefault, hasVideo) },
    { label: '参考音频格式', value: hasVideo ? listLabel(video.audioFormats) : '未声明' },
    { label: '参考音频时长', value: hasVideo ? rangeLabel(video.audioDurationMin, video.audioDurationMax, ' 秒') : '未声明' },
    { label: '参考音频大小', value: hasVideo ? numberLabel(video.audioMaxFileMb, ' MB') : '未声明' },
    { label: '参考图片格式', value: hasVideo ? listLabel(video.imageFormats) : '未声明' },
    { label: '参考图片边长', value: hasVideo ? rangeLabel(video.imageMinSide, video.imageMaxSide, ' px') : '未声明' },
    { label: '参考图片大小', value: hasVideo ? numberLabel(video.imageMaxFileMb, ' MB') : '未声明' },
    { label: '参考视频格式', value: hasVideo ? listLabel(video.videoFormats) : '未声明' },
    { label: '参考视频大小', value: hasVideo ? numberLabel(video.videoMaxFileMb, ' MB') : '未声明' },
    { label: '视频输出格式', value: hasVideo ? listLabel(video.outputFormats) : '未声明' },
    { label: '结果链接有效期', value: hasVideo ? numberLabel(video.resultUrlTtlHours, ' 小时') : '未声明' },
    { label: '查询频控', value: hasVideo ? numberLabel(video.queryRps, ' RPS') : '未声明' },
  ];

  return rows.filter((row) => row.value !== '未声明');
}
