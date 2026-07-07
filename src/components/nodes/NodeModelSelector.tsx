import { Bot, ChevronDown, Cloud, Key, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { API_INSTANCE_SOURCE_LABELS, groupApiInstancesBySource } from '../../lib/apiInstanceDisplay';
import type { ProxyPlatformModel } from '../../lib/apiProxy';
import type { ModelCapabilityBadge } from '../../lib/modelCapabilities';
import type { ApiInstance } from '../../types/api';
import type { ReactNode } from 'react';

interface NodeModelSelectorProps {
  selectedInstance: ApiInstance | null;
  selectedPlatformModel: ProxyPlatformModel | null;
  availableInstances: ApiInstance[];
  availablePlatformModels: ProxyPlatformModel[];
  availableModels: string[];
  selectedInstanceId?: string;
  selectedPlatformModelId?: string;
  selectedModel?: string;
  showInstanceSelect: boolean;
  showModelSelect: boolean;
  capabilityBadges?: ModelCapabilityBadge[];
  onToggleInstanceSelect: () => void;
  onToggleModelSelect: () => void;
  onSelectInstance: (instanceId: string) => void;
  onSelectPlatformModel: (platformModelId: string) => void;
  onSelectModel: (model: string) => void;
}

export function NodeModelSelector({
  selectedInstance,
  selectedPlatformModel,
  availableInstances,
  availablePlatformModels,
  availableModels,
  selectedInstanceId,
  selectedPlatformModelId,
  selectedModel,
  showInstanceSelect,
  showModelSelect,
  capabilityBadges = [],
  onToggleInstanceSelect,
  onToggleModelSelect,
  onSelectInstance,
  onSelectPlatformModel,
  onSelectModel,
}: NodeModelSelectorProps) {
  const groupedInstances = groupApiInstancesBySource(availableInstances);
  const hasSelectableSource = availablePlatformModels.length > 0 || groupedInstances.custom.length > 0;
  const isPlatformModelSelected = Boolean(selectedPlatformModel);
  const canSelectRawModel = Boolean(selectedInstance);

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
            <span className="truncate">{selectedPlatformModel?.displayName || selectedInstance?.name || '选择模型/API'}</span>
            <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-gray-500" />
          </button>

          {showInstanceSelect && (
            <div className="absolute bottom-full left-0 z-50 mb-1 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-panel-border bg-panel-bg p-2 shadow-xl">
              {!hasSelectableSource ? (
                <div className="px-2 py-2 text-center text-[10px] text-gray-500">暂无平台模型或我的 API</div>
              ) : (
                <div className="grid max-h-[220px] grid-cols-2 gap-2 overflow-auto">
                  <PlatformModelColumn
                    icon={<Cloud className="h-3 w-3" />}
                    models={availablePlatformModels}
                    selectedPlatformModelId={selectedPlatformModelId}
                    title="平台模型"
                    onSelectPlatformModel={onSelectPlatformModel}
                  />
                  <ApiInstanceColumn
                    icon={<Key className="h-3 w-3" />}
                    instances={groupedInstances.custom}
                    selectedInstanceId={selectedInstanceId}
                    title={API_INSTANCE_SOURCE_LABELS.custom}
                    onSelectInstance={onSelectInstance}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="relative min-w-0 flex-1">
          <button
            onClick={(event) => {
              event.stopPropagation();
              if (!canSelectRawModel) return;
              onToggleModelSelect();
            }}
            disabled={!canSelectRawModel}
            title={isPlatformModelSelected ? '平台模型的上游模型由管理员配置' : undefined}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-lg border border-gray-700/50 bg-gray-800/50 px-2 py-1.5 text-[10px] text-gray-300 hover:border-gray-600',
              !canSelectRawModel && !isPlatformModelSelected && 'cursor-not-allowed opacity-50',
              !canSelectRawModel && isPlatformModelSelected && 'cursor-default opacity-80'
            )}
          >
            <Sparkles className="h-3 w-3 shrink-0 text-gray-500" />
            <span className="truncate">{selectedPlatformModel ? selectedPlatformModel.model : selectedModel || '选择模型'}</span>
            {canSelectRawModel ? (
              <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-gray-500" />
            ) : (
              <span className="ml-auto shrink-0 text-[9px] text-gray-500">只读</span>
            )}
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

function ApiInstanceColumn({
  icon,
  instances,
  onSelectInstance,
  selectedInstanceId,
  title,
}: {
  icon: ReactNode;
  instances: ApiInstance[];
  onSelectInstance: (instanceId: string) => void;
  selectedInstanceId?: string;
  title: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-panel-border bg-canvas-bg/40 p-1.5">
      <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-medium text-gray-400">
        {icon}
        <span className="truncate">{title}</span>
      </div>
      {instances.length === 0 ? (
        <div className="px-1 py-2 text-[10px] text-gray-600">暂无可用 API</div>
      ) : (
        <div className="space-y-1">
          {instances.map((instance) => (
            <button
              key={instance.id}
              onClick={(event) => {
                event.stopPropagation();
                onSelectInstance(instance.id);
              }}
              className={cn(
                'flex w-full items-center gap-1.5 rounded px-1.5 py-1.5 text-left text-[10px] text-gray-300 hover:bg-gray-700/50',
                instance.id === selectedInstanceId && 'bg-accent/10 text-accent'
              )}
            >
              <Bot className="h-3 w-3 shrink-0" />
              <span className="truncate">{instance.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PlatformModelColumn({
  icon,
  models,
  onSelectPlatformModel,
  selectedPlatformModelId,
  title,
}: {
  icon: ReactNode;
  models: ProxyPlatformModel[];
  onSelectPlatformModel: (platformModelId: string) => void;
  selectedPlatformModelId?: string;
  title: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-panel-border bg-canvas-bg/40 p-1.5">
      <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-medium text-gray-400">
        {icon}
        <span className="truncate">{title}</span>
      </div>
      {models.length === 0 ? (
        <div className="px-1 py-2 text-[10px] text-gray-600">暂无平台模型</div>
      ) : (
        <div className="space-y-1">
          {models.map((model) => (
            <button
              key={model.id}
              onClick={(event) => {
                event.stopPropagation();
                onSelectPlatformModel(model.id);
              }}
              className={cn(
                'flex w-full flex-col rounded px-1.5 py-1.5 text-left text-[10px] text-gray-300 hover:bg-gray-700/50',
                model.id === selectedPlatformModelId && 'bg-accent/10 text-accent'
              )}
            >
              <span className="truncate">{model.displayName}</span>
              <span className="mt-0.5 truncate text-[9px] text-gray-500">{model.model}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
