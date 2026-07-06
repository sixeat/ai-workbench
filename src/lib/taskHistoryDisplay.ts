import type { ProxyAsset, ProxyTask } from './apiProxy';

export interface TaskInputSummaryRow {
  label: string;
  value: string;
}

export interface TaskHistoryListItem {
  task: ProxyTask;
  assets: ProxyAsset[];
}

export type TaskHistoryStatusFilter = 'all' | ProxyTask['status'];

export interface TaskErrorSummary {
  title: string;
  detail: string;
  actionLabel?: string;
  category?: string;
  categoryLabel?: string;
  retryable?: boolean;
  retryHint?: string;
  code?: string;
  requestId?: string;
  status?: string;
}

const LOG_EVENT_LABELS: Record<string, string> = {
  queued: '已入队',
  started: '开始执行',
  claimed: '开始执行',
  succeeded: '执行完成',
  failed: '执行失败',
  cancelled: '已取消',
  cancel_requested: '请求取消',
  cancelled_before_start: '启动前取消',
  cancelled_after_upstream: '上游返回后取消',
  retry_created: '创建重试任务',
  created_from_retry: '来自重试',
  recovered_interrupted_task: '恢复中断任务',
  upstream_video_submitted: '视频任务已提交',
  upstream_video_completed: '视频任务已完成',
  upstream_video_failed: '视频任务失败',
  upstream_video_cancelled: '视频任务取消',
  upstream_video_lookup_failed: '视频查询失败',
};

const UPSTREAM_ERROR_LABELS: Record<string, string> = {
  auth: '鉴权失败',
  content_policy: '内容安全拦截',
  invalid_request: '请求参数不兼容',
  not_found: '模型或接口不存在',
  quota: '额度不足',
  rate_limit: '触发限流',
  server: '上游服务异常',
  timeout: '请求超时',
  unknown: '未知错误',
};

const UPSTREAM_ERROR_ACTION_LABELS: Record<string, string> = {
  auth: '检查 Key',
  content_policy: '调整内容',
  invalid_request: '检查参数',
  not_found: '检查模型',
  quota: '检查额度',
  server: '上游异常',
  timeout: '请求超时',
  unknown: '人工排查',
};

const UPSTREAM_ERROR_HINTS: Record<string, string> = {
  auth: '请检查 API Key 是否有效、是否属于当前厂商，或重新保存后再试。',
  content_policy: '请调整提示词或参考素材，避开被厂商安全策略拦截的内容。',
  invalid_request: '请检查模型能力、尺寸、时长、参考图数量和请求参数。',
  not_found: '请确认 base URL、模型名和接口路径是否正确。',
  quota: '请检查账户余额、套餐额度或服务器托管 Key 的配额。',
  server: '上游服务异常。可以稍后重试，必要时切换模型或厂商。',
  timeout: '请求超时。可以稍后重试，或降低队列并发后再试。',
  unknown: '建议查看错误详情、请求 ID 和厂商控制台日志。',
};

const TASK_STATUS_SEARCH_LABELS: Record<ProxyTask['status'], string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return String(value);
  }
  return '';
}

function shortText(value: unknown, maxLength = 120): string {
  if (value == null || value === '') return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function addRow(rows: TaskInputSummaryRow[], label: string, value: unknown, maxLength?: number) {
  const text = shortText(value, maxLength);
  if (text) rows.push({ label, value: text });
}

function messageContentText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (isRecord(item)) return stringValue(item.text, item.content);
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function taskErrorActionLabel(category: string, retryable?: boolean): string {
  if (retryable === true) return category === 'rate_limit' ? '稍后重试' : '可重试';
  return UPSTREAM_ERROR_ACTION_LABELS[category] || '需检查';
}

function taskErrorRetryHint(category: string, retryable?: boolean): string {
  if (retryable === true) {
    if (category === 'rate_limit') return '触发限流。可以稍后重试，或降低队列并发后再试。';
    return UPSTREAM_ERROR_HINTS[category] || '可以稍后重试。';
  }
  return UPSTREAM_ERROR_HINTS[category] || '建议先检查 Key、模型能力或请求参数。';
}

export function canCancelTask(status: ProxyTask['status']): boolean {
  return status === 'queued' || status === 'running';
}

export function canRetryTask(status: ProxyTask['status']): boolean {
  return status === 'failed';
}

export function uniqueTaskAssetIds(assets: Array<{ id?: string }>): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const asset of assets) {
    const id = String(asset.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function chunkTaskAssetIds(ids: readonly string[], size = 100): string[][] {
  const safeSize = Math.max(1, Math.floor(size));
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += safeSize) {
    chunks.push(ids.slice(index, index + safeSize));
  }
  return chunks;
}

export function collectArchivableTaskAssetIds(items: readonly TaskHistoryListItem[]): string[] {
  return uniqueTaskAssetIds(items.flatMap((item) => item.assets));
}

export function formatTaskAssetArchiveSummary(items: readonly TaskHistoryListItem[]): string {
  const taskCount = items.filter((item) => item.assets.length > 0).length;
  const assetCount = collectArchivableTaskAssetIds(items).length;
  if (assetCount === 0) return '已加载结果里没有可入库产物';
  return `归档已加载的 ${taskCount} 个任务，共 ${assetCount} 个产物`;
}

function isTaskAssetLike(value: unknown): value is ProxyAsset {
  if (!isRecord(value)) return false;
  return typeof value.type === 'string' && typeof value.url === 'string' && value.url.trim().length > 0;
}

function collectTaskAssetsFromValue(value: unknown, depth = 0): ProxyAsset[] {
  if (!value || depth > 8) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectTaskAssetsFromValue(item, depth + 1));
  if (!isRecord(value)) return [];
  if (isTaskAssetLike(value)) return [value];

  const nestedValues: unknown[] = [
    value.asset,
    value.assets,
    value.image,
    value.images,
    value.video,
    value.videos,
    value.result,
    value.results,
    value.output,
    value.outputs,
  ];

  const shotList = isRecord(value.shotList) ? value.shotList : isRecord(value) && value.type === 'shotList' ? value : null;
  if (shotList && Array.isArray(shotList.items)) nestedValues.push(shotList.items);
  if (Array.isArray(value.items)) nestedValues.push(value.items);

  return nestedValues.flatMap((item) => collectTaskAssetsFromValue(item, depth + 1));
}

