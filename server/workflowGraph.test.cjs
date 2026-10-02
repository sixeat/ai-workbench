// 工作流图纯函数的回归测试。
//
// 这层逻辑决定"哪个节点该跑、哪个该等、哪个注定跑不成"，
// 判错会导致流水线卡死或跳过节点，所以覆盖要密。
const assert = require('node:assert/strict');
const test = require('node:test');

const {
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
} = require('./services/workflowGraph.cjs');

// ---- 构造辅助 ----------------------------------------------------------

function node(id, type, config = {}) {
  return { id, type, data: { label: id, type, config } };
}

function edge(source, target, sourceKey = '', targetKey = '') {
  return { id: `${source}->${target}`, source, target, data: { sourceKey, targetKey } };
}

function rows(...entries) {
  return entries.map(([nodeId, status, output]) => ({
    nodeId,
    status,
    output: output ?? null,
    taskId: null,
    attempt: 0,
  }));
}

// 一条典型的四段流水线：文本输入 → 提示词优化 → 图片生成 → 预览
const LINEAR = {
  nodes: [
    node('t1', 'textInput'),
    node('p1', 'promptOptimize'),
    node('i1', 'imageGen'),
    node('o1', 'preview'),
  ],
  edges: [edge('t1', 'p1'), edge('p1', 'i1'), edge('i1', 'o1')],
};

// ---- normalizeGraph ----------------------------------------------------

test('normalizeGraph 丢弃悬空边与自环，避免把节点数算错', () => {
  const graph = normalizeGraph({
    nodes: [node('a', 'textInput'), node('b', 'preview')],
    edges: [
      edge('a', 'b'),
      edge('a', 'missing'),
      edge('missing', 'b'),
      edge('a', 'a'),
      edge('a', 'b'), // 重复边
    ],
  });

  assert.deepEqual(graph.nodes.map((n) => n.id), ['a', 'b']);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].source, 'a');
  assert.equal(graph.edges[0].target, 'b');
});

test('normalizeGraph 忽略没有 id 的节点，并回填 type 与 config', () => {
  const graph = normalizeGraph({
    nodes: [{ id: '', type: 'textInput' }, node('keep', 'imageGen', { model: 'm1' })],
    edges: [],
  });

  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].id, 'keep');
  assert.equal(graph.nodes[0].type, 'imageGen');
  assert.deepEqual(graph.nodes[0].config, { model: 'm1' });
});

test('normalizeGraph 对空定义与异常输入保持稳定', () => {
  assert.deepEqual(normalizeGraph(), { nodes: [], edges: [] });
  assert.deepEqual(normalizeGraph({ nodes: 'nope', edges: 5 }), { nodes: [], edges: [] });
});

// ---- topologicalSort ---------------------------------------------------

test('topologicalSort 对线性链路给出稳定顺序', () => {
  const { order, hasCycle } = topologicalSort(LINEAR.nodes, LINEAR.edges);
  assert.equal(hasCycle, false);
  assert.deepEqual(order, ['t1', 'p1', 'i1', 'o1']);
});

test('topologicalSort 检测循环依赖并返回不完整顺序', () => {
  const nodes = [node('a', 'textModel'), node('b', 'textModel'), node('c', 'preview')];
  const edges = [edge('a', 'b'), edge('b', 'a'), edge('b', 'c')];
  const { order, hasCycle } = topologicalSort(nodes, edges);

  assert.equal(hasCycle, true);
  assert.ok(order.length < nodes.length);
});

test('topologicalSort 对同层节点的顺序稳定可复现', () => {
  const nodes = [node('root', 'textInput'), node('x', 'imageGen'), node('y', 'imageGen'), node('z', 'preview')];
  const edges = [edge('root', 'x'), edge('root', 'y'), edge('x', 'z'), edge('y', 'z')];

  const first = topologicalSort(nodes, edges).order;
  const second = topologicalSort(nodes, edges).order;
  assert.deepEqual(first, second);
  assert.deepEqual(first, ['root', 'x', 'y', 'z']);
});

test('topologicalSort 处理孤立节点与空图', () => {
  assert.deepEqual(topologicalSort([], []), { hasCycle: false, order: [] });
  const { order, hasCycle } = topologicalSort([node('solo', 'textInput')], []);
  assert.deepEqual(order, ['solo']);
  assert.equal(hasCycle, false);
});

// ---- 上下游收集 --------------------------------------------------------

test('directUpstreamIds 与 downstreamNodeIds 只走一层', () => {
  assert.deepEqual(directUpstreamIds('i1', LINEAR.edges), ['p1']);
  assert.deepEqual([...downstreamNodeIds('p1', LINEAR.edges)].sort(), ['i1', 'o1']);
});

test('upstreamNodeIds 递归收集全部上游，且不包含自己', () => {
  const collected = upstreamNodeIds('o1', LINEAR.edges);
  assert.deepEqual([...collected].sort(), ['i1', 'p1', 't1']);
  assert.equal(collected.has('o1'), false);
});

