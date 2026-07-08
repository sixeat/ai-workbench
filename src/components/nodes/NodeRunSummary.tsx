import { RefreshCw } from 'lucide-react';
import { proxyAssetUrl } from '../../lib/apiProxy';
import { isNodeRunImageAsset, summarizeNodeRunForDisplay } from '../../lib/nodeRunDisplay';
import { cn } from '../../lib/utils';
import type { NodeConfig, NodeInputs, NodeRunAssetSummary, NodeRunSummary as NodeRunSummaryData, NodeType } from '../../types/nodes';

function imageSummary(config: NodeConfig, inputs: NodeInputs): string {
  const seed = Number(config.seed || 0) > 0 ? config.seed : 'auto';
  const refs = [inputs.referenceImage, inputs.referenceImages].filter(Boolean).length;
  return `${config.size || '1024x1024'} | ${config.quality || 'auto'} | n=${config.n || 1} | seed=${seed} | 参考图${refs ? '已连接' : '未连接'} | 强度 ${config.strength ?? 0.65}`;
}

function videoSummary(config: NodeConfig, inputs: NodeInputs): string {
  const refs = [inputs.image, inputs.images].filter(Boolean).length;
  return `${config.mode || 'auto'} | ${config.duration || 5}s | ${config.aspectRatio || '16:9'} | ${config.resolution || '720P'} | 参考${refs ? '已连接' : '未连接'} | ${config.motion || '默认运动'}`;
}

interface NodeRunSummaryProps {
  type: NodeType;
  config: NodeConfig;
  inputs: NodeInputs;
  lastRun?: NodeRunSummaryData;
  onOpenAsset?: (asset: NodeRunAssetSummary) => void;
  onAddAsset?: (asset: NodeRunAssetSummary) => void;
  onRefreshTask?: (taskId: string) => void;
  refreshingTaskId?: string;
  taskRefreshNotice?: string;
  taskRefreshError?: string;
  addingAssetId?: string;
  assetActionNotice?: string;
  assetActionError?: string;
}

function runStatusClass(status: NodeRunSummaryData['status']): string {
  const classes: Record<NodeRunSummaryData['status'], string> = {
    running: 'bg-blue-500/10 text-blue-300',
    completed: 'bg-emerald-500/10 text-emerald-300',
    error: 'bg-red-500/10 text-red-300',
  };
  return classes[status];
}

