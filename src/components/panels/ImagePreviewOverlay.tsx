import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useImagePreviewStore } from '../../stores/imagePreviewStore';
import { FloatingWindow } from '../layout/FloatingWindow';

export function ImagePreviewOverlay() {
  const { isOpen, url, title, closePreview } = useImagePreviewStore();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePreview();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closePreview, isOpen]);

  if (!isOpen || !url) return null;

  return (
    <FloatingWindow
      className="floating-window-layer--preview"
      contentClassName="!border-0 !bg-transparent !shadow-none flex-col gap-3"
    >
      <div className="relative flex max-h-full max-w-full flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-panel-bg/95 px-3 py-2 shadow-xl">
          <div className="min-w-0 truncate text-xs text-gray-300">{title || '图片预览'}</div>
          <button
            onClick={closePreview}
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-700/60 hover:text-white"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-white/10 bg-black shadow-2xl">
          <img src={url} alt={title || 'preview'} className="max-h-[82vh] max-w-[88vw] object-contain" />
        </div>
      </div>
    </FloatingWindow>
  );
}
