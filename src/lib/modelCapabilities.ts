import type { ProxyModelCapabilities } from './apiProxy';
import type { NodeConfig, NodeInputs, NodeType } from '../types/nodes';
import { getParameter, isImageAsset, isRecord, isShotList, isVideoAsset } from '../engine/workflowValues';

type CapabilityMap = Record<string, unknown>;

export interface ModelCapabilityBadge {
  label: string;
  tone: 'neutral' | 'success' | 'warning';
}

export interface ModelCapabilityFieldHint {
  text: string;
  tone: 'neutral' | 'success' | 'warning';
}

export interface ModelCapabilityUsageRow {
  label: string;
  value: string;
  tone: 'neutral' | 'success' | 'warning';
}

const BASE_CAPABILITIES: CapabilityMap = {
  chat: true,
  imageGeneration: false,
  imageReference: false,
  multiImageReference: false,
  negativePrompt: false,
  seed: false,
  quality: false,
  responseFormatB64: true,
  responseFormatUrl: true,
  videoGeneration: false,
  image: {},
  video: {},
};

function mergeCapabilities(base: CapabilityMap, patch: CapabilityMap): CapabilityMap {
  const baseImage = isRecord(base.image) ? base.image : {};
  const patchImage = isRecord(patch.image) ? patch.image : {};
  const baseVideo = isRecord(base.video) ? base.video : {};
  const patchVideo = isRecord(patch.video) ? patch.video : {};

  return {
    ...base,
    ...patch,
    image: {
      ...baseImage,
      ...patchImage,
    },
    video: {
      ...baseVideo,
      ...patchVideo,
    },
  };
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 'i');
}

function listText(value: unknown): string {
  return Array.isArray(value) && value.length > 0 ? value.map(String).join(' / ') : '未声明';
}

function optionalListText(value: unknown): string {
  return Array.isArray(value) && value.length > 0 ? value.map(String).join(' / ') : '';
}

function countImages(value: unknown): number {
  if (!value) return 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countImages(item), 0);
  if (isImageAsset(value)) return 1;
  if (isShotList(value)) return value.items.filter((item) => item.image).length;
  return 0;
}

function countMediaReferences(value: unknown, type: 'video' | 'audio'): number {
  if (!value) return 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countMediaReferences(item, type), 0);
  if (type === 'video' && isVideoAsset(value)) return 1;
  if (typeof value === 'string') return value.trim() ? 1 : 0;
  if (isRecord(value) && typeof value.url === 'string') return value.url.trim() ? 1 : 0;
  return 0;
}

function referenceVideoCount(config: NodeConfig, inputs: NodeInputs): number {
  return countMediaReferences(inputs.video, 'video') +
    countMediaReferences(inputs.videos, 'video') +
    countMediaReferences(inputs.referenceVideo, 'video') +
    countMediaReferences(inputs.referenceVideos, 'video') +
    countMediaReferences(config.referenceVideoUrl, 'video');
}

function referenceAudioCount(config: NodeConfig, inputs: NodeInputs): number {
  return countMediaReferences(inputs.audio, 'audio') +
    countMediaReferences(inputs.audios, 'audio') +
    countMediaReferences(inputs.referenceAudio, 'audio') +
    countMediaReferences(inputs.referenceAudios, 'audio') +
    countMediaReferences(config.referenceAudioUrl, 'audio');
}

function hasShotList(value: unknown): boolean {
  if (!value) return false;
  if (isShotList(value)) return true;
  if (Array.isArray(value)) return value.some(hasShotList);
  return false;
}

function capabilitySection(capabilities: CapabilityMap, key: string): Record<string, unknown> {
  const value = capabilities[key];
  return isRecord(value) ? value : {};
}