test('递归上下游收集能处理菱形结构且不重复', () => {
  const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
  assert.deepEqual([...upstreamNodeIds('d', edges)].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...downstreamNodeIds('a', edges)].sort(), ['b', 'c', 'd']);
});

// ---- 节点分类 ----------------------------------------------------------

test('输入类与参数类节点由本地直接产出，不需要入队', () => {
  for (const type of ['textInput', 'imageInput', 'merge', 'preview', 'seedParam', 'styleParam']) {
    assert.equal(isLocalTerminalNode(type), true, `${type} 应为本地节点`);
  }
  for (const type of ['textModel', 'script', 'shotSplit', 'promptOptimize', 'imageGen', 'videoGen']) {
    assert.equal(isLocalTerminalNode(type), false, `${type} 需要入队`);
  }
});

test('终态判断覆盖成功、失败、跳过与取消', () => {
  for (const status of ['succeeded', 'failed', 'skipped', 'cancelled']) {
    assert.equal(isTerminalNodeStatus(status), true, status);
  }
  for (const status of ['pending', 'blocked', 'queued', 'running', '']) {
    assert.equal(isTerminalNodeStatus(status), false, status);
  }
});

// ---- 就绪判断 ----------------------------------------------------------

test('根节点（无上游）天然就绪', () => {
  assert.equal(isNodeReady('t1', LINEAR.edges, new Map()), true);
});

test('上游成功但产物为空时下游不就绪', () => {
  const states = nodeStateMapFromRows(rows(['t1', 'succeeded', { text: 'hi' }], ['p1', 'succeeded', null]));
  assert.equal(isNodeReady('p1', LINEAR.edges, states), true, 't1 有产物，p1 应就绪');
  assert.equal(isNodeReady('i1', LINEAR.edges, states), false, 'p1 产物为空，i1 不应就绪');
});

test('上游失败或未完成时下游不就绪', () => {
  const failed = nodeStateMapFromRows(rows(['t1', 'succeeded', {}], ['p1', 'failed', null]));
  assert.equal(isNodeReady('i1', LINEAR.edges, failed), false);

  const running = nodeStateMapFromRows(rows(['t1', 'succeeded', {}], ['p1', 'running', null]));
  assert.equal(isNodeReady('i1', LINEAR.edges, running), false);
});

test('多上游时全部成功且都有产物才就绪', () => {
  const edges = [edge('a', 'c'), edge('b', 'c')];
  const partial = nodeStateMapFromRows(rows(['a', 'succeeded', {}], ['b', 'running', null]));
  assert.equal(isNodeReady('c', edges, partial), false);

  const complete = nodeStateMapFromRows(rows(['a', 'succeeded', {}], ['b', 'succeeded', {}]));
  assert.equal(isNodeReady('c', edges, complete), true);
});

test('nodeStateMapFromRows 把 null 产物识别为无数据', () => {
  const states = nodeStateMapFromRows(rows(['a', 'succeeded', null], ['b', 'succeeded', 0]));
  assert.equal(states.get('a').hasOutput, false);
  assert.equal(states.get('b').hasOutput, true, '产物为 0 也算有数据');
});

// ---- 推进计划 ----------------------------------------------------------

test('planWorkflowRun：根节点进 runnable，需要调模型的进 ready', () => {
  const plan = planWorkflowRun({
    nodes: LINEAR.nodes,
    edges: LINEAR.edges,
    nodeStates: nodeStateMapFromRows(rows(
      ['t1', 'pending', null],
      ['p1', 'pending', null],
      ['i1', 'pending', null],
      ['o1', 'pending', null]
    )),
  });

  assert.deepEqual(plan.runnable, ['t1']);
  assert.deepEqual(plan.ready, []);
  assert.deepEqual(plan.waiting, ['p1', 'i1', 'o1']);
  assert.deepEqual(plan.blocked, []);
  assert.equal(plan.hasPendingWork, true);
});

test('planWorkflowRun：上游成功后下游进入 ready', () => {
  const plan = planWorkflowRun({
    nodes: LINEAR.nodes,
    edges: LINEAR.edges,
    nodeStates: nodeStateMapFromRows(rows(
      ['t1', 'succeeded', { text: 'theme' }],
      ['p1', 'pending', null],
      ['i1', 'pending', null],
      ['o1', 'pending', null]
    )),
  });

  assert.deepEqual(plan.ready, ['p1']);
  assert.deepEqual(plan.waiting, ['i1', 'o1']);
});

