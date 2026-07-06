const { safeTaskError } = require('../httpErrors.cjs');
const { taskRepository: defaultTaskRepository } = require('../repositories/taskRepository.cjs');

function previewText(value, limit = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function safeStringField(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function summarizeContentItems(content) {
  const summary = {
    contentItemCount: 0,
    contentTextPreview: '',
    imageCount: 0,
    videoCount: 0,
    audioCount: 0,
  };
  if (!Array.isArray(content)) return summary;

  summary.contentItemCount = content.length;
  const textItems = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const type = String(item.type || '').toLowerCase();
    if (type === 'text' && item.text) textItems.push(item.text);
    if (type.includes('image')) summary.imageCount += 1;
    if (type.includes('video')) summary.videoCount += 1;
    if (type.includes('audio')) summary.audioCount += 1;
  }
  summary.contentTextPreview = previewText(textItems.join(' '));
  return summary;
}

function addTaskId(ids, value) {
  if (value == null || value === '') return;
  if (Array.isArray(value)) {
    for (const item of value) addTaskId(ids, item);
    return;
  }
  if (typeof value === 'object') {
    addTaskId(ids, value.taskId || value.task_id || value.id);
    return;
  }
  ids.add(String(value));
}

function collectUpstreamTaskIds(value, depth = 0, ids = new Set()) {
  if (!value || typeof value !== 'object' || depth > 4) return ids;

  if (Array.isArray(value)) {
    for (const item of value) collectUpstreamTaskIds(item, depth + 1, ids);
    return ids;
  }

  const input = value;
  addTaskId(ids, input.upstreamTaskId);
  addTaskId(ids, input.upstreamTaskIds);
  addTaskId(ids, input.sourceTaskId);
  addTaskId(ids, input.parentTaskId);
  addTaskId(ids, input.retryOf);
  addTaskId(ids, input.upstream);

  for (const key of ['upstreamTasks', 'sourceTasks', 'parentTasks']) {
    collectUpstreamTaskIds(input[key], depth + 1, ids);
  }

  return ids;
}

function summarizeTaskInput(input = {}) {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const upstreamTaskIds = [...collectUpstreamTaskIds(input)];
  const contentSummary = summarizeContentItems(input.content);
  const imageCount = countArray(input.images) +
    countArray(input.referenceImages) +
    countArray(input.reference_images) +
    finiteNumber(input.imageCount) +
    contentSummary.imageCount;
  const videoCount = countArray(input.videos) +
    countArray(input.referenceVideos) +
    countArray(input.reference_videos) +
    finiteNumber(input.videoCount) +
    contentSummary.videoCount;
  const audioCount = countArray(input.audios) +
    countArray(input.referenceAudios) +
    countArray(input.reference_audios) +
    finiteNumber(input.audioCount) +
    contentSummary.audioCount;

  return {
    promptPreview: previewText(input.prompt || input.text || lastMessage?.content || input.system || contentSummary.contentTextPreview || ''),
    messageCount: messages.length,
    ...(contentSummary.contentItemCount > 0 ? { contentItemCount: contentSummary.contentItemCount } : {}),
    ...(safeStringField(input.requestKind || input.kind) ? { requestKind: safeStringField(input.requestKind || input.kind) } : {}),
    ...(safeStringField(input.apiKeyId) ? { apiKeyId: safeStringField(input.apiKeyId) } : {}),
    ...(safeStringField(input.size) ? { size: safeStringField(input.size) } : {}),
    ...(safeStringField(input.ratio || input.aspectRatio) ? { ratio: safeStringField(input.ratio || input.aspectRatio) } : {}),
    ...(safeStringField(input.quality) ? { quality: safeStringField(input.quality) } : {}),
    ...(input.duration != null ? { duration: finiteNumber(input.duration) } : {}),
    ...(input.n != null || input.count != null ? { count: finiteNumber(input.n ?? input.count) } : {}),
    imageCount,
    videoCount,
    audioCount,
    hasReferenceImage: Boolean(input.hasReferenceImage || input.reference_image || input.reference_images),
    hasReferenceVideo: Boolean(input.hasReferenceVideo || input.referenceVideoUrl),
    hasReferenceAudio: Boolean(input.hasReferenceAudio || input.referenceAudioUrl),
    ...(upstreamTaskIds.length > 0 ? { upstreamTaskIds } : {}),
  };
}

function taskRelationshipData(task) {
  const upstreamTaskIds = [
    ...collectUpstreamTaskIds(task?.input || {}),
    ...collectUpstreamTaskIds(task?.output || {}),
  ];
  return upstreamTaskIds.length > 0
    ? { upstreamTaskIds: [...new Set(upstreamTaskIds)] }
    : {};
}

function createTaskQueueService({
  concurrency = 2,
  handlers = {},
  name = 'default',
  pollIntervalMs = 1000,
  recoverRunning = true,
  taskRepository = defaultTaskRepository,
} = {}) {
  const transientPayloads = new Map();
  let activeCount = 0;
  let scheduled = false;
  let scheduledTimer = null;
  let pollTimer = null;
  let stopped = false;
  const activeRuns = new Set();
  const supportedNodeTypes = Object.keys(handlers);

  function schedule() {
    if (stopped) return;
    if (scheduled) return;
    scheduled = true;
    scheduledTimer = setTimeout(() => {
      scheduledTimer = null;
      scheduled = false;
      drain();
    }, 0);
  }

  function startPolling() {
    if (stopped || pollTimer || pollIntervalMs <= 0) return;
    pollTimer = setInterval(schedule, pollIntervalMs);
  }

  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  async function runTask(task) {
    activeCount += 1;
    const startedAt = Date.now();
    const payload = transientPayloads.get(task.id) || {};
    transientPayloads.delete(task.id);

    try {
      const claimed = taskRepository.claimQueuedTask(task.id);
      if (!claimed) return;

      taskRepository.addTaskLog(claimed.id, {
        event: 'started',
        message: 'Task started by local worker.',
      });

      const handler = handlers[claimed.nodeType];
      if (!handler) {
        throw Object.assign(new Error(`No task worker is registered for ${claimed.nodeType}.`), {
          expose: true,
          status: 400,
        });
      }

      await handler(claimed, payload);

      const latest = taskRepository.getTask(claimed.id);
      if (latest?.status === 'succeeded') {
        taskRepository.addTaskLog(claimed.id, {
          event: 'succeeded',
          message: 'Task completed successfully.',
          data: {
            durationMs: latest.durationMs ?? Date.now() - startedAt,
            nodeType: latest.nodeType,
            providerId: latest.providerId,
            model: latest.model,
            ...taskRelationshipData(latest),
          },
        });
      } else if (latest?.status === 'failed') {
        taskRepository.addTaskLog(claimed.id, {
          level: 'error',
          event: 'failed',
          message: latest.error?.message || 'Task execution failed.',
          data: {
            durationMs: latest.durationMs ?? Date.now() - startedAt,
            nodeType: latest.nodeType,
            providerId: latest.providerId,
            model: latest.model,
            error: latest.error || null,
            ...taskRelationshipData(latest),
          },
        });
      } else if (latest?.status === 'cancelled') {
        taskRepository.addTaskLog(claimed.id, {
          level: 'warn',
          event: 'cancelled',
          message: 'Task was cancelled.',
          data: {
            durationMs: latest.durationMs ?? Date.now() - startedAt,
            nodeType: latest.nodeType,
            providerId: latest.providerId,
            model: latest.model,
            error: latest.error || null,
            ...taskRelationshipData(latest),
          },
        });
      }
    } catch (error) {
      const latest = taskRepository.getTask(task.id);
      const taskError = safeTaskError(error, 'Task execution failed.');
      if (latest && latest.status !== 'cancelled') {
        taskRepository.updateTask(task.id, {
          status: 'failed',
          error: taskError,
          durationMs: Date.now() - startedAt,
        });
      }
      if (latest?.status === 'cancelled') {
        taskRepository.addTaskLog(task.id, {
          level: 'warn',
          event: 'cancelled',
          message: 'Task was cancelled.',
          data: {
            durationMs: Date.now() - startedAt,
            nodeType: latest.nodeType,
            providerId: latest.providerId,
            model: latest.model,
            error: latest.error || null,
            ...taskRelationshipData(latest),
          },
        });
        return;
      }
      taskRepository.addTaskLog(task.id, {
        level: 'error',
        event: 'failed',
        message: taskError.message || 'Task execution failed.',
        data: {
          durationMs: Date.now() - startedAt,
          nodeType: latest?.nodeType || task.nodeType,
          providerId: latest?.providerId || task.providerId,
          model: latest?.model || task.model,
          error: taskError,
          ...taskRelationshipData(latest || task),
        },
      });
    } finally {
      activeCount -= 1;
      schedule();
    }
  }

  function drain() {
    if (stopped) return;
    while (activeCount < concurrency) {
      const next = taskRepository.listQueuedTasks(1, supportedNodeTypes)[0];
      if (!next) return;
      const run = runTask(next);
      activeRuns.add(run);
      run.finally(() => {
        activeRuns.delete(run);
      });
    }
  }

  function recordQueued(task, message = 'Task queued for local worker.') {
    if (!task?.id) return null;
    taskRepository.addTaskLog(task.id, {
      event: 'queued',
      message,
      data: {
        nodeType: task.nodeType,
        providerId: task.providerId,
        model: task.model,
        input: summarizeTaskInput(task.input || {}),
      },
    });
    return task;
  }

  function enqueue(task, payload = {}) {
    if (!task?.id) return null;
    stopped = false;
    startPolling();
    transientPayloads.set(task.id, payload);
    recordQueued(task);
    schedule();
    return task;
  }

  function start() {
    stopped = false;
    if (recoverRunning) {
      taskRepository.markRunningTasksInterrupted('Task was interrupted by a server restart.', supportedNodeTypes);
    }
    startPolling();
    schedule();
  }

  function stop() {
    stopped = true;
    transientPayloads.clear();
    stopPolling();
    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      scheduledTimer = null;
    }
    scheduled = false;
    return Promise.allSettled(Array.from(activeRuns)).then(() => undefined);
  }

  function getStats() {
    return {
      name,
      nodeTypes: supportedNodeTypes,
      concurrency,
      pollIntervalMs,
      activeCount,
      queuedCount: taskRepository.countQueuedTasks(supportedNodeTypes),
      scheduled,
      stopped,
    };
  }

  return {
    drain,
    enqueue,
    getStats,
    recordQueued,
    start,
    stop,
  };
}

module.exports = {
  createTaskQueueService,
};
