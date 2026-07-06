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

function collectTaskRelationshipIdsFromValue(value, depth = 0, ids = new Set()) {
  if (!value || typeof value !== 'object' || depth > 4) return ids;
  if (Array.isArray(value)) {
    for (const item of value) collectTaskRelationshipIdsFromValue(item, depth + 1, ids);
    return ids;
  }

  addTaskId(ids, value.upstreamTaskId);
  addTaskId(ids, value.upstreamTaskIds);
  addTaskId(ids, value.sourceTaskId);
  addTaskId(ids, value.parentTaskId);
  addTaskId(ids, value.retryOf);
  addTaskId(ids, value.upstream);

  for (const key of ['upstreamTasks', 'sourceTasks', 'parentTasks']) {
    collectTaskRelationshipIdsFromValue(value[key], depth + 1, ids);
  }

  return ids;
}

function collectTaskRelationshipIds(...values) {
  const ids = new Set();
  for (const value of values) collectTaskRelationshipIdsFromValue(value, 0, ids);
  return [...ids];
}

function retryRelationshipData(sourceTask) {
  const upstreamTaskIds = collectTaskRelationshipIds(sourceTask?.input || {}, sourceTask?.output || {});
  const preferredOutputTaskId = collectTaskRelationshipIds({
    upstreamTaskId: sourceTask?.output?.upstreamTaskId,
    upstream: sourceTask?.output?.upstream,
  })[0];

  return {
    ...(preferredOutputTaskId || upstreamTaskIds[0] ? { upstreamTaskId: preferredOutputTaskId || upstreamTaskIds[0] } : {}),
    ...(upstreamTaskIds.length > 0 ? { upstreamTaskIds } : {}),
  };
}

function taskRetryLogData(sourceTask, nextTask, fallbackNodeType = 'generation') {
  return {
    retryOf: sourceTask.id,
    newTaskId: nextTask.id,
    nodeType: sourceTask.nodeType || nextTask.nodeType || fallbackNodeType,
    providerId: nextTask.providerId || sourceTask.providerId || null,
    model: nextTask.model || sourceTask.model || null,
    ...retryRelationshipData(sourceTask),
  };
}

module.exports = {
  collectTaskRelationshipIds,
  taskRetryLogData,
};