test('planWorkflowRun：上游失败会把整条下游链判为 blocked', () => {
  const plan = planWorkflowRun({
    nodes: LINEAR.nodes,
    edges: LINEAR.edges,
    nodeStates: nodeStateMapFromRows(rows(
      ['t1', 'succeeded', { text: 'theme' }],
      ['p1', 'failed', null],
      ['i1', 'pending', null],
      ['o1', 'pending', null]
    )),
  });

  assert.deepEqual(plan.ready, []);
  // 一次推进就要把整条下游链标完，否则驱动层要跑很多轮才能收敛
  assert.deepEqual(plan.blocked, ['i1', 'o1']);
  assert.deepEqual(plan.waiting, []);
});

test('planWorkflowRun：blocked 会沿长链传播，且不影响无关分支', () => {
  const nodes = [
    node('root', 'textInput'),
    node('bad', 'imageGen'),
    node('mid', 'preview'),
    node('tail', 'preview'),
    node('healthy', 'imageGen'),
  ];
  const edges = [edge('root', 'bad'), edge('bad', 'mid'), edge('mid', 'tail'), edge('root', 'healthy')];

  const plan = planWorkflowRun({
    nodes,
    edges,
    nodeStates: nodeStateMapFromRows(rows(
      ['root', 'succeeded', { text: 'theme' }],
      ['bad', 'failed', null],
      ['mid', 'pending', null],
      ['tail', 'pending', null],
      ['healthy', 'pending', null]
    )),
  });

  assert.deepEqual(plan.blocked, ['mid', 'tail']);
  assert.deepEqual(plan.ready, ['healthy'], '无关分支不应被牵连');
});

test('planWorkflowRun：取消的节点同样会阻断下游', () => {
  const plan = planWorkflowRun({
    nodes: LINEAR.nodes,
    edges: LINEAR.edges,
    nodeStates: nodeStateMapFromRows(rows(
      ['t1', 'succeeded', { text: 'theme' }],
      ['p1', 'cancelled', null],
      ['i1', 'pending', null],
      ['o1', 'pending', null]
    )),
  });

  assert.deepEqual(plan.blocked, ['i1', 'o1']);
});

test('planWorkflowRun：已在队列或运行中的节点不会重复入队', () => {
  const plan = planWorkflowRun({
    nodes: LINEAR.nodes,
    edges: LINEAR.edges,
    nodeStates: nodeStateMapFromRows(rows(
      ['t1', 'succeeded', { text: 'theme' }],
      ['p1', 'queued', null],
      ['i1', 'pending', null],
      ['o1', 'pending', null]
    )),
  });

  assert.deepEqual(plan.ready, [], 'queued 的节点不应再次入队');
  assert.deepEqual(plan.waiting, ['i1', 'o1']);
  assert.deepEqual(plan.blocked, []);
});

test('planWorkflowRun：全部终态时 hasPendingWork 为假', () => {
  const plan = planWorkflowRun({
    nodes: LINEAR.nodes,
    edges: LINEAR.edges,
    nodeStates: nodeStateMapFromRows(rows(
      ['t1', 'succeeded', {}],
      ['p1', 'succeeded', {}],
      ['i1', 'succeeded', {}],
      ['o1', 'succeeded', {}]
    )),
  });

  assert.equal(plan.hasPendingWork, false);
  assert.deepEqual([plan.ready, plan.runnable, plan.blocked, plan.waiting].flat(), []);
});

test('planWorkflowRun：未登记状态的节点按 pending 处理', () => {
  const plan = planWorkflowRun({ nodes: LINEAR.nodes, edges: LINEAR.edges, nodeStates: new Map() });
  assert.deepEqual(plan.runnable, ['t1']);
  assert.equal(plan.hasPendingWork, true);
});

// ---- 运行状态汇总 ------------------------------------------------------

test('summarizeRunStatus：还有非终态节点时为 running', () => {
  assert.equal(summarizeRunStatus(nodeStateMapFromRows(rows(
    ['a', 'succeeded', {}],
    ['b', 'pending', null]
  ))), 'running');
});

test('summarizeRunStatus：任一节点失败则整次运行失败', () => {
  assert.equal(summarizeRunStatus(nodeStateMapFromRows(rows(
    ['a', 'succeeded', {}],
    ['b', 'failed', null],
    ['c', 'skipped', null]
  ))), 'failed');
});

test('summarizeRunStatus：取消优先于全部成功，但失败优先于取消', () => {
  assert.equal(summarizeRunStatus(nodeStateMapFromRows(rows(
    ['a', 'succeeded', {}],
    ['b', 'cancelled', null]
  ))), 'cancelled');

  assert.equal(summarizeRunStatus(nodeStateMapFromRows(rows(
    ['a', 'failed', null],
    ['b', 'cancelled', null]
  ))), 'failed');
});

test('summarizeRunStatus：全部成功或跳过即为成功', () => {
  assert.equal(summarizeRunStatus(nodeStateMapFromRows(rows(
    ['a', 'succeeded', {}],
    ['b', 'skipped', null]
  ))), 'succeeded');
  assert.equal(summarizeRunStatus(new Map()), 'succeeded', '空图视为成功');
});
