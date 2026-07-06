import { proxyAssetUrl } from '../../lib/apiProxy';
import { cn } from '../../lib/utils';
import type { ImageAsset } from '../../types/nodes';
import { isImageAsset, isRecord, isShotList, toText } from '../../engine/workflowValues';

function getPreviewImages(value: unknown): ImageAsset[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(getPreviewImages);
  if (isImageAsset(value)) return [value];
  if (isShotList(value)) return value.items.map((shot) => shot.image).filter(Boolean) as ImageAsset[];
  if (isRecord(value) && value.image) return getPreviewImages(value.image);
  if (isRecord(value) && value.images) return getPreviewImages(value.images);
  if (typeof value === 'string' && (value.startsWith('http') || value.startsWith('data:image') || value.startsWith('/api/'))) {
    return [{ type: 'image', id: value, url: value, fileName: value.split('/').pop() || 'image', createdAt: '' }];
  }
  return [];
}

function previewText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (isShotList(value)) return value.items.map((shot) => `${shot.index}. ${shot.title}`).join('\n');
  if (isRecord(value) && typeof value.text === 'string') return value.text;
  return toText(value);
}

interface NodePreviewContentProps {
  content: unknown;
  onOpenPreview: (url: string, title: string) => void;
}

export function NodePreviewContent({ content, onOpenPreview }: NodePreviewContentProps) {
  const previewImages = getPreviewImages(content);
  const preview = previewText(content);

  if (!content) return null;

  return (
    <div className="space-y-2">
      {previewImages.length > 0 && (
        <div className={cn('grid gap-1.5', previewImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
          {previewImages.slice(0, 4).map((image, index) => {
            const url = proxyAssetUrl(image.url);
            return (
              <button
                key={`${image.id}-${index}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenPreview(url, image.fileName || '预览图');
                }}
                className="overflow-hidden rounded-lg border border-panel-border bg-black/20"
              >
                <img
                  src={url}
                  alt={image.fileName || 'preview'}
                  className="h-[110px] w-full object-cover"
                  onError={(event) => {
                    (event.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </button>
            );
          })}
        </div>
      )}

      {previewImages.length > 4 && <div className="text-[10px] text-gray-500">共 {previewImages.length} 张图片，显示前 4 张</div>}
      {preview && (
        <div className="max-h-[120px] overflow-auto whitespace-pre-wrap rounded bg-gray-800/30 px-2 py-1.5 text-[11px] text-gray-200">
          {preview}
        </div>
      )}
    </div>
  );
}
