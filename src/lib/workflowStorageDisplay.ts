import type { WorkflowStorageLocation } from '../stores/workflowDb';

export function formatWorkflowPageSummary(options: {
  loaded: number;
  total: number;
  search?: string;
  storage?: WorkflowStorageLocation;
}): string {
  const loaded = Math.max(0, options.loaded);
  const total = Math.max(0, options.total);
  const prefix = options.storage === 'local' ? '本地副本 ' : '';
  if (options.search?.trim()) return `${prefix}${loaded}/${total} 个匹配`;
  return `${prefix}已加载 ${loaded}/${total} 个`;
}

export function workflowStorageWarning(storage?: WorkflowStorageLocation): string {
  if (storage !== 'local') return '';
  return '后端暂时不可用，当前显示的是浏览器本地副本。恢复连接后，请重新保存重要工作流到服务器。';
}
