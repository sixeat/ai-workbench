import { Bot, ChevronDown, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ModelCapabilityBadge } from '../../lib/modelCapabilities';
import type { ApiInstance } from '../../types/api';

interface NodeModelSelectorProps {
  selectedInstance: ApiInstance | null;
  availableInstances: ApiInstance[];
  availableModels: string[];
  selectedInstanceId?: string;
  selectedModel?: string;
  showInstanceSelect: boolean;
  showModelSelect: boolean;
  capabilityBadges?: ModelCapabilityBadge[];
  onToggleInstanceSelect: () => void;
  onToggleModelSelect: () => void;
  onSelectInstance: (instanceId: string) => void;
  onSelectModel: (model: string) => void;
}

export function NodeModelSelector({
  selectedInstance,
  availableInstances,
  availableModels,
  selectedInstanceId,
  selectedModel,
  showInstanceSelect,
  showModelSelect,
  capabilityBadges = [],
  onToggleInstanceSelect,
  onToggleModelSelect,
  onSelectInstance,
  onSelectModel,
}: NodeModelSelectorProps) {
  return (
    <div className="px-3 pb-2.5">
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onToggleInstanceSelect();
            }}
            className="flex w-full items-center gap-1.5 rounded-lg border border-gray-700/50 bg-gray-800/50 px-2 py-1.5 text-[10px] text-gray-300 hover:border-gray-600"
          >
            <Bot className="h-3 w-3 shrink-0 text-gray-500" />
            <span className="truncate">{selectedInstance?.name || '选择 API'}</span>
            <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-gray-500" />
          </button>

          {showInstanceSelect && (
            <div className="absolute bottom-full left-0 z-50 mb-1 max-h-[160px] w-full overflow-auto rounded-lg border border-panel-border bg-panel-bg shadow-xl">
              {availableInstances.length === 0 ? (
                <div className="px-2 py-2 text-center text-[10px] text-gray-500">暂无可用 API 实例</div>
              ) : (
                availableInstances.map((instance) => (
                  <button
                    key={instance.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectInstance(instance.id);
                    }}
                    className={cn(
                      'flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[10px] text-gray-300 hover:bg-gray-700/50',
                      instance.id === selectedInstanceId && 'bg-accent/10 text-accent'
                    )}
                  >
                    <Bot className="h-3 w-3 shrink-0" />
                    <span className="truncate">{instance.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="relative min-w-0 flex-1">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onToggleModelSelect();
            }}
            disabled={!selectedInstance}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-lg border border-gray-700/50 bg-gray-800/50 px-2 py-1.5 text-[10px] text-gray-300 hover:border-gray-600',
              !selectedInstance && 'cursor-not-allowed opacity-50'
            )}
          >
            <Sparkles className="h-3 w-3 shrink-0 text-gray-500" />
            <span className="truncate">{selectedModel || '选择模型'}</span>
            <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-gray-500" />
          </button>

          {showModelSelect && selectedInstance && (
            <div className="absolute bottom-full left-0 z-50 mb-1 max-h-[220px] w-52 overflow-auto rounded-lg border border-panel-border bg-panel-bg p-1.5 shadow-xl">
              {availableModels.map((model) => (
                <button
                  key={model}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectModel(model);
                  }}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[10px] text-gray-300 hover:bg-gray-700/50',
                    model === selectedModel && 'bg-accent/10 text-accent'
                  )}
                >
                  <Sparkles className="h-3 w-3 shrink-0" />
                  <span className="truncate">{model}</span>
                </button>
              ))}
              <input
                type="text"
                placeholder="手动输入模型，按 Enter"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') {
                    const value = (event.target as HTMLInputElement).value.trim();
                    if (value) onSelectModel(value);
                  }
                }}
                className="mt-1 w-full rounded border border-gray-700/50 bg-gray-800/50 px-2 py-1.5 text-[10px] text-gray-200 placeholder:text-gray-600 focus:border-accent/50 focus:outline-none"
              />
            </div>
          )}
        </div>
      </div>
      {capabilityBadges.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {capabilityBadges.map((item) => (
            <span
              key={`${item.label}-${item.tone}`}
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[9px]',
                item.tone === 'success' && 'bg-emerald-500/10 text-emerald-300',
                item.tone === 'warning' && 'bg-amber-500/10 text-amber-300',
                item.tone === 'neutral' && 'bg-gray-700/50 text-gray-300'
              )}
              title={item.label}
            >
              {item.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
