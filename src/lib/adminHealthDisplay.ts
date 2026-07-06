export interface QueueHealthLike {
  name?: string;
  nodeTypes?: string[];
  concurrency?: number;
  activeCount?: number;
  queuedCount?: number;
  scheduled?: boolean;
  stopped?: boolean;
}

export type QueueHealthTone = 'success' | 'warning' | 'danger' | 'neutral';

const QUEUE_NAME_LABELS: Record<string, string> = {
  text: '文本队列',
  generation: '生成队列',
  default: '默认队列',
};

const NODE_TYPE_LABELS: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
};

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function formatQueueName(name?: string): string {
  const normalized = String(name || '').trim();
  if (!normalized) return '未命名队列';
  return QUEUE_NAME_LABELS[normalized] || normalized;
}

export function formatQueueNodeTypes(nodeTypes?: string[]): string {
  const values = Array.isArray(nodeTypes) ? nodeTypes.filter(Boolean) : [];
  if (values.length === 0) return '未绑定节点';
  return values.map((type) => NODE_TYPE_LABELS[type] || type).join(' / ');
}

export function formatQueueCapacity(queue: QueueHealthLike): string {
  const active = finiteNumber(queue.activeCount);
  const concurrency = finiteNumber(queue.concurrency);
  return `${active}/${concurrency} 活跃`;
}

export function formatQueueBacklog(queue: QueueHealthLike): string {
  return `${finiteNumber(queue.queuedCount)} 个排队`;
}

export function getQueueHealthState(queue: QueueHealthLike): {
  label: string;
  tone: QueueHealthTone;
  description: string;
} {
  const active = finiteNumber(queue.activeCount);
  const concurrency = finiteNumber(queue.concurrency);
  const queued = finiteNumber(queue.queuedCount);

  if (queue.stopped) {
    return {
      label: '已停止',
      tone: 'danger',
      description: 'worker 已停止，排队任务不会继续执行。',
    };
  }

  if (queued > 0 && concurrency > 0 && active >= concurrency) {
    return {
      label: '积压中',
      tone: 'warning',
      description: 'worker 已满载，后续任务正在等待空位。',
    };
  }

  if (active > 0) {
    return {
      label: '运行中',
      tone: 'success',
      description: 'worker 正在处理任务。',
    };
  }

  if (queue.scheduled || queued > 0) {
    return {
      label: '等待调度',
      tone: 'warning',
      description: '已有任务等待 worker 调度。',
    };
  }

  return {
    label: '空闲',
    tone: 'neutral',
    description: '当前没有积压任务。',
  };
}

export function summarizeQueues(queues?: QueueHealthLike[]): string {
  const values = Array.isArray(queues) ? queues : [];
  if (values.length === 0) return '暂无队列状态';
  const active = values.reduce((total, queue) => total + finiteNumber(queue.activeCount), 0);
  const queued = values.reduce((total, queue) => total + finiteNumber(queue.queuedCount), 0);
  return `${values.length} 个队列，${active} 个运行中，${queued} 个排队`;
}
