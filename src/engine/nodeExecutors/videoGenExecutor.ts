import { proxyCreateVideoTask } from '../../lib/apiProxy';
import type { ImageAsset, NodeConfig, NodeInputs, NodeOutputs, ShotList, VideoAsset } from '../../types/nodes';
import { getInstanceRuntimeConfig } from '../../stores/apiStore';
import type { ExecutionContext } from '../executionTypes';
import { errorMessage } from '../errors';
import { collectImageAssets, getParameter, isShotList, makeWorkflowId, toText } from '../workflowValues';

type VideoMode = 'text-to-video' | 'image-to-video' | 'images-to-video' | 'shotlist-to-video';
type VideoContentItem =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string }; role: 'reference_image' }
  | { type: 'video_url'; video_url: { url: string }; role: 'reference_video' }
  | { type: 'audio_url'; audio_url: { url: string }; role: 'reference_audio' };

function inferVideoMode(configMode: string, images: ImageAsset[], shotList: ShotList | null): VideoMode {
  if (configMode && configMode !== 'auto') return configMode as VideoMode;
  if (shotList) return 'shotlist-to-video';
  if (images.length > 1) return 'images-to-video';
  if (images.length === 1) return 'image-to-video';
  return 'text-to-video';
}

function collectShotList(value: unknown): ShotList | null {
  if (isShotList(value)) return value;
  if (Array.isArray(value)) return value.find(isShotList) || null;
  return null;
}

function buildPrompt(inputs: NodeInputs, config: NodeConfig, shotList: ShotList | null): string {
  const prompt = toText(inputs.prompt ?? inputs.text ?? config.prompt ?? '').trim();
  if (prompt) return prompt;
  if (shotList) {
    return shotList.items
      .map((shot) => `${shot.index}. ${shot.visualPrompt || shot.description}`)
      .join('\n');
  }
  return '';
}

function buildContent(prompt: string, images: ImageAsset[], config: NodeConfig): VideoContentItem[] {
  const content: VideoContentItem[] = [];
  if (prompt) content.push({ type: 'text', text: prompt });

  for (const image of images) {
    if (!image.url) continue;
    content.push({
      type: 'image_url',
      image_url: { url: image.url },
      role: 'reference_image',
    });
  }

  if (config.referenceVideoUrl) {
    content.push({
      type: 'video_url',
      video_url: { url: String(config.referenceVideoUrl) },
      role: 'reference_video',
    });
  }

  if (config.referenceAudioUrl) {
    content.push({
      type: 'audio_url',
      audio_url: { url: String(config.referenceAudioUrl) },
      role: 'reference_audio',
    });
  }

  return content;
}

export async function executeVideoGen(
  config: NodeConfig,
  inputs: NodeInputs,
  context?: ExecutionContext
): Promise<NodeOutputs> {
  const instanceId = String(config.instanceId || '');
  const platformModelId = String(config.platformModelId || '');
  const shotList = collectShotList(inputs.images ?? inputs.prompt ?? inputs.shotList);
  const images = [
    ...collectImageAssets(inputs.image),
    ...collectImageAssets(inputs.images),
    ...collectImageAssets(inputs.shotList),
  ];
  const prompt = buildPrompt(inputs, config, shotList);
  const duration = Number(getParameter(inputs, 'duration', Number(config.duration || 5)));
  const mode = inferVideoMode(String(config.mode || 'auto'), images, shotList);
  const aspectRatio = String(config.aspectRatio || config.ratio || '16:9');
  const resolution = String(config.resolution || '720P');
  const motion = String(config.motion || '');
  const seed = Number(config.seed || 0);
  const negativePrompt = String(config.negativePrompt || '');

  if (!instanceId && !platformModelId) return { video: null, task: null, error: '请选择 API 实例' };
  if (!prompt && images.length === 0 && !shotList) {
    return { video: null, task: null, error: '视频生成需要提示词、参考图或分镜' };
  }

  const runtimeConfig = instanceId ? getInstanceRuntimeConfig(instanceId) : null;
  if (!platformModelId && !runtimeConfig) return { video: null, task: null, error: 'API 实例配置无效' };

  const content = buildContent([prompt, motion].filter(Boolean).join('\n'), images, config);
  const createdAt = new Date().toISOString();
  const localTaskId = makeWorkflowId('video_task');
  const model = String(config.model || 'doubao-seedance-2-0-mini-260615');
  const providerId = runtimeConfig?.provider?.id || 'seedance';
  const defaultBaseUrl = providerId === 'aliyun-bailian'
    ? 'https://dashscope.aliyuncs.com'
    : 'https://ark.cn-beijing.volces.com';

  try {
    const response = await proxyCreateVideoTask(
      runtimeConfig?.baseUrl || defaultBaseUrl,
      runtimeConfig?.apiKey || '',
      {
        providerId,
        model,
        mode,
        content,
        prompt,
        images,
        referenceVideoUrl: String(config.referenceVideoUrl || ''),
        referenceAudioUrl: String(config.referenceAudioUrl || ''),
        generateAudio: Boolean(config.generateAudio),
        ratio: aspectRatio,
        resolution,
        duration,
        watermark: Boolean(config.watermark),
        promptExtend: Boolean(config.promptExtend),
        seed,
        negativePrompt,
        upstreamTaskIds: context?.upstreamTaskIds || [],
      },
      { apiKeyId: runtimeConfig?.apiKeyId, platformModelId: platformModelId || undefined, providerId }
    );

    const video: VideoAsset = {
      type: 'video',
      id: response.taskId || localTaskId,
      url: '',
      prompt,
      createdAt,
      status: 'queued',
    };

    const task = {
      id: video.id,
      type: 'videoTask',
      status: 'queued',
      mode,
      providerId,
      model,
      duration,
      aspectRatio,
      resolution,
      motion,
      seed,
      negativePrompt,
      prompt,
      images,
      shotList,
      upstream: response.data,
      warnings: response.warnings || [],
      createdAt,
    };

    return {
      video,
      task,
      text: `已提交视频任务：${task.model}，可在任务历史查看上游返回。`,
    };
  } catch (error) {
    return {
      video: null,
      task: null,
      error: errorMessage(error, '视频任务提交失败'),
    };
  }
}