export function uniqueTaskAssets(assets: ProxyAsset[]): ProxyAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = String(asset.id || asset.url || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function collectTaskAssets(task: Pick<ProxyTask, 'assets' | 'output'>): ProxyAsset[] {
  return uniqueTaskAssets([
    ...(task.assets || []),
    ...collectTaskAssetsFromValue(task.output),
  ]);
}

export function formatTaskLogEvent(event: string): string {
  return LOG_EVENT_LABELS[event] || event;
}

export function summarizeTaskError(error: unknown): TaskErrorSummary | null {
  if (!error) return null;
  if (typeof error === 'string') {
    return {
      title: '任务失败',
      detail: error,
    };
  }
  if (!isRecord(error)) {
    return {
      title: '任务失败',
      detail: shortText(error, 240) || '未知错误',
    };
  }

  const upstream = isRecord(error.upstream) ? error.upstream : {};
  const category = stringValue(error.upstreamCategory, upstream.category);
  const categoryLabel = category ? UPSTREAM_ERROR_LABELS[category] || category : '';
  const retryableValue = error.upstreamRetryable ?? upstream.retryable;
  const retryable = typeof retryableValue === 'boolean' ? retryableValue : undefined;
  const status = stringValue(error.upstreamStatus, upstream.status);
  const statusText = stringValue(error.upstreamStatusText, upstream.statusText);
  const code = stringValue(error.upstreamCode, upstream.code);
  const requestId = stringValue(error.upstreamRequestId, upstream.requestId);
  const detail = stringValue(
    error.upstreamMessage,
    upstream.message,
    error.message,
    error.error
  ) || '任务失败，但没有返回详细错误。';

  return {
    title: categoryLabel || '任务失败',
    detail,
    actionLabel: taskErrorActionLabel(category, retryable),
    ...(category ? { category } : {}),
    ...(categoryLabel ? { categoryLabel } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
    retryHint: taskErrorRetryHint(category, retryable),
    ...(code ? { code } : {}),
    ...(requestId ? { requestId } : {}),
    ...(status || statusText ? { status: [status, statusText].filter(Boolean).join(' ') } : {}),
  };
}

export function summarizeTaskInput(input: unknown): TaskInputSummaryRow[] {
  if (!isRecord(input)) return [];
  const rows: TaskInputSummaryRow[] = [];

  addRow(rows, '提示词', input.prompt, 180);
  addRow(rows, '模型', input.model);
  addRow(rows, 'Provider', input.providerId);
  addRow(rows, 'Key', input.apiKeyId);
  addRow(rows, '尺寸', input.size);
  addRow(rows, '比例', input.ratio);
  addRow(rows, '质量', input.quality);
  addRow(rows, '数量', input.n || input.count);
  addRow(rows, '时长', input.duration ? `${input.duration} 秒` : '');

  if (Array.isArray(input.messages)) {
    rows.push({ label: '消息数', value: `${input.messages.length} 条` });
    const lastMessage = input.messages[input.messages.length - 1];
    if (isRecord(lastMessage)) addRow(rows, '最后消息', lastMessage.content, 180);
  }

  if (Array.isArray(input.content)) {
    rows.push({ label: '内容项', value: `${input.content.length} 项` });
    const mediaCount = input.content.filter((item) => isRecord(item) && typeof item.type === 'string' && item.type !== 'text').length;
    if (mediaCount) rows.push({ label: '参考素材', value: `${mediaCount} 个` });
  }

  return rows;
}

export function extractTaskReusablePrompt(input: unknown): string {
  if (!isRecord(input)) return '';

  const directPrompt = stringValue(input.prompt, input.text);
  if (directPrompt) return directPrompt;

  if (Array.isArray(input.messages)) {
    for (let index = input.messages.length - 1; index >= 0; index -= 1) {
      const message = input.messages[index];
      if (!isRecord(message)) continue;
      const content = messageContentText(message.content);
      if (content) return content;
    }
  }

  if (Array.isArray(input.content)) {
    for (const item of input.content) {
      if (!isRecord(item) || item.type !== 'text') continue;
      const text = stringValue(item.text, item.content);
      if (text) return text;
    }
  }

  return '';
}

function redactTaskInputValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactTaskInputValue);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');
      const isReferenceId = normalizedKey.endsWith('id');
      const shouldRedact =
        !isReferenceId &&
        (
          normalizedKey.includes('apikey') ||
          normalizedKey.includes('token') ||
          normalizedKey.includes('secret') ||
          normalizedKey === 'authorization' ||
          normalizedKey === 'cookie'
        );

      return [key, shouldRedact ? '[已隐藏]' : redactTaskInputValue(item)];
    })
  );
}

