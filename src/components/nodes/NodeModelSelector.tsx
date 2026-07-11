import { ChevronDown, Cloud, Key, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import type { ProxyPlatformModel } from '../../lib/apiProxy';
import type { ModelCapabilityBadge } from '../../lib/modelCapabilities';

export interface CustomModelOption {
  apiKeyModelId?: string;
  instanceId: string;
  instanceName: string;
  model: string;
  providerId: string;
}

interface NodeModelSelectorProps {
  selectedPlatformModel: ProxyPlatformModel | null;
  availablePlatformModels: ProxyPlatformModel[];
  availableCustomModels: CustomModelOption[];
  selectedInstanceId?: string;
  selectedApiKeyModelId?: string;
  selectedPlatformModelId?: string;
  selectedModel?: string;
  showModelSelect: boolean;
  capabilityBadges?: ModelCapabilityBadge[];
  onToggleModelSelect: () => void;
  onSelectCustomModel: (option: CustomModelOption) => void;
  onSelectPlatformModel: (platformModelId: string) => void;
}

export function NodeModelSelector({
  selectedPlatformModel,
  availablePlatformModels,
  availableCustomModels,
  selectedInstanceId,
  selectedApiKeyModelId,
  selectedPlatformModelId,
  selectedModel,
  showModelSelect,
  capabilityBadges = [],
  onToggleModelSelect,
  onSelectCustomModel,
  onSelectPlatformModel,
}: NodeModelSelectorProps) {
  const selectedCustomModel = availableCustomModels.find((option) => (
    (selectedApiKeyModelId && option.apiKeyModelId === selectedApiKeyModelId)
    || (!selectedApiKeyModelId && option.instanceId === selectedInstanceId && option.model === selectedModel)
  ));
  const hasSelectableModel = availablePlatformModels.length > 0 || availableCustomModels.length > 0;
  const buttonLabel = selectedPlatformModel?.displayName || selectedCustomModel?.model || selectedModel || '选择模型';
  const buttonMeta = selectedPlatformModel
    ? '服务器模型'
    : selectedCustomModel
      ? `我的模型 · ${selectedCustomModel.instanceName}`
      : '服务器模型 / 我的模型';

  return (
    <div className="px-3 pb-2.5">
      <div className="relative">
        <button
          onClick={(event) => {
            event.stopPropagation();
            onToggleModelSelect();
          }}
          className="flex w-full items-center gap-2 rounded-lg border border-gray-700/50 bg-gray-800/50 px-2.5 py-1.5 text-left text-[10px] text-gray-300 hover:border-gray-600"
        >
          <Sparkles className="h-3 w-3 shrink-0 text-gray-500" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-gray-200">{buttonLabel}</span>
            <span className="block truncate text-[9px] text-gray-500">{buttonMeta}</span>
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 text-gray-500" />
        </button>

        {showModelSelect && (
          <div
            className="nowheel nodrag absolute bottom-full left-0 z-50 mb-1 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-panel-border bg-panel-bg p-2 shadow-xl"
            onPointerDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
          >
            {!hasSelectableModel ? (
              <div className="px-2 py-3 text-center text-[10px] text-gray-500">
                暂无可用模型。请先在“我的 API”添加 Key 并获取模型列表，或让管理员发布服务器模型。
              </div>
            ) : (
              <div className="grid h-[260px] min-h-0 grid-cols-2 gap-2 overflow-hidden">
                <PlatformModelColumn
                  icon={<Cloud className="h-3 w-3" />}
                  models={availablePlatformModels}
                  selectedPlatformModelId={selectedPlatformModelId}
                  title="服务器模型"
                  onSelectPlatformModel={onSelectPlatformModel}
                />
                <CustomModelColumn
                  icon={<Key className="h-3 w-3" />}
                  models={availableCustomModels}
                  selectedInstanceId={selectedInstanceId}
                  selectedApiKeyModelId={selectedApiKeyModelId}
                  selectedModel={selectedModel}
                  title="我的模型"
                  onSelectCustomModel={onSelectCustomModel}
                />
              </div>
            )}
          </div>
        )}
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

function CustomModelColumn({
  icon,
  models,
  onSelectCustomModel,
  selectedInstanceId,
  selectedApiKeyModelId,
  selectedModel,
  title,
}: {
  icon: ReactNode;
  models: CustomModelOption[];
  onSelectCustomModel: (option: CustomModelOption) => void;
  selectedInstanceId?: string;
  selectedApiKeyModelId?: string;
  selectedModel?: string;
  title: string;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-panel-border bg-canvas-bg/40 p-1.5">
      <div className="mb-1 flex shrink-0 items-center gap-1.5 px-1 py-0.5 text-[10px] font-medium text-gray-400">
        {icon}
        <span className="truncate">{title}</span>
      </div>
      {models.length === 0 ? (
        <div className="px-1 py-2 text-[10px] text-gray-600">暂无我的模型</div>
      ) : (
        <div className="nowheel min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1">
          {models.map((model) => (
            <button
              key={model.apiKeyModelId || `${model.instanceId}:${model.model}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelectCustomModel(model);
              }}
              className={cn(
                'flex w-full flex-col rounded px-1.5 py-1.5 text-left text-[10px] text-gray-300 hover:bg-gray-700/50',
                ((selectedApiKeyModelId && model.apiKeyModelId === selectedApiKeyModelId)
                  || (!selectedApiKeyModelId && model.instanceId === selectedInstanceId && model.model === selectedModel))
                  && 'bg-accent/10 text-accent'
              )}
            >
              <span className="w-full truncate">{model.model}</span>
              <span className="mt-0.5 w-full truncate text-[9px] text-gray-500">{model.instanceName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function capabilityLabel(capability: ProxyPlatformModel['capability']): string {
  if (capability === 'imageGeneration') return '图片生成';
  if (capability === 'videoGeneration') return '视频生成';
  return '文本生成';
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
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-panel-border bg-canvas-bg/40 p-1.5">
      <div className="mb-1 flex shrink-0 items-center gap-1.5 px-1 py-0.5 text-[10px] font-medium text-gray-400">
        {icon}
        <span className="truncate">{title}</span>
      </div>
      {models.length === 0 ? (
        <div className="px-1 py-2 text-[10px] text-gray-600">暂无服务器模型</div>
      ) : (
        <div className="nowheel min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1">
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
              <span className="w-full truncate">{model.displayName}</span>
              <span className="mt-0.5 w-full truncate text-[9px] text-gray-500">
                {capabilityLabel(model.capability)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
