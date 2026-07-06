import { makeWorkflowId, normalizeImageAsset } from '../workflowValues';
import type { ImageAsset, NodeConfig, NodeOutputs } from '../../types/nodes';

export function executeImageInput(config: NodeConfig): NodeOutputs {
  const image = normalizeImageAsset(config.url, String(config.prompt || ''));
  if (!image) return { image: null, url: '', error: '请填写图片 URL' };
  return {
    image: {
      ...image,
      id: String(config.assetId || image.id),
      fileName: String(config.fileName || image.fileName),
    },
    url: image.url,
  };
}

export function executeMultiImageInput(config: NodeConfig): NodeOutputs {
  const images = String(config.urls || '')
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url): ImageAsset => ({
      type: 'image',
      id: makeWorkflowId('image'),
      url,
      fileName: url.split('/').pop() || 'image',
      createdAt: new Date().toISOString(),
    }));

  return { images };
}
