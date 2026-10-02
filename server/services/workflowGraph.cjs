// 工作流图的纯函数工具：拓扑排序、就绪判断、依赖收集。
//
// 这里刻意不碰数据库也不碰队列，全部是输入到输出的纯函数，便于单独测试。
//
// 与前端 `src/engine/WorkflowEngine.ts` 的语义保持一致（见 docs/workflow-execution-semantics.md）：
// 同样的 Kahn 拓扑排序、同样的循环依赖判定。语义若漂移，同一条流水线
// 在前端单跑和服务端整跑会得出不同结果。

// 这些节点没有上游依赖，本身不调用厂商接口，产出由本地规则决定。
// 其余节点都需要入队执行。
const LOCAL_TERMINAL_NODE_TYPES = new Set([
  'textInput',
  'imageInput',
  'multiImageInput',
  'merge',
  'preview',
]);

// 参数类节点：产出 parameter 信封，供下游读取。同样不需要入队。
const PARAMETER_NODE_TYPES = new Set([
  'promptParam',
  'negativePromptParam',
  'styleParam',
  'sizeParam',
  'qualityParam',
  'seedParam',
  'countParam',
  'referenceStrengthParam',
  'shotParam',
]);

function isLocalTerminalNode(nodeType) {
  return LOCAL_TERMINAL_NODE_TYPES.has(nodeType) || PARAMETER_NODE_TYPES.has(nodeType);
}

function nodeIdOf(node) {
  return String(node?.id || '').trim();
}

function edgeEndpoints(edge) {
  return {
    source: String(edge?.source || '').trim(),
    target: String(edge?.target || '').trim(),
  };
}

/**
 * 规范化图定义。
 *
 * 只保留两端都存在的边——悬空边会让拓扑排序把节点数算错，
 * 从而误判成"存在循环依赖"。前端也是只保留参与集内部的边。
 */
function normalizeGraph(definition = {}) {
  const rawNodes = Array.isArray(definition.nodes) ? definition.nodes : [];
  const rawEdges = Array.isArray(definition.edges) ? definition.edges : [];

  const nodes = rawNodes
    .filter((node) => nodeIdOf(node))
    .map((node) => {
      // 配置可能在 node.data.config，也可能被拍平在节点本身——两种都要认，
      // 否则从数据库读回来的定义会丢掉全部配置。
      const nestedConfig = (node?.data?.config && typeof node.data.config === 'object')
        ? node.data.config
        : null;
      return {
        id: nodeIdOf(node),
        type: String(node?.type || node?.data?.type || '').trim(),
        label: String(node?.data?.label || node?.type || '').trim(),
        config: nestedConfig || (typeof node?.config === 'object' && node.config !== null ? node.config : {}),
      };
    });

  const knownIds = new Set(nodes.map((node) => node.id));
  const edges = [];
  const seenEdgeKeys = new Set();
  for (const edge of rawEdges) {
    const { source, target } = edgeEndpoints(edge);
    if (!source || !target) continue;
    if (!knownIds.has(source) || !knownIds.has(target)) continue;
    if (source === target) continue;
    const key = `${source}->${target}`;
    if (seenEdgeKeys.has(key)) continue;
    seenEdgeKeys.add(key);
    edges.push({
      id: String(edge?.id || key),
      source,
      target,
      sourceKey: String(edge?.data?.sourceKey || edge?.sourceHandle || '').trim(),
      targetKey: String(edge?.data?.targetKey || edge?.targetHandle || '').trim(),
    });
  }

  return { nodes, edges };
}

function buildAdjacency(edges) {
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge.target);
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    incoming.get(edge.target).push(edge.source);
  }
  return { incoming, outgoing };
}

/**
 * Kahn 拓扑排序。
 *
 * 返回 { order, hasCycle }。hasCycle 为真时 order 长度会小于节点数，
 * 调用方必须据此拒绝执行，而不是部分执行。
 */
function topologicalSort(nodes, edges) {
  const ids = nodes.map(nodeIdOf).filter(Boolean);
  const inDegree = new Map(ids.map((id) => [id, 0]));
  const { outgoing } = buildAdjacency(edges);

  for (const edge of edges) {
    if (!inDegree.has(edge.target)) continue;
    inDegree.set(edge.target, inDegree.get(edge.target) + 1);
  }

  // 入度为 0 的节点按传入顺序入队，保证同一张图每次跑出的顺序一致。
  const queue = ids.filter((id) => inDegree.get(id) === 0);
  const order = [];
  while (queue.length > 0) {
    const current = queue.shift();
    order.push(current);
    for (const next of outgoing.get(current) || []) {
      if (!inDegree.has(next)) continue;
      const degree = inDegree.get(next) - 1;
      inDegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }

  return { hasCycle: order.length !== ids.length, order };
}

/** 直接上游节点 id 列表（去重，保持边顺序）。 */
function directUpstreamIds(nodeId, edges) {
  const seen = new Set();
  const result = [];
  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    if (seen.has(edge.source)) continue;
    seen.add(edge.source);
    result.push(edge.source);
  }
  return result;
}

