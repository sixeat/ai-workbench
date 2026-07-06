import { X, CheckCircle2, AlertCircle, Loader2, Info, Clock } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useWorkflowStore } from '../../stores/workflowStore';
import { formatDuration } from '../../lib/utils';

interface ExecutionLogsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExecutionLogsPanel({ isOpen, onClose }: ExecutionLogsPanelProps) {
  const { execution } = useWorkflowStore();

  if (!isOpen) return null;

  const levelIcons = {
    info: <Info className="w-3.5 h-3.5 text-blue-400" />,
    success: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
    error: <AlertCircle className="w-3.5 h-3.5 text-red-400" />,
    warn: <AlertCircle className="w-3.5 h-3.5 text-amber-400" />,
  };

  const levelColors = {
    info: 'border-l-blue-500',
    success: 'border-l-emerald-500',
    error: 'border-l-red-500',
    warn: 'border-l-amber-500',
  };

  return (
    <div className="absolute bottom-4 left-4 right-[316px] z-40 bg-panel-bg border border-panel-border rounded-lg shadow-xl overflow-hidden flex flex-col max-h-[300px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-canvas-bg">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            {execution.status === 'running' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
            ) : execution.status === 'error' ? (
              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
            ) : execution.status === 'completed' ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Clock className="w-3.5 h-3.5 text-gray-500" />
            )}
            <span className="text-xs font-medium text-white">执行日志</span>
          </div>
          <span className="text-[10px] text-gray-500">
            {execution.logs.length} 条记录
          </span>
          {execution.startTime && (
            <span className="text-[10px] text-gray-500">
              {execution.endTime
                ? `耗时 ${formatDuration(execution.endTime - execution.startTime)}`
                : `已运行 ${formatDuration(Date.now() - execution.startTime)}`}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-gray-400 hover:text-white hover:bg-gray-700/50 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Logs */}
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {execution.logs.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-xs">
            暂无执行日志
          </div>
        ) : (
          execution.logs.map((log) => (
            <div
              key={log.id}
              className={cn(
                "flex items-start gap-2 px-2.5 py-2 rounded-md text-[11px] border-l-2",
                "bg-canvas-bg/50",
                levelColors[log.level]
              )}
            >
              <div className="mt-0.5 shrink-0">{levelIcons[log.level]}</div>
              <div className="flex-1 min-w-0">
                <div className="text-gray-300">{log.message}</div>
                <div className="text-[10px] text-gray-600 mt-0.5">
                  {new Date(log.timestamp).toLocaleTimeString()}
                  {log.nodeType && ` · ${log.nodeType}`}
                </div>
              </div>
            </div>
          ))
        )}

        {execution.error && (
          <div className="flex items-start gap-2 px-2.5 py-2 rounded-md text-[11px] border-l-2 border-l-red-500 bg-red-500/5">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
            <div className="text-red-400">{execution.error}</div>
          </div>
        )}
      </div>
    </div>
  );
}
