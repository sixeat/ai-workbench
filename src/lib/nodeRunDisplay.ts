import type { NodeRunAssetSummary, NodeRunSummary } from '../types/nodes';

export function formatNodeRunDuration(durationMs?: number): string {
  if (durationMs == null || !Number.isFinite(durationMs)) return '-';
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatNodeRunStatus(status: NodeRunSummary['status']): string {
  const labels: Record<NodeRunSummary['status'], string> = {
    running: '运行中',
    completed: '已完成',
    error: '失败',
  };
  return labels[status];
}

export function shortNodeRunTaskId(taskId?: string): string {
  if (!taskId) return '-';
  return taskId.length > 10 ? `${taskId.slice(0, 8)}...` : taskId;
}

export function formatNodeRunTaskStatus(status?: string): string {
  const labels: Record<string, string> = {
    queued: '排队中',
    running: '运行中',
    succeeded: '已成功',
    failed: '已失败',
    cancelled: '已取消',
  };
  return status ? labels[status] || status : '-';
}

export function isNodeRunImageAsset(asset: NodeRunAssetSummary): boolean {
  return asset.type === 'image' || /\.(png|jpe?g|webp|gif|avif)$/i.test(asset.url || asset.fileName || '');
}

export function summarizeNodeRunForDisplay(lastRun?: NodeRunSummary): {
  statusLabel: string;
  taskLabel: string;
  durationLabel: string;
  assetLabel: string;
  taskStatusLabel: string;
  visibleAssets: NodeRunAssetSummary[];
  overflowAssetCount: number;
} | null {
  if (!lastRun) return null;
  const assets = Array.isArray(lastRun.assets) ? lastRun.assets : [];
  const assetCount = Number(lastRun.assetCount || assets.length || 0);
  const visibleAssets = assets.slice(0, 3);

  return {
    statusLabel: formatNodeRunStatus(lastRun.status),
    taskLabel: shortNodeRunTaskId(lastRun.taskId),
    taskStatusLabel: formatNodeRunTaskStatus(lastRun.taskStatus),
    durationLabel: formatNodeRunDuration(lastRun.durationMs),
    assetLabel: assetCount > 0 ? `${assetCount} 个产物` : '无产物',
    visibleAssets,
    overflowAssetCount: Math.max(0, assetCount - visibleAssets.length),
  };
}