function numberValue(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
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

function formatAspectRatioRange(min: unknown, max: unknown): string {
  const minValue = numberValue(min);
  const maxValue = numberValue(max);
  if (!minValue && !maxValue) return '';
  return `${formatAspectRatioLimit(minValue) || '不限'}-${formatAspectRatioLimit(maxValue) || '不限'}`;
}

function formatPixelRange(min: unknown, max: unknown): string {
  const minValue = numberValue(min);
  const maxValue = numberValue(max);
  if (!minValue && !maxValue) return '';
  return `${minValue || 0}-${maxValue || '不限'} 像素`;
}

function parameterNumber(inputs: NodeInputs, key: string, fallback: unknown): number {
  const parsed = Number(getParameter(inputs, key, Number(fallback || 0)));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parameterString(inputs: NodeInputs, keys: string[], fallback: unknown): string {
  for (const key of keys) {
    const value = getParameter(inputs, key, '');
    if (value !== '') return String(value);
  }
  return String(fallback || '');
}

function inferVideoMode(config: NodeConfig, inputs: NodeInputs): string {
  const configured = String(config.mode || 'auto');
  if (configured && configured !== 'auto') return configured;

  if (hasShotList(inputs.images) || hasShotList(inputs.prompt) || hasShotList(inputs.shotList)) return 'shotlist-to-video';

  const imageCount = countImages(inputs.image) + countImages(inputs.images) + countImages(inputs.shotList);
  if (imageCount > 1) return 'images-to-video';
  if (imageCount === 1) return 'image-to-video';
  return 'text-to-video';
}

function parseImageSize(value: unknown): { width: number; height: number } | null {
  const match = String(value || '').trim().match(/^(\d+)\s*[*x]\s*(\d+)$/i);
  if (!match) return null;
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function validateImageSize(size: string, image: Record<string, unknown>): string | null {
  const aliases = stringArray(image.sizeAliases);
  if (aliases.includes(size)) return null;

  const allowedSizes = stringArray(image.sizes);
  if (allowedSizes.length > 0 && !allowedSizes.includes(size)) {
    return `尺寸不支持：可选 ${allowedSizes.join(' / ')}。`;
  }

  const parsed = parseImageSize(size);
  if (!parsed) {
    if (aliases.length > 0) {
      return `尺寸不支持：可选 ${aliases.join(' / ')}，或使用 2048*2048 这类自定义尺寸。`;
    }
    return null;
  }

  const pixels = parsed.width * parsed.height;
  const ratio = parsed.width / parsed.height;
  const minPixels = numberValue(image.minPixels);
  const maxPixels = numberValue(image.maxPixels);
  const minAspectRatio = numberValue(image.minAspectRatio);
  const maxAspectRatio = numberValue(image.maxAspectRatio);

  if (minPixels && pixels < minPixels) return `尺寸太小：至少 ${minPixels} 像素。`;
  if (maxPixels && pixels > maxPixels) return `尺寸太大：最多 ${maxPixels} 像素。`;
  if (minAspectRatio && ratio < minAspectRatio) return '尺寸比例不支持：需在 1:8 到 8:1 之间。';
  if (maxAspectRatio && ratio > maxAspectRatio) return '尺寸比例不支持：需在 1:8 到 8:1 之间。';
  return null;
}

function supportedText(value: unknown): string {
  return value ? '支持' : '不支持';
}

function badge(label: string, supported = true): ModelCapabilityBadge {
  return { label, tone: supported ? 'success' : 'warning' };
}

function hint(text: string, tone: ModelCapabilityFieldHint['tone'] = 'neutral'): ModelCapabilityFieldHint {
  return { text, tone };
}

function usageRow(label: string, value: string, tone: ModelCapabilityUsageRow['tone'] = 'neutral'): ModelCapabilityUsageRow {
  return { label, value, tone };
}

export function resolveModelCapabilities(
  records: ProxyModelCapabilities[],
  providerId?: string,
  model?: string
): CapabilityMap | null {
  if (!providerId || !model) return null;
  let resolved = { ...BASE_CAPABILITIES };

  for (const record of records.filter((item) => item.providerId === providerId)) {
    if (record.modelPattern === '*' || wildcardToRegExp(record.modelPattern).test(model)) {
      resolved = mergeCapabilities(resolved, record.capabilities || {});
    }
  }

  return resolved;
}

export function describeModelCapabilities(
  nodeType: NodeType,
  capabilities: CapabilityMap | null
): Array<{ label: string; value: string }> {
  if (!capabilities) return [];
  const rows: Array<{ label: string; value: string }> = [];

  if (nodeType === 'imageGen' || nodeType === 'imageToImage') {
    const image = capabilitySection(capabilities, 'image');
    const maxImages = numberValue(image.maxImages);
    const maxReferenceImages = numberValue(image.maxReferenceImages);
    const pixelRange = formatPixelRange(image.minPixels, image.maxPixels);
    const aspectRatioRange = formatAspectRatioRange(image.minAspectRatio, image.maxAspectRatio);
    rows.push({ label: '图片生成', value: supportedText(capabilities.imageGeneration) });
    rows.push({
      label: '参考图',
      value: capabilities.imageReference
        ? `${capabilities.multiImageReference ? '支持多图' : '支持单图'}${maxReferenceImages ? `，最多 ${maxReferenceImages} 张` : ''}`
        : '不支持',
    });
    rows.push({ label: '最多生成', value: maxImages ? `${maxImages} 张 / 次` : '未声明' });
    rows.push({ label: '尺寸', value: listText(image.sizeAliases || image.sizes) });
    if (pixelRange) rows.push({ label: '像素范围', value: pixelRange });
    if (aspectRatioRange) rows.push({ label: '宽高比', value: aspectRatioRange });
    rows.push({ label: '反向词', value: supportedText(capabilities.negativePrompt) });
    rows.push({ label: 'Seed', value: supportedText(capabilities.seed) });
    rows.push({ label: '质量参数', value: supportedText(capabilities.quality) });
    rows.push({ label: '智能改写', value: supportedText(image.supportsPromptExtend) });
    rows.push({ label: '水印参数', value: supportedText(image.supportsWatermark) });
    rows.push({ label: '组图连续性', value: supportedText(image.supportsSequential) });
    rows.push({
      label: '返回格式',
      value: [capabilities.responseFormatB64 && 'b64_json', capabilities.responseFormatUrl && 'url'].filter(Boolean).join(' / ') || '未声明',
    });
  }

  if (nodeType === 'videoGen' || nodeType === 'multiImageVideo') {
    const video = capabilitySection(capabilities, 'video');
    const durationMin = numberValue(video.durationMin);
    const durationMax = numberValue(video.durationMax);
    const maxReferenceImages = numberValue(video.maxReferenceImages);
    const maxReferenceVideos = numberValue(video.maxReferenceVideos);
    const maxReferenceAudios = numberValue(video.maxReferenceAudios);
    const modes = optionalListText(video.modes);
    const fps = numberValue(video.fps);
    const taskTypes = optionalListText(video.taskTypes);
    const mediaTypes = optionalListText(video.mediaTypes);
    const concurrency = numberValue(video.concurrency);
    const rpm = numberValue(video.rpm);
    rows.push({ label: '视频生成', value: supportedText(capabilities.videoGeneration) });
    if (modes) rows.push({ label: '模式', value: modes });
    rows.push({ label: '时长', value: durationMin || durationMax ? `${durationMin || 0}-${durationMax || '不限'} 秒` : '未声明' });
    if (fps) rows.push({ label: '帧率', value: `${fps} fps` });
    rows.push({ label: '分辨率', value: listText(video.resolutions) });
    rows.push({ label: '比例', value: listText(video.ratios) });
    rows.push({
      label: '参考图',
      value: video.supportsReferenceImage ? `支持${maxReferenceImages ? `，最多 ${maxReferenceImages} 张` : ''}` : '不支持',
    });
    rows.push({
      label: '参考视频',
      value: video.supportsReferenceVideo ? `支持${maxReferenceVideos ? `，最多 ${maxReferenceVideos} 个` : ''}` : '不支持',
    });
    rows.push({
      label: '参考音频',
      value: video.supportsReferenceAudio ? `支持${maxReferenceAudios ? `，最多 ${maxReferenceAudios} 个` : ''}` : '不支持',
    });
    rows.push({ label: '生成音频', value: supportedText(video.supportsAudioGeneration) });
    rows.push({ label: '智能改写', value: supportedText(video.supportsPromptExtend) });
    rows.push({ label: 'Seed', value: supportedText(video.supportsSeed) });
    rows.push({ label: '反向词', value: supportedText(video.supportsNegativePrompt) });
    rows.push({ label: '水印', value: supportedText(video.supportsWatermark) });
    if (concurrency || rpm) {
      rows.push({ label: '频控', value: [concurrency && `并发 ${concurrency}`, rpm && `RPM ${rpm}`].filter(Boolean).join(' / ') });
    }
    if (taskTypes) rows.push({ label: '任务类型', value: taskTypes });
    if (mediaTypes) rows.push({ label: '媒体类型', value: mediaTypes });
  }

  return rows;
}

export function summarizeModelCapabilityBadges(
  nodeType: NodeType,
  capabilities: CapabilityMap | null,
  limit = 3
): ModelCapabilityBadge[] {
  if (!capabilities) return [];
  const badges: ModelCapabilityBadge[] = [];

  if (nodeType === 'imageGen' || nodeType === 'imageToImage') {
    const image = capabilitySection(capabilities, 'image');
    const maxImages = numberValue(image.maxImages);
    const maxReferenceImages = numberValue(image.maxReferenceImages);
    badges.push(badge(capabilities.imageGeneration ? '图片生成' : '非图片模型', Boolean(capabilities.imageGeneration)));
    badges.push(badge(
      capabilities.imageReference
        ? `参考图${maxReferenceImages ? `≤${maxReferenceImages}` : ''}`
        : '不支持参考图',
      Boolean(capabilities.imageReference)
    ));
    if (maxImages) badges.push({ label: `单次≤${maxImages}张`, tone: 'neutral' });
    badges.push(badge('反向词', Boolean(capabilities.negativePrompt)));
    badges.push(badge('Seed', Boolean(capabilities.seed)));
  }

  if (nodeType === 'videoGen' || nodeType === 'multiImageVideo') {
    const video = capabilitySection(capabilities, 'video');
    const durationMin = numberValue(video.durationMin);
    const durationMax = numberValue(video.durationMax);
    const maxReferenceImages = numberValue(video.maxReferenceImages);
    badges.push(badge(capabilities.videoGeneration ? '视频生成' : '非视频模型', Boolean(capabilities.videoGeneration)));
    if (durationMin || durationMax) badges.push({ label: `${durationMin || 0}-${durationMax || '不限'}秒`, tone: 'neutral' });
    badges.push(badge(
      video.supportsReferenceImage
        ? `参考图${maxReferenceImages ? `≤${maxReferenceImages}` : ''}`
        : '不支持参考图',
      Boolean(video.supportsReferenceImage)
    ));
    badges.push(badge('Seed', Boolean(video.supportsSeed)));
    badges.push(badge('反向词', Boolean(video.supportsNegativePrompt)));
  }

  return badges.slice(0, limit);
}

export function describeModelCapabilityFieldHint(
  nodeType: NodeType,
  fieldKey: string,
  capabilities: CapabilityMap | null
): ModelCapabilityFieldHint | null {
  if (!capabilities) return null;

  if (nodeType === 'imageGen' || nodeType === 'imageToImage') {
    const image = capabilitySection(capabilities, 'image');
    const maxImages = numberValue(image.maxImages);
    const maxReferenceImages = numberValue(image.maxReferenceImages);
    const sizes = stringArray(image.sizeAliases || image.sizes);
    const formats = [
      capabilities.responseFormatB64 && 'b64_json',
      capabilities.responseFormatUrl && 'url',
    ].filter(Boolean).map(String);

    if (fieldKey === 'n' && maxImages) return hint(`当前模型单次最多生成 ${maxImages} 张。`);
    if (fieldKey === 'size' && sizes.length > 0) return hint(`当前模型支持尺寸：${sizes.join(' / ')}。`);
    if (fieldKey === 'negativePrompt') {
      return capabilities.negativePrompt
        ? hint('当前模型支持反向词。', 'success')
        : hint('当前模型不支持反向词，运行时会忽略。', 'warning');
    }
    if (fieldKey === 'seed') {
      return capabilities.seed
        ? hint('当前模型支持固定 Seed。', 'success')
        : hint('当前模型不支持 Seed，运行时会忽略。', 'warning');
    }
    if (fieldKey === 'quality') {
      return capabilities.quality
        ? hint('当前模型支持质量参数。', 'success')
        : hint('当前模型不支持质量参数，运行时会忽略。', 'warning');
    }
    if (fieldKey === 'promptExtend') {
      return image.supportsPromptExtend
        ? hint('当前模型支持智能改写 Prompt。', 'success')
        : hint('当前模型不支持智能改写 Prompt，运行时会忽略。', 'warning');
    }
    if (fieldKey === 'strength') {
      if (capabilities.imageReference && maxReferenceImages) return hint(`参考图最多 ${maxReferenceImages} 张。`);
      return capabilities.imageReference
        ? hint('当前模型支持参考图。', 'success')
        : hint('当前模型不支持参考图。', 'warning');
    }
    if (fieldKey === 'responseFormat' && formats.length > 0) return hint(`支持返回格式：${formats.join(' / ')}。`);
    if (fieldKey === 'watermark' && image.supportsWatermark === false) return hint('当前模型不支持水印参数，运行时会忽略。', 'warning');
    if (fieldKey === 'enableSequential' && image.supportsSequential === false) return hint('当前模型不支持组图连续性参数，运行时会忽略。', 'warning');
    if (fieldKey === 'thinkingMode' && image.supportsThinkingMode === false) return hint('当前模型不支持思考模式，运行时会忽略。', 'warning');
  }

  if (nodeType === 'videoGen' || nodeType === 'multiImageVideo') {
    const video = capabilitySection(capabilities, 'video');
    const durationMin = numberValue(video.durationMin);
    const durationMax = numberValue(video.durationMax);
    const maxReferenceImages = numberValue(video.maxReferenceImages);
    const maxReferenceVideos = numberValue(video.maxReferenceVideos);
    const maxReferenceAudios = numberValue(video.maxReferenceAudios);
    const resolutions = stringArray(video.resolutions);
    const ratios = stringArray(video.ratios);
    const modes = stringArray(video.modes);

    if (fieldKey === 'duration' && (durationMin || durationMax)) {
      return hint(`当前模型支持时长：${durationMin || 0}-${durationMax || '不限'} 秒。`);
    }
    if (fieldKey === 'mode' && modes.length > 0) return hint(`当前模型支持模式：${modes.join(' / ')}。`);
    if (fieldKey === 'aspectRatio' && ratios.length > 0) return hint(`当前模型支持比例：${ratios.join(' / ')}。`);
    if (fieldKey === 'resolution' && resolutions.length > 0) return hint(`当前模型支持分辨率：${resolutions.join(' / ')}。`);
    if (fieldKey === 'referenceVideoUrl') {
      return video.supportsReferenceVideo
        ? hint(`当前模型支持参考视频${maxReferenceVideos ? `，最多 ${maxReferenceVideos} 个` : ''}。`, 'success')
        : hint('当前模型不支持参考视频。', 'warning');
    }
    if (fieldKey === 'referenceAudioUrl') {
      return video.supportsReferenceAudio
        ? hint(`当前模型支持参考音频${maxReferenceAudios ? `，最多 ${maxReferenceAudios} 个` : ''}。`, 'success')
        : hint('当前模型不支持参考音频。', 'warning');
    }
    if (fieldKey === 'generateAudio') {
      return video.supportsAudioGeneration
        ? hint('当前模型支持生成音频。', 'success')
        : hint('当前模型不支持生成音频。', 'warning');
    }
    if (fieldKey === 'promptExtend') {
      return video.supportsPromptExtend
        ? hint('当前模型支持智能改写 Prompt。', 'success')
        : hint('当前模型不支持智能改写 Prompt，运行时会忽略。', 'warning');
    }
    if (fieldKey === 'seed') {
      return video.supportsSeed
        ? hint('当前模型支持固定 Seed。', 'success')
        : hint('当前模型不支持 Seed，运行时会忽略。', 'warning');
    }
    if (fieldKey === 'negativePrompt') {
      return video.supportsNegativePrompt
        ? hint('当前模型支持反向提示词。', 'success')
        : hint('当前模型不支持反向提示词，运行时会忽略。', 'warning');
    }
    if (fieldKey === 'watermark') {
      return video.supportsWatermark
        ? hint('当前模型支持水印参数。', 'success')
        : hint('当前模型不支持水印参数，运行时会忽略。', 'warning');
    }
    if (fieldKey === 'mode' && maxReferenceImages) return hint(`图生视频最多可使用 ${maxReferenceImages} 张参考图。`);
  }

  return null;
}

export function summarizeModelCapabilityUsage(
  nodeType: NodeType,
  config: NodeConfig,
  inputs: NodeInputs,
  capabilities: CapabilityMap | null
): ModelCapabilityUsageRow[] {
  if (!capabilities) return [];

  if (nodeType === 'imageGen' || nodeType === 'imageToImage') {
    const image = capabilitySection(capabilities, 'image');
    const maxImages = numberValue(image.maxImages);
    const maxReferenceImages = numberValue(image.maxReferenceImages);
    const count = parameterNumber(inputs, 'count', config.n || 1) || 1;
    const referenceImageCount =
      countImages(inputs.referenceImage) +
      countImages(inputs.referenceImages) +
      countImages(inputs.image) +
      countImages(inputs.images);
    const size = parameterString(inputs, ['size'], config.size) || '未设置';
    const sizeIssue = size !== '未设置' ? validateImageSize(size, image) : null;

    return [
      usageRow(
        '生成数量',
        maxImages ? `${count} / ${maxImages} 张` : `${count} 张`,
        maxImages && count > maxImages ? 'warning' : 'neutral'
      ),
      usageRow(
        '参考图',
        maxReferenceImages ? `${referenceImageCount} / ${maxReferenceImages} 张` : `${referenceImageCount} 张`,
        referenceImageCount > 0 && (capabilities.imageReference === false || (maxReferenceImages && referenceImageCount > maxReferenceImages))
          ? 'warning'
          : referenceImageCount > 0
            ? 'success'
            : 'neutral'
      ),
      usageRow('尺寸', size, sizeIssue ? 'warning' : 'neutral'),
      usageRow(
        '返回格式',
        String(config.responseFormat || 'b64_json'),
        (
          (config.responseFormat === 'b64_json' && capabilities.responseFormatB64 === false) ||
          (config.responseFormat === 'url' && capabilities.responseFormatUrl === false)
        ) ? 'warning' : 'neutral'
      ),
    ];
  }

  if (nodeType === 'videoGen' || nodeType === 'multiImageVideo') {
    const video = capabilitySection(capabilities, 'video');
    const durationMin = numberValue(video.durationMin);
    const durationMax = numberValue(video.durationMax);
    const maxReferenceImages = numberValue(video.maxReferenceImages);
    const maxReferenceVideos = numberValue(video.maxReferenceVideos);
    const maxReferenceAudios = numberValue(video.maxReferenceAudios);
    const resolutions = stringArray(video.resolutions);
    const ratios = stringArray(video.ratios);
    const duration = parameterNumber(inputs, 'duration', config.duration);
    const mode = inferVideoMode(config, inputs);
    const aspectRatio = parameterString(inputs, ['aspectRatio', 'ratio'], config.aspectRatio || config.ratio) || '未设置';
    const resolution = parameterString(inputs, ['resolution'], config.resolution) || '未设置';
    const imageCount = countImages(inputs.image) + countImages(inputs.images) + countImages(inputs.shotList);
    const videoCount = referenceVideoCount(config, inputs);
    const audioCount = referenceAudioCount(config, inputs);
    const durationUnsupported =
      Boolean(durationMin && duration < durationMin) ||
      Boolean(durationMax && duration > durationMax);
    const ratioUnsupported = aspectRatio !== '未设置' && ratios.length > 0 && !ratios.includes(aspectRatio);
    const resolutionUnsupported = resolution !== '未设置' && resolutions.length > 0 && !resolutions.includes(resolution);

    const rows = [
      usageRow(
        '生成模式',
        mode,
        stringArray(video.modes).length > 0 && !stringArray(video.modes).includes(mode) ? 'warning' : 'neutral'
      ),
      usageRow(
        '时长',
        durationMin || durationMax ? `${duration || 0} 秒 / ${durationMin || 0}-${durationMax || '不限'} 秒` : `${duration || 0} 秒`,
        durationUnsupported ? 'warning' : 'neutral'
      ),
      usageRow(
        '参考图',
        maxReferenceImages ? `${imageCount} / ${maxReferenceImages} 张` : `${imageCount} 张`,
        imageCount > 0 && (video.supportsReferenceImage === false || (maxReferenceImages && imageCount > maxReferenceImages))
          ? 'warning'
          : imageCount > 0
            ? 'success'
            : 'neutral'
      ),
      usageRow('比例', aspectRatio, ratioUnsupported ? 'warning' : 'neutral'),
      usageRow('分辨率', resolution, resolutionUnsupported ? 'warning' : 'neutral'),
    ];

    if (maxReferenceVideos || videoCount > 0) {
      rows.push(usageRow(
        '参考视频',
        maxReferenceVideos ? `${videoCount} / ${maxReferenceVideos} 个` : `${videoCount} 个`,
        videoCount > 0 && (video.supportsReferenceVideo === false || (maxReferenceVideos && videoCount > maxReferenceVideos))
          ? 'warning'
          : videoCount > 0
            ? 'success'
            : 'neutral'
      ));
    }

    if (maxReferenceAudios || audioCount > 0) {
      rows.push(usageRow(
        '参考音频',
        maxReferenceAudios ? `${audioCount} / ${maxReferenceAudios} 个` : `${audioCount} 个`,
        audioCount > 0 && (video.supportsReferenceAudio === false || (maxReferenceAudios && audioCount > maxReferenceAudios))
          ? 'warning'
          : audioCount > 0
            ? 'success'
            : 'neutral'
      ));
    }

    return rows;
  }

  return [];
}

export function validateNodeCapabilityUsage(
  nodeType: NodeType,
  config: NodeConfig,
  inputs: NodeInputs,
  capabilities: CapabilityMap | null
): string[] {
  if (!capabilities) return [];
  const issues: string[] = [];

  if (nodeType === 'imageGen' || nodeType === 'imageToImage') {
    const image = capabilitySection(capabilities, 'image');
    const maxImages = numberValue(image.maxImages);
    const maxReferenceImages = numberValue(image.maxReferenceImages);
    const count = parameterNumber(inputs, 'count', config.n || 1);
    const referenceImageCount = countImages(inputs.referenceImage) + countImages(inputs.referenceImages) + countImages(inputs.image) + countImages(inputs.images);
    const responseFormat = String(config.responseFormat || '');
    const negativePrompt = parameterString(inputs, ['negativePrompt'], config.negativePrompt);
    const seed = parameterNumber(inputs, 'seed', config.seed);
    const quality = parameterString(inputs, ['quality'], config.quality);
    const size = parameterString(inputs, ['size'], config.size);
    const sizeIssue = size ? validateImageSize(size, image) : null;
    if (!capabilities.imageGeneration) issues.push('当前模型未标记为图片生成模型。');
    if (maxImages && count > maxImages) issues.push(`数量超过限制：最多 ${maxImages} 张。`);
    if (sizeIssue) issues.push(sizeIssue);
    if (negativePrompt && !capabilities.negativePrompt) issues.push('当前模型不支持反向词，运行时会忽略。');
    if (seed > 0 && !capabilities.seed) issues.push('当前模型不支持 Seed，运行时会忽略。');
    if (quality && quality !== 'auto' && !capabilities.quality) issues.push('当前模型不支持质量参数，运行时会忽略。');
    if (responseFormat === 'b64_json' && capabilities.responseFormatB64 === false) issues.push('当前模型不支持 b64_json 返回，请改用 URL 返回。');
    if (responseFormat === 'url' && capabilities.responseFormatUrl === false) issues.push('当前模型不支持 URL 返回，请改用 b64_json。');
    if (referenceImageCount > 0 && capabilities.imageReference === false) issues.push('当前模型不支持参考图。');
    if (referenceImageCount > 1 && capabilities.multiImageReference === false) issues.push('当前模型不支持多参考图。');
    if (maxReferenceImages && referenceImageCount > maxReferenceImages) issues.push(`参考图超过限制：最多 ${maxReferenceImages} 张。`);
    if (config.watermark && image.supportsWatermark === false) issues.push('当前模型不支持水印参数，运行时会忽略。');
    if (config.promptExtend && !image.supportsPromptExtend) issues.push('当前模型不支持智能改写 Prompt，运行时会忽略。');
    if (config.enableSequential && image.supportsSequential === false) issues.push('当前模型不支持组图连续性，运行时会忽略。');
    if (config.thinkingMode && image.supportsThinkingMode === false) issues.push('当前模型不支持思考模式，运行时会忽略。');
  }

  if (nodeType === 'videoGen' || nodeType === 'multiImageVideo') {
    const video = capabilitySection(capabilities, 'video');
    const durationMin = numberValue(video.durationMin);
    const durationMax = numberValue(video.durationMax);
    const maxReferenceImages = numberValue(video.maxReferenceImages);
    const maxReferenceVideos = numberValue(video.maxReferenceVideos);
    const maxReferenceAudios = numberValue(video.maxReferenceAudios);
    const resolutions = stringArray(video.resolutions);
    const ratios = stringArray(video.ratios);
    const modes = stringArray(video.modes);
    const duration = parameterNumber(inputs, 'duration', config.duration);
    const mode = inferVideoMode(config, inputs);
    const aspectRatio = parameterString(inputs, ['aspectRatio', 'ratio'], config.aspectRatio || config.ratio);
    const resolution = parameterString(inputs, ['resolution'], config.resolution);
    const imageCount = countImages(inputs.image) + countImages(inputs.images) + countImages(inputs.shotList);
    const videoCount = referenceVideoCount(config, inputs);
    const audioCount = referenceAudioCount(config, inputs);

    if (!capabilities.videoGeneration) issues.push('当前模型未标记为视频生成模型。');
    if (modes.length > 0 && !modes.includes(mode)) issues.push(`生成模式不支持：当前是 ${mode}，可选 ${modes.join(' / ')}。`);
    if (durationMin && duration < durationMin) issues.push(`时长太短：最短 ${durationMin} 秒。`);
    if (durationMax && duration > durationMax) issues.push(`时长太长：最长 ${durationMax} 秒。`);
    if (resolution && resolutions.length > 0 && !resolutions.includes(resolution)) {
      issues.push(`分辨率不支持：可选 ${resolutions.join(' / ')}。`);
    }
    if (aspectRatio && ratios.length > 0 && !ratios.includes(aspectRatio)) {
      issues.push(`比例不支持：可选 ${ratios.join(' / ')}。`);
    }
    if (imageCount > 0 && video.supportsReferenceImage === false) issues.push('当前模型不支持参考图。');
    if (maxReferenceImages && imageCount > maxReferenceImages) issues.push(`参考图超过限制：最多 ${maxReferenceImages} 张。`);
    if (videoCount > 0 && video.supportsReferenceVideo === false) issues.push('当前模型不支持参考视频。');
    if (maxReferenceVideos && videoCount > maxReferenceVideos) issues.push(`参考视频超过限制：最多 ${maxReferenceVideos} 个。`);
    if (audioCount > 0 && video.supportsReferenceAudio === false) issues.push('当前模型不支持参考音频。');
    if (maxReferenceAudios && audioCount > maxReferenceAudios) issues.push(`参考音频超过限制：最多 ${maxReferenceAudios} 个。`);
    if (config.generateAudio && video.supportsAudioGeneration === false) issues.push('当前模型不支持生成音频。');
    if (config.promptExtend && !video.supportsPromptExtend) issues.push('当前模型不支持智能改写 Prompt，运行时会忽略。');
    if (Number(config.seed || 0) > 0 && !video.supportsSeed) issues.push('当前模型不支持 Seed，运行时会忽略。');
    if (config.negativePrompt && !video.supportsNegativePrompt) issues.push('当前模型不支持反向提示词，运行时会忽略。');
    if (config.watermark && video.supportsWatermark === false) issues.push('当前模型不支持水印参数，运行时会忽略。');
  }

  return issues;
}
