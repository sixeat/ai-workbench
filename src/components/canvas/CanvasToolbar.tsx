import { Grid3X3, Maximize, Redo, Trash2, Undo, ZoomIn, ZoomOut } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { cn } from '../../lib/utils';
import { useCanvasStore } from '../../stores/canvasStore';

export function CanvasToolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { canUndo, canRedo, undo, redo, clearCanvas } = useCanvasStore();
  const undoEnabled = canUndo();
  const redoEnabled = canRedo();

  return (
    <div className="flex items-center gap-1 rounded-lg border border-panel-border bg-[#11161c] px-2 py-1.5 shadow-lg">
      <button
        onClick={() => zoomIn()}
        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-700/50"
        title="放大"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => zoomOut()}
        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-700/50"
        title="缩小"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => fitView({ padding: 0.2 })}
        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-700/50"
        title="适应视图"
      >
        <Maximize className="h-3.5 w-3.5" />
      </button>

      <div className="h-5 w-px bg-panel-border" />

      <button
        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-700/50"
        title="网格"
      >
        <Grid3X3 className="h-3.5 w-3.5" />
      </button>

      <div className="h-5 w-px bg-panel-border" />

      <button
        onClick={undo}
        disabled={!undoEnabled}
        className={cn(
          'rounded-md p-1.5 transition-colors',
          undoEnabled ? 'text-gray-300 hover:bg-gray-700/50' : 'cursor-not-allowed text-gray-600'
        )}
        title="撤销 Ctrl+Z"
      >
        <Undo className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={redo}
        disabled={!redoEnabled}
        className={cn(
          'rounded-md p-1.5 transition-colors',
          redoEnabled ? 'text-gray-300 hover:bg-gray-700/50' : 'cursor-not-allowed text-gray-600'
        )}
        title="重做 Ctrl+Y"
      >
        <Redo className="h-3.5 w-3.5" />
      </button>

      <div className="h-5 w-px bg-panel-border" />

      <button
        onClick={clearCanvas}
        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
        title="清空"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