function renderLastRun(
  lastRun?: NodeRunSummaryData,
  onOpenAsset?: (asset: NodeRunAssetSummary) => void,
  onAddAsset?: (asset: NodeRunAssetSummary) => void,
  onRefreshTask?: (taskId: string) => void,
  refreshingTaskId?: string,
  taskRefreshNotice?: string,
  taskRefreshError?: string,
  addingAssetId?: string,
  assetActionNotice?: string,
  assetActionError?: string
) {
  const summary = summarizeNodeRunForDisplay(lastRun);
  if (!summary || !lastRun) return null;
  const canRefresh = Boolean(lastRun.taskId && onRefreshTask);
  const isRefreshing = Boolean(lastRun.taskId && refreshingTaskId === lastRun.taskId);

  return (
    <div className="mb-2 rounded-lg border border-gray-700/40 bg-gray-950/30 px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wide text-gray-500">最近运行</span>
          <span className={cn('rounded-full px-1.5 py-0.5 text-[9px]', runStatusClass(lastRun.status))}>
            {summary.statusLabel}
          </span>
        </div>
        {canRefresh && (
          <button
            type="button"
            disabled={isRefreshing}
            onClick={(event) => {
              event.stopPropagation();
              if (lastRun.taskId) onRefreshTask?.(lastRun.taskId);
            }}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-gray-700 bg-gray-900 px-1.5 text-[9px] text-gray-300 transition-[border-color,color,transform] hover:border-accent hover:text-white active:scale-95 disabled:cursor-wait disabled:text-gray-500"
            title="刷新任务状态"
          >
            <RefreshCw className={cn('h-3 w-3', isRefreshing && 'animate-spin')} />
            {isRefreshing ? '刷新中' : '刷新'}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-gray-400">
        <span title={lastRun.taskId}>任务 {summary.taskLabel}</span>
        {lastRun.taskStatus && <span>{summary.taskStatusLabel}</span>}
        {lastRun.upstreamTaskId && <span title={lastRun.upstreamTaskId}>上游 {summary.upstreamTaskLabel}</span>}
        {lastRun.upstreamStatus && <span>{summary.upstreamStatusLabel}</span>}
        <span>{summary.durationLabel}</span>
        <span>{summary.assetLabel}</span>
      </div>
      {taskRefreshNotice && <div className="mt-1 text-[9px] text-emerald-300">{taskRefreshNotice}</div>}
      {taskRefreshError && <div className="mt-1 line-clamp-2 text-[9px] text-red-300">{taskRefreshError}</div>}
      {lastRun.error && <div className="mt-1 line-clamp-2 text-[10px] text-red-300">{lastRun.error}</div>}
      {summary.visibleAssets.length > 0 && (
        <div className="mt-2 flex gap-1.5">
          {summary.visibleAssets.map((asset, index) => {
            const isAdding = Boolean(asset.id && addingAssetId === asset.id);
            return (
              <div key={`${asset.id || asset.url}-${index}`} className="group/run-asset relative">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenAsset?.(asset);
                  }}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border border-gray-700/50 bg-black/30 text-[9px] text-gray-500 transition-colors hover:border-accent hover:text-white',
                    isNodeRunImageAsset(asset) ? 'cursor-zoom-in' : 'cursor-pointer'
                  )}
                  title={isNodeRunImageAsset(asset) ? '预览产物' : '打开产物'}
                >
                  {isNodeRunImageAsset(asset) ? (
                    <img src={proxyAssetUrl(asset.url)} alt={asset.fileName || asset.id || '产物'} className="h-full w-full object-cover" />
                  ) : (
                    asset.type
                  )}
                </button>
                {asset.id && onAddAsset && (
                  <button
                    type="button"
                    disabled={isAdding}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddAsset(asset);
                    }}
                    className="absolute inset-x-0 bottom-0 rounded-b-md bg-black/75 px-0.5 py-0.5 text-[8px] text-white opacity-0 backdrop-blur transition-opacity hover:bg-accent disabled:cursor-wait group-hover/run-asset:opacity-100"
                    title="加入素材集合"
                  >
                    {isAdding ? '...' : '入库'}
                  </button>
                )}
              </div>
            );
          })}
          {summary.overflowAssetCount > 0 && (
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-700/50 bg-black/30 text-[10px] text-gray-400">
              +{summary.overflowAssetCount}
            </div>
          )}
        </div>
      )}
      {assetActionNotice && <div className="mt-1 text-[9px] text-emerald-300">{assetActionNotice}</div>}
      {assetActionError && <div className="mt-1 text-[9px] text-red-300">{assetActionError}</div>}
    </div>
  );
}

export function NodeRunSummary({
  type,
  config,
  inputs,
  lastRun,
  onOpenAsset,
  onAddAsset,
  onRefreshTask,
  refreshingTaskId,
  taskRefreshNotice,
  taskRefreshError,
  addingAssetId,
  assetActionNotice,
  assetActionError,
}: NodeRunSummaryProps) {
  const lastRunContent = renderLastRun(
    lastRun,
    onOpenAsset,
    onAddAsset,
    onRefreshTask,
    refreshingTaskId,
    taskRefreshNotice,
    taskRefreshError,
    addingAssetId,
    assetActionNotice,
    assetActionError
  );

  if (type === 'imageGen') {
    return (
      <>
        <div className="mb-2 rounded-lg border border-gray-700/40 bg-gray-900/30 px-2.5 py-2">
          <div className="mb-1 text-[9px] uppercase tracking-wide text-gray-500">参数摘要</div>
          <div className="text-[10px] leading-4 text-gray-300">{imageSummary(config, inputs)}</div>
          <div className="mt-1 text-[10px] text-gray-500">连线参数会覆盖节点内配置</div>
        </div>
        {lastRunContent}
      </>
    );
  }

  if (type === 'videoGen') {
    return (
      <>
        <div className="mb-2 rounded-lg border border-gray-700/40 bg-gray-900/30 px-2.5 py-2">
          <div className="mb-1 text-[9px] uppercase tracking-wide text-gray-500">视频任务</div>
          <div className="text-[10px] leading-4 text-gray-300">{videoSummary(config, inputs)}</div>
          <div className="mt-1 text-[10px] text-gray-500">文本、图片、多图或分镜会自动识别</div>
        </div>
        {lastRunContent}
      </>
    );
  }

  return lastRunContent;
}
