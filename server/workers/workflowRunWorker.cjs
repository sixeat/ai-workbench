// 工作流运行的推进 worker。
//
// 它只做三件事，每轮重复：
// 1. 把已终态任务的产物同步回运行节点
// 2. 推进运行（入队就绪节点、产出本地节点、传播失败）
// 3. 崩溃恢复：把任务已丢失的节点收尾，避免运行永久卡住
//
// 真正的生成执行仍由现有 generationWorker 完成。本 worker 只负责"图怎么走"，
// 所以并发控制、凭据回退、能力过滤、失败退款全部自动继承。
const { buildNodeTaskBody } = require('../services/workflowNodeRequest.cjs');
const { normalizeGraph } = require('../services/workflowGraph.cjs');

function createWorkflowRunWorker({
  autoStart = true,
  enabled = false,
  pollIntervalMs = 2000,
  taskRepository,
  workflowRunRepository,
  workflowRunService,
  // 由外部注入：kind 为 image/video/text，负责真正建任务并入队，返回 { taskId }
  enqueueTask,
  // 由外部注入：视频是上游异步任务，必须有人轮询才能落定
  advanceVideoTask,
  logger = console,
} = {}) {
  let timer = null;
  let running = false;
  // 注意初值必须是 false。stopped 表示"已请求停止"，不是"定时器还没启动"——
  // 若初始为 true，autoStart:false 的实例调 tick() 会直接空转。
  let stopped = false;
  const activeRuns = new Set();

  function readTaskOutcome(taskId) {
    if (!taskRepository?.getTask || !taskId) return null;
    const task = taskRepository.getTask(taskId);
    if (!task) return null;
    return {
      durationMs: task.durationMs,
      error: task.error,
      output: task.output,
      status: task.status,
    };
  }

  /**
   * 一个节点的入队流程。
   *
   * 先查这个节点是否已经有任务：崩溃恢复或重复推进时不能产生第二个任务，
   * 否则会重复扣费。
   */
  async function enqueueNode({ node, run }) {
    if (typeof enqueueTask !== 'function') return {};
    if (!taskRepository) return {};

    const existing = workflowRunRepository.getTaskByWorkflowRunNode(run.id, node.id);
    if (existing && existing.status !== 'failed' && existing.status !== 'cancelled') {
      return { taskId: existing.id };
    }

    const graph = normalizeGraph(run.definition);
    const outputsByNodeId = new Map();
    for (const runNode of workflowRunRepository.listWorkflowRunNodes(run.id)) {
      if (runNode.status === 'succeeded' && runNode.output != null) {
        outputsByNodeId.set(runNode.nodeId, runNode.output);
      }
    }

    const body = buildNodeTaskBody({ edges: graph.edges, node, outputsByNodeId });
    if (!body) {
      const error = new Error(`Node type "${node.type}" has no queue handler.`);
      error.status = 400;
      throw error;
    }

    const result = await enqueueTask({
      body,
      kind: body.nodeType,
      node,
      run,
      userId: run.userId,
    });
    return result || {};
  }

  /**
   * 推进已提交的上游异步视频任务。
   *
   * 视频走的是"提交 → 轮询 → 落盘"两段式：提交只拿到上游任务号，
   * 产物要等查询接口返回成功才写库。前端在线时由它轮询，
   * 服务端编排下必须由本 worker 承担，否则节点会永远停在 queued。
   */
  async function pollVideoNodes(run) {
    if (typeof advanceVideoTask !== 'function') return 0;
    const nodes = workflowRunRepository.listWorkflowRunNodes(run.id);
    let polled = 0;

    for (const node of nodes) {
      if (node.nodeType !== 'videoGen' && node.nodeType !== 'multiImageVideo') continue;
      if (node.status !== 'queued' && node.status !== 'running') continue;
      if (!node.taskId) continue;

      polled += 1;
      try {
        // 必须带上 userId：视频查询要用它定位任务属主。
        // 少了它查询会查不到任务、拿不到 API Key，然后返回 400 而**不抛异常**，
        // 表现为"轮询在跑但状态永远不动"，日志里也看不到任何错误。
        const result = await advanceVideoTask({ runId: run.id, taskId: node.taskId, userId: run.userId });
        // 明确记录失败状态：否则这类问题会完全静默，只能靠人工比对上游状态才发现。
        if (result && typeof result.status === 'number' && result.status >= 400) {
          logger.error?.('workflow video poll returned an error', {
            message: result.data?.error || 'Video task lookup failed.',
            nodeId: node.nodeId,
            runId: run.id,
            status: result.status,
          });
        }
      } catch (error) {
        logger.error?.('workflow video poll failed', {
          message: error?.message || 'Unknown error',
          nodeId: node.nodeId,
          runId: run.id,
        });
      }
    }
    return polled;
  }

  /** 推进一次所有活跃运行。返回本轮统计，便于测试与健康检查断言。 */
  async function tick() {
    if (stopped) return { advanced: 0, polled: 0, recovered: 0, scanned: 0 };
    const active = workflowRunRepository.listActiveWorkflowRuns();
    let advanced = 0;
    let recovered = 0;
    let polled = 0;

    for (const run of active) {
      if (activeRuns.has(run.id)) continue;
      activeRuns.add(run.id);
      try {
        // 任务丢失的节点先收尾，否则会一直等一个永远不来的结果
        const reconcile = workflowRunService.reconcileRun({
          readTaskOutcome,
          runId: run.id,
        });
        if (reconcile.changed > 0) recovered += reconcile.changed;

        // 视频是异步任务：先轮询上游，让产物有机会落盘，
        // 再做产物回流，否则节点会被当成"还在等"而一直挂着。
        polled += await pollVideoNodes(run);

        workflowRunService.syncNodeOutcomes({
          readTaskOutcome,
          runId: run.id,
        });

        await workflowRunService.advanceRunOnce({
          enqueueNode,
          runId: run.id,
        });
        advanced += 1;
      } catch (error) {
        logger.error?.('workflow run advance failed', {
          message: error?.message || 'Unknown error',
          runId: run.id,
        });
      } finally {
        activeRuns.delete(run.id);
      }
    }

    return { advanced, polled, recovered, scanned: active.length };
  }

  function start() {
    if (timer) return;
    stopped = false;
    if (pollIntervalMs > 0) {
      timer = setInterval(() => {
        if (running) return;
        running = true;
        tick()
          .catch((error) => logger.error?.('workflow run tick failed', { message: error?.message }))
          .finally(() => {
            running = false;
          });
      }, pollIntervalMs);
      // 常驻进程里不应阻止退出
      if (typeof timer.unref === 'function') timer.unref();
    }
  }

  /**
   * 停止推进。默认会等在途一轮结束，避免关库时还有写入。
   * 测试可以传 { wait: false } 立即返回。
   */
  async function stop({ wait = true } = {}) {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (!wait) return;
    // 等在途的一轮结束，避免关库时还有写入
    while (running || activeRuns.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  function getStats() {
    return {
      activeCount: activeRuns.size,
      enabled,
      pollIntervalMs,
      scheduled: Boolean(timer),
      stopped,
    };
  }

  if (autoStart && enabled) start();

  return {
    enabled,
    enqueueNode,
    getWorkflowRunWorkerStats: getStats,
    startWorkflowRunWorker: start,
    stopWorkflowRunWorker: stop,
    tick,
  };
}

module.exports = {
  createWorkflowRunWorker,
};
