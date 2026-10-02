// 服务端工作流运行编排。
//
// 职责边界：
// - 本服务只负责「图怎么推进」——建运行、算就绪、推进入度、传播失败、汇总状态。
// - 它**不直接调厂商接口**。生成型节点交给注入的 enqueueNode 去入队，
//   真正执行仍由现有 generationWorker 与生成服务完成，因此并发控制、
//   凭据回退、能力过滤、失败退款全部自动继承。
const { randomUUID } = require('crypto');
const {
  nodeStateMapFromRows,
  normalizeGraph,
  planWorkflowRun,
  summarizeRunStatus,
  topologicalSort,
} = require('./workflowGraph.cjs');
const { workflowRunRepository: defaultWorkflowRunRepository } = require('../repositories/workflowRunRepository.cjs');
const { workflowRepository: defaultWorkflowRepository } = require('../repositories/workflowRepository.cjs');

const RUN_STATUSES = Object.freeze(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

function publicError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function isTerminalRunStatus(status) {
  return TERMINAL_RUN_STATUSES.has(String(status || ''));
}

/** 由配置派生。确定性 JSON 让每次运行得到一致的指纹。 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

/**
 * 图指纹：用于判断"这条工作流的定义有没有变过"。
 *
 * 只取节点 id/type/config 与边，不含位置与 label——挪动节点不该影响运行语义。
 */
function graphHashOf(graph) {
  return stableStringify({
    nodes: [...graph.nodes]
      .map((node) => ({ config: node.config, id: node.id, type: node.type }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    edges: [...graph.edges]
      .map((edge) => ({ source: edge.source, target: edge.target }))
      .sort((a, b) => (`${a.source}->${a.target}` < `${b.source}->${b.target}` ? -1 : 1)),
  });
}

function createWorkflowRunService({
  workflowRunRepository = defaultWorkflowRunRepository,
  workflowRepository = defaultWorkflowRepository,
  now = () => new Date(),
} = {}) {
  function loadDefinition({ workflowVersionId, workflowId, userId }) {
    if (workflowVersionId) {
      const version = workflowRepository.getWorkflowVersionForUser(workflowId, workflowVersionId, userId);
      if (!version) throw publicError(404, 'Workflow version not found.');
      return { definition: { edges: version.edges, nodes: version.nodes }, workflowVersionId: version.id };
    }
    const workflow = workflowRepository.getWorkflowForUser(workflowId, userId);
    if (!workflow) throw publicError(404, 'Workflow not found.');
    return { definition: { edges: workflow.edges, nodes: workflow.nodes }, workflowVersionId: null };
  }

  /**
   * 创建一次运行。
   *
   * 幂等：带 idempotencyKey 时，同一用户重复提交只会得到同一个运行。
   * 图里存在循环依赖时直接拒绝——推进器无法处理环。
   */
  function createRun({ userId, workflowId, workflowVersionId = null, trigger = 'manual', idempotencyKey = '' } = {}) {
    if (!userId) throw publicError(400, 'userId is required.');
    if (!workflowId) throw publicError(400, 'workflowId is required.');

    const normalizedKey = String(idempotencyKey || '').trim();
    if (normalizedKey) {
      const existing = workflowRunRepository.getWorkflowRunByIdempotencyKey(userId, normalizedKey);
      if (existing) return { created: false, run: existing };
    }

    const { definition, workflowVersionId: resolvedVersionId } = loadDefinition({
      workflowId,
      workflowVersionId,
      userId,
    });
    const graph = normalizeGraph(definition);
    if (graph.nodes.length === 0) {
      throw publicError(400, 'Workflow has no nodes to run.');
    }

    const { hasCycle } = topologicalSort(graph.nodes, graph.edges);
    if (hasCycle) {
      throw publicError(400, 'Workflow contains a cycle and cannot be executed.');
    }

    const timestamp = now().toISOString();
    const run = workflowRunRepository.createWorkflowRun({
      id: randomUUID(),
      workflowId,
      workflowVersionId: resolvedVersionId,
      userId,
      status: 'queued',
      trigger: trigger === 'api' || trigger === 'schedule' ? trigger : 'manual',
      idempotencyKey: normalizedKey || null,
      // 存快照：模板之后被改动或删除，这次运行仍可复盘
      definition,
      graphHash: graphHashOf(graph),
      totalNodes: graph.nodes.length,
      finishedNodes: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    for (const node of graph.nodes) {
      workflowRunRepository.createWorkflowRunNode({
        runId: run.id,
        nodeId: node.id,
        nodeType: node.type,
        status: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    return { created: true, run: workflowRunRepository.getWorkflowRun(run.id) };
  }

  /** 取运行详情，附带节点列表。 */
  function getRun({ runId, userId } = {}) {
    const run = workflowRunRepository.getWorkflowRunForUser(runId, userId);
    if (!run) throw publicError(404, 'Workflow run not found.');
    return { nodes: workflowRunRepository.listWorkflowRunNodes(run.id), run };
  }

  function listRuns({ userId, ...options } = {}) {
    const runs = workflowRunRepository.listWorkflowRuns(userId, options);
    return {
      count: runs.length,
      limit: Math.max(1, Math.min(200, Number(options.limit || 50) || 50)),
      offset: Math.max(0, Number(options.offset || 0) || 0),
      runs,
      total: workflowRunRepository.countWorkflowRuns(userId, options),
    };
  }

  /** 当前推进计划。纯读取，不改状态。 */
  function planRun({ runId, userId } = {}) {
    const run = userId
      ? workflowRunRepository.getWorkflowRunForUser(runId, userId)
      : workflowRunRepository.getWorkflowRun(runId);
    if (!run) throw publicError(404, 'Workflow run not found.');

    const graph = normalizeGraph(run.definition);
    const nodeStates = nodeStateMapFromRows(workflowRunRepository.listWorkflowRunNodes(run.id));
    return { graph, nodeStates, plan: planWorkflowRun({ edges: graph.edges, nodeStates, nodes: graph.nodes }), run };
  }

  /**
   * 结算一轮：传播失败、产出本地节点、汇总状态。
   *
   * 推进与崩溃恢复都要走这一步。恢复路径如果只标失败而不结算，
   * 下游会停在 pending，运行永远汇总不成终态。
   */
  function settleRun({ run, nodeStates, graph, timestamp } = {}) {
    const plan = planWorkflowRun({
      edges: graph.edges,
      nodeStates: nodeStates || nodeStateMapFromRows(workflowRunRepository.listWorkflowRunNodes(run.id)),
      nodes: graph.nodes,
    });
    const at = timestamp || now().toISOString();

    for (const nodeId of plan.blocked) {
      workflowRunRepository.updateWorkflowRunNode(run.id, nodeId, {
        status: 'cancelled',
        error: { message: 'Skipped because an upstream node did not succeed.' },
        finishedAt: at,
      });
    }

    for (const nodeId of plan.runnable) {
      const node = graph.nodes.find((item) => item.id === nodeId);
      workflowRunRepository.updateWorkflowRunNode(run.id, nodeId, {
        status: 'succeeded',
        output: localNodeOutput(node),
        startedAt: at,
        finishedAt: at,
        durationMs: 0,
      });
    }

    return plan;
  }

  /**
   * 执行一轮推进。
   *
   * 只做四件事：把上游失败的下游标 blocked、本地节点直接产出、生成型节点入队、
   * 按节点终态汇总运行状态。不做循环，调用方（worker）负责反复调用。
   */
  async function advanceRunOnce({ runId, enqueueNode, userId } = {}) {
    const { graph, nodeStates, plan, run } = planRun({ runId, userId });
    const timestamp = now().toISOString();

    if (isTerminalRunStatus(run.status)) {
      return { finished: true, plan, run, status: run.status };
    }

    // 1+2. 传播失败并产出本地节点
    settleRun({ graph, nodeStates, run, timestamp });

    // 3. 生成型节点入队。enqueueNode 由外部注入，返回 taskId。
    for (const nodeId of plan.ready) {
      const node = graph.nodes.find((item) => item.id === nodeId);
      workflowRunRepository.updateWorkflowRunNode(run.id, nodeId, {
        status: 'queued',
        attempt: (nodeStates.get(nodeId)?.attempt || 0) + 1,
        startedAt: timestamp,
      });
      if (typeof enqueueNode === 'function') {
        try {
          const result = await enqueueNode({ node, run });
          if (result?.taskId) {
            // 任务行可能还没落库（入队是异步的），链接函数会先确认任务存在。
            // 未链接成功不算失败——后续 syncNodeOutcomes 每轮都会重试。
            workflowRunRepository.linkWorkflowRunNodeTask(run.id, nodeId, result.taskId);
          }
        } catch (error) {
          workflowRunRepository.updateWorkflowRunNode(run.id, nodeId, {
            status: 'failed',
            error: { message: error?.message || 'Failed to enqueue node task.' },
            finishedAt: now().toISOString(),
          });
        }
      }
    }

    return { ...finalizeIfDone({ run }), plan };
  }

  /**
   * 把已终态任务的产物同步回运行节点。
   *
   * 由调用方（worker）在每次推进前调用，避免本服务直接依赖任务仓储而越过编排边界。
   */
  function syncNodeOutcomes({ runId, readTaskOutcome } = {}) {
    const nodes = workflowRunRepository.listWorkflowRunNodes(runId);
    const timestamp = now().toISOString();
    let changed = 0;

    for (const node of nodes) {
      if (node.status !== 'queued' && node.status !== 'running') continue;
      if (!node.taskId || typeof readTaskOutcome !== 'function') continue;

      const outcome = readTaskOutcome(node.taskId);
      if (!outcome || !outcome.status) continue;
      if (outcome.status === 'queued' || outcome.status === 'running') continue;

      changed += 1;
      if (outcome.status === 'succeeded') {
        workflowRunRepository.updateWorkflowRunNode(runId, node.nodeId, {
          status: 'succeeded',
          output: outcome.output == null ? {} : outcome.output,
          error: null,
          finishedAt: timestamp,
          durationMs: outcome.durationMs == null ? null : Number(outcome.durationMs),
        });
      } else if (outcome.status === 'cancelled') {
        workflowRunRepository.updateWorkflowRunNode(runId, node.nodeId, {
          status: 'cancelled',
          error: outcome.error || { message: 'Node task was cancelled.' },
          finishedAt: timestamp,
        });
      } else {
        workflowRunRepository.updateWorkflowRunNode(runId, node.nodeId, {
          status: 'failed',
          error: outcome.error || { message: 'Node task failed.' },
          finishedAt: timestamp,
          durationMs: outcome.durationMs == null ? null : Number(outcome.durationMs),
        });
      }
    }

    return changed;
  }

  /** 按当前节点状态汇总并落定运行终态，集齐成片产物。 */
  function finalizeIfDone({ run } = {}) {
    const nodes = workflowRunRepository.listWorkflowRunNodes(run.id);
    const nodeStates = nodeStateMapFromRows(nodes);
    const status = summarizeRunStatus(nodeStates);
    const finishedNodes = nodes.filter((node) => ['succeeded', 'skipped'].includes(node.status)).length;
    const timestamp = now().toISOString();

    if (status === 'running') {
      const updated = workflowRunRepository.updateWorkflowRun(run.id, {
        status: 'running',
        finishedNodes,
      });
      return { finished: false, run: updated, status: 'running' };
    }

    const output = collectRunOutput(nodes);
    const failedNodes = nodes.filter((node) => node.status === 'failed');
    const updated = workflowRunRepository.updateWorkflowRun(run.id, {
      status,
      finishedNodes,
      output,
      error: failedNodes.length > 0
        ? {
          message: 'One or more workflow nodes failed.',
          failedNodeIds: failedNodes.map((node) => node.nodeId),
        }
        : null,
      updatedAt: timestamp,
    });
    return { finished: true, run: updated, status };
  }

  /** 取消整次运行：所有非终态节点一并取消。 */
  function cancelRun({ runId, userId } = {}) {
    const run = workflowRunRepository.getWorkflowRunForUser(runId, userId);
    if (!run) throw publicError(404, 'Workflow run not found.');
    if (isTerminalRunStatus(run.status)) {
      return { nodes: workflowRunRepository.listWorkflowRunNodes(run.id), run };
    }

    const timestamp = now().toISOString();
    for (const node of workflowRunRepository.listWorkflowRunNodes(run.id)) {
      if (['succeeded', 'failed', 'skipped', 'cancelled'].includes(node.status)) continue;
      workflowRunRepository.updateWorkflowRunNode(run.id, node.nodeId, {
        status: 'cancelled',
        error: { message: 'Run was cancelled.' },
        finishedAt: timestamp,
      });
    }

    const updated = workflowRunRepository.updateWorkflowRun(run.id, {
      status: 'cancelled',
      error: { message: 'Run was cancelled.' },
      updatedAt: timestamp,
    });
    return { nodes: workflowRunRepository.listWorkflowRunNodes(run.id), run: updated };
  }

  /**
   * 崩溃恢复：把"运行中但任务已丢失"的节点标失败。
   *
   * 进程重启后 queued/running 的节点如果没有可用的 taskId，
   * 说明它永远等不到结果，必须显式收尾否则运行会永久卡住。
   */
  function reconcileRun({ runId, readTaskOutcome } = {}) {
    const run = workflowRunRepository.getWorkflowRun(runId);
    if (!run || isTerminalRunStatus(run.status)) return { changed: 0, run };

    let changed = 0;
    const timestamp = now().toISOString();
    for (const node of workflowRunRepository.listWorkflowRunNodes(run.id)) {
      if (node.status !== 'queued' && node.status !== 'running') continue;

      const outcome = node.taskId && typeof readTaskOutcome === 'function'
        ? readTaskOutcome(node.taskId)
        : null;
      if (outcome) continue;

      changed += 1;
      workflowRunRepository.updateWorkflowRunNode(run.id, node.nodeId, {
        status: 'failed',
        error: {
          message: node.taskId
            ? 'Node task disappeared before completing.'
            : 'Node was queued but no task was ever created.',
          recoverable: true,
        },
        finishedAt: timestamp,
      });
    }

    // 标完失败必须再结算一次：否则被它挡住的下游会停在 pending，
    // 运行汇总不出终态，恢复后依然永久卡住。
    const graph = normalizeGraph(run.definition);
    settleRun({ graph, run, timestamp });
    const { run: updated } = finalizeIfDone({ run });
    return { changed, run: updated };
  }

  /**
   * 重跑失败节点及其受阻下游。
   *
   * 已成功的节点保持不动——它们的产物仍然有效，重跑会被复用而不是重新扣费。
   * 只有终态为 failed 的运行可以重试；进行中的运行应当先取消。
   */
  function retryFailedNodes({ runId, userId } = {}) {
    const run = workflowRunRepository.getWorkflowRunForUser(runId, userId);
    if (!run) throw publicError(404, 'Workflow run not found.');
    if (run.status === 'succeeded') {
      throw publicError(400, 'This run already succeeded; there is nothing to retry.');
    }
    if (!isTerminalRunStatus(run.status)) {
      throw publicError(409, 'This run is still in progress. Cancel it before retrying.');
    }

    const timestamp = now().toISOString();
    const resetNodeIds = [];
    for (const node of workflowRunRepository.listWorkflowRunNodes(run.id)) {
      if (node.status !== 'failed' && node.status !== 'cancelled') continue;
      resetNodeIds.push(node.nodeId);
      // 刻意不动 attempt：它由 advanceRunOnce 在真正入队时累加。
      // 若这里也加一次，重跑路径会双倍计数，attempt 就无法当"提交过几次"用了。
      workflowRunRepository.updateWorkflowRunNode(run.id, node.nodeId, {
        status: 'pending',
        error: null,
        taskId: null,
        finishedAt: null,
        startedAt: null,
      });
    }

    const updated = workflowRunRepository.updateWorkflowRun(run.id, {
      status: 'queued',
      error: null,
      updatedAt: timestamp,
    });

    return {
      nodes: workflowRunRepository.listWorkflowRunNodes(run.id),
      resetNodeIds,
      run: updated,
    };
  }

  return {
    advanceRunOnce,
    cancelRun,
    createRun,
    finalizeIfDone,
    getRun,
    graphHashOf,
    isTerminalRunStatus,
    listRuns,
    planRun,
    reconcileRun,
    retryFailedNodes,
    settleRun,
    syncNodeOutcomes,
  };
}

/**
 * 本地节点的产物。
 *
 * 与前端 WorkflowEngine 的 executeTextInput / executeMerge / executePreview 对齐：
 * 同一张图在前端单跑和服务端整跑必须得到一样的产物形状。
 */
function localNodeOutput(node) {
  if (!node) return {};
  if (node.type === 'textInput') {
    const text = String(node.config?.content || '');
    return { text, value: { type: 'text', text } };
  }
  if (node.type === 'imageInput') {
    const url = String(node.config?.url || '');
    return { image: url ? { type: 'image', url } : null, url };
  }
  if (node.type === 'multiImageInput') {
    const urls = String(node.config?.urls || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    return { images: urls.map((url) => ({ type: 'image', url })) };
  }
  if (node.type === 'merge') {
    return { merged: '' };
  }
  if (node.type === 'preview') {
    return { displayed: true };
  }
  // 参数类节点：输出 parameter 信封，下游通过 getParameter 读取
  const key = PARAMETER_OUTPUT_KEYS[node.type];
  if (key) {
    return {
      [key]: { type: 'parameter', key, value: node.config?.[key] ?? null },
    };
  }
  return {};
}

const PARAMETER_OUTPUT_KEYS = {
  countParam: 'count',
  negativePromptParam: 'negativePrompt',
  promptParam: 'prompt',
  qualityParam: 'quality',
  referenceStrengthParam: 'strength',
  seedParam: 'seed',
  shotParam: 'shotParams',
  sizeParam: 'size',
  styleParam: 'style',
};

/** 汇总成片产物：把各节点产物里的图片/视频资产去重收集起来。 */
function collectRunOutput(nodes = []) {
  const assets = [];
  const seen = new Set();
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== 'object') return;
    const type = String(value.type || '');
    const url = typeof value.url === 'string' ? value.url : '';
    if (url && (type === 'image' || type === 'video' || type === 'asset')) {
      const key = String(value.id || url);
      if (!seen.has(key)) {
        seen.add(key);
        assets.push({ fileName: value.fileName, id: value.id, type, url });
      }
    }
    for (const item of Object.values(value)) visit(item);
  };

  for (const node of nodes) {
    if (node.status !== 'succeeded') continue;
    visit(node.output);
  }
  return { assets };
}

module.exports = {
  createWorkflowRunService,
  graphHashOf,
  isTerminalRunStatus,
  localNodeOutput,
  RUN_STATUSES,
  stableStringify,
};