/** 递归上游节点 id 集合。 */
function upstreamNodeIds(nodeId, edges) {
  const collected = new Set();
  const visit = (current) => {
    for (const upstream of directUpstreamIds(current, edges)) {
      if (collected.has(upstream)) continue;
      collected.add(upstream);
      visit(upstream);
    }
  };
  visit(nodeId);
  return collected;
}

/** 递归下游节点 id 集合（用于取消与失败传播）。 */
function downstreamNodeIds(nodeId, edges) {
  const collected = new Set();
  const visit = (current) => {
    for (const edge of edges) {
      if (edge.source !== current) continue;
      if (collected.has(edge.target)) continue;
      collected.add(edge.target);
      visit(edge.target);
    }
  };
  visit(nodeId);
  return collected;
}

/** 终态：不会再变化的状态。 */
const TERMINAL_NODE_STATUSES = new Set(['succeeded', 'failed', 'skipped', 'cancelled']);

function isTerminalNodeStatus(status) {
  return TERMINAL_NODE_STATUSES.has(String(status || ''));
}

/**
 * 判断节点是否已就绪：所有直接上游都成功，且都产出了数据。
 *
 * 上游失败或取消时该节点永远不就绪——它的终态由失败传播逻辑决定。
 */
function isNodeReady(nodeId, edges, nodeStates) {
  const upstream = directUpstreamIds(nodeId, edges);
  if (upstream.length === 0) return true;

  return upstream.every((id) => {
    const state = nodeStates.get(id);
    if (!state) return false;
    if (state.status !== 'succeeded') return false;
    return state.hasOutput === true;
  });
}

/**
 * 从节点行推导出推进器需要的状态表。
 *
 * hasOutput 的判定要排除 null：某些节点成功但产物为空是合法情况
 * （例如参数节点），此时下游应当继续，而不是被卡住。
 */
function nodeStateMapFromRows(rows = []) {
  const map = new Map();
  for (const row of rows) {
    map.set(row.nodeId, {
      status: row.status,
      hasOutput: row.output != null,
      taskId: row.taskId || null,
      attempt: Number(row.attempt || 0),
    });
  }
  return map;
}

/**
 * 一轮推进计划。
 *
 * 只做判断，不产生副作用。返回：
 * - ready: 可以立刻入队执行的节点 id
 * - runnable: 需要本地直接产出（输入/参数类节点）的节点 id
 * - blocked: 上游失败或取消、注定跑不成的节点 id
 * - waiting: 上游还没跑完的节点 id
 * - hasPendingWork: 是否还有非终态节点
 */
function planWorkflowRun({ nodes, edges, nodeStates }) {
  const ready = [];
  const runnable = [];
  const blocked = [];
  const waiting = [];
  let hasPendingWork = false;

  // 终态且注定跑不成的节点。失败与取消都算，blocked 会在下面迭代扩散。
  const deadNodes = new Set();
  for (const node of nodes) {
    const status = String(nodeStates.get(node.id)?.status || 'pending');
    if (status === 'failed' || status === 'cancelled') deadNodes.add(node.id);
  }

  // 被死节点挡住的下游同样跑不成。要迭代到收敛，否则一次推进只能标记一层，
  // 整条下游链要花很多轮才标完。
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (!deadNodes.has(edge.source)) continue;
      if (deadNodes.has(edge.target)) continue;
      deadNodes.add(edge.target);
      changed = true;
    }
  }

  for (const node of nodes) {
    const status = String(nodeStates.get(node.id)?.status || 'pending');
    if (isTerminalNodeStatus(status)) continue;
    hasPendingWork = true;

    if (deadNodes.has(node.id)) {
      blocked.push(node.id);
      continue;
    }

    // 已经在队列里或正在跑，等结果即可
    if (status === 'queued' || status === 'running') continue;

    if (!isNodeReady(node.id, edges, nodeStates)) {
      waiting.push(node.id);
      continue;
    }

    if (isLocalTerminalNode(node.type)) runnable.push(node.id);
    else ready.push(node.id);
  }

  return { blocked, hasPendingWork, ready, runnable, waiting };
}

/**
 * 判断整次运行是否结束，以及结束时的状态。
 *
 * 只要有节点失败或取消，整次运行就是失败的——与前端"任一节点失败即中断整批"一致。
 */
function summarizeRunStatus(nodeStates) {
  if (nodeStates.size === 0) return 'succeeded';

  let failed = 0;
  let cancelled = 0;
  let pending = 0;
  let succeeded = 0;

  for (const state of nodeStates.values()) {
    const status = String(state.status || 'pending');
    if (status === 'failed') failed += 1;
    else if (status === 'cancelled') cancelled += 1;
    else if (status === 'succeeded' || status === 'skipped') succeeded += 1;
    else pending += 1;
  }

  if (pending > 0) return 'running';
  if (failed > 0) return 'failed';
  if (cancelled > 0) return 'cancelled';
  return succeeded > 0 ? 'succeeded' : 'succeeded';
}

module.exports = {
  buildAdjacency,
  directUpstreamIds,
  downstreamNodeIds,
  isLocalTerminalNode,
  isNodeReady,
  isTerminalNodeStatus,
  nodeStateMapFromRows,
  normalizeGraph,
  planWorkflowRun,
  summarizeRunStatus,
  topologicalSort,
  upstreamNodeIds,
};