export function serializeTaskInputForCopy(input: unknown): string {
  if (input == null || input === '') return '';
  return JSON.stringify(redactTaskInputValue(input), null, 2);
}

export function extractTaskOutputText(output: unknown): string {
  if (typeof output === 'string') return output.trim();
  if (!isRecord(output)) return '';

  const directText = stringValue(output.text, output.content, output.message);
  if (directText) return directText;

  const script = isRecord(output.script) ? output.script : null;
  const scriptText = script ? stringValue(script.text, script.content) : '';
  if (scriptText) return scriptText;

  const prompt = isRecord(output.prompt) ? output.prompt : null;
  const promptText = prompt ? stringValue(prompt.prompt, prompt.text) : '';
  if (promptText) return promptText;

  const shotList = isRecord(output.shotList) && Array.isArray(output.shotList.items) ? output.shotList.items : null;
  if (shotList) {
    return shotList
      .map((shot, index) => {
        if (!isRecord(shot)) return '';
        const title = stringValue(shot.title) || `镜头 ${index + 1}`;
        const description = stringValue(shot.visualPrompt, shot.description);
        return description ? `${title}: ${description}` : title;
      })
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

function outputSearchText(output: unknown): string {
  if (!output) return '';
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.map(outputSearchText).filter(Boolean).join(' ');
  if (!isRecord(output)) return shortText(output, 240);
  return [
    output.text,
    output.url,
    output.fileName,
    output.prompt,
    output.model,
    output.type,
    outputSearchText(output.image),
    outputSearchText(output.images),
    outputSearchText(output.shotList),
  ].filter(Boolean).map(String).join(' ');
}

function assetSearchText(asset: ProxyAsset): string {
  return [
    asset.id,
    asset.type,
    asset.url,
    asset.legacyUrl,
    asset.fileName,
    asset.prompt,
    asset.model,
    asset.providerId,
    asset.libraryRole,
    asset.libraryNote,
  ].filter(Boolean).map(String).join(' ');
}

export function filterTaskHistoryItems<T extends TaskHistoryListItem>(
  items: T[],
  options: { status?: TaskHistoryStatusFilter; search?: string } = {}
): T[] {
  const status = options.status || 'all';
  const query = String(options.search || '').trim().toLowerCase();

  return items.filter((item) => {
    const { task, assets } = item;
    if (status !== 'all' && task.status !== status) return false;
    if (!query) return true;

    const errorSummary = summarizeTaskError(task.error);
    const haystack = [
      task.id,
      task.kind,
      task.nodeType,
      task.providerId,
      task.model,
      task.status,
      TASK_STATUS_SEARCH_LABELS[task.status],
      task.createdAt,
      task.updatedAt,
      ...summarizeTaskInput(task.input).flatMap((row) => [row.label, row.value]),
      outputSearchText(task.output),
      errorSummary?.title,
      errorSummary?.detail,
      errorSummary?.categoryLabel,
      errorSummary?.actionLabel,
      errorSummary?.retryHint,
      errorSummary?.code,
      errorSummary?.requestId,
      ...assets.map(assetSearchText),
    ].filter(Boolean).join(' ').toLowerCase();

    return haystack.includes(query);
  });
}

export function mergeTaskHistoryPages<T extends TaskHistoryListItem>(current: T[], next: T[]): T[] {
  const seen = new Set<string>();
  return [...current, ...next].filter((item) => {
    if (seen.has(item.task.id)) return false;
    seen.add(item.task.id);
    return true;
  });
}

export function formatTaskHistoryPageSummary(
  visible: number,
  loaded: number,
  total: number,
  options: { search?: string; status?: TaskHistoryStatusFilter } = {}
): string {
  const safeTotal = Math.max(total, loaded);
  const hasFilter = Boolean(options.search?.trim()) || Boolean(options.status && options.status !== 'all');
  if (hasFilter) return `${visible}/${loaded} 条匹配，已加载 ${loaded}/${safeTotal}`;
  return `已加载 ${loaded}/${safeTotal} 条任务`;
}
