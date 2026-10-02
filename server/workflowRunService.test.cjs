// 服务端工作流运行编排的回归测试。
//
// 用真实数据库跑完整链路：建运行 → 推进 → 节点终态 → 汇总运行状态。
// 生成型节点的入队用注入的假 enqueueNode 替代，不碰真实队列。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-wfrun-service-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const { createUser, db, updateTask, createTask } = require('./db.cjs');
const { workflowRepository } = require('./repositories/workflowRepository.cjs');
const { createWorkflowRunService } = require('./services/workflowRunService.cjs');
const { createTaskRepository } = require('./repositories/taskRepository.cjs');
const { workflowRunRepository } = require('./repositories/workflowRunRepository.cjs');

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

let seq = 0;
function nextUser(label) {
  seq += 1;
  const email = `${label}-${seq}@example.com`;
  return createUser({ email, username: email, name: label, passwordHash: 'test' });
}

function saveWorkflow(userId, nodes, edges) {
  return workflowRepository.upsertWorkflow({
    userId,
    name: `wf-${seq}`,
    description: '',
    nodes,
    edges,
  });
}

function node(id, type, config = {}) {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, type, config } };
}

function edge(source, target) {
  return { id: `${source}->${target}`, source, target };
}

// 文本输入 → 提示词优化 → 图片生成 → 预览
const PIPELINE = {
  nodes: [
    node('t1', 'textInput', { content: '一只橘猫在阳光下打盹' }),
    node('p1', 'promptOptimize'),
    node('i1', 'imageGen'),
    node('o1', 'preview'),
  ],
  edges: [edge('t1', 'p1'), edge('p1', 'i1'), edge('i1', 'o1')],
};

function makeService() {
  return createWorkflowRunService({ workflowRepository });
}

// 真建一条任务行再返回 id。节点表对 tasks 有外键，
// 返回不存在的 taskId 会被正确拒绝——所以测试也必须建真任务。
// 任务 id 必须全局唯一：主键冲突会让 createTask 抛错，被上层误判成入队失败。
let taskSeq = 0;
function makeEnqueuer(userId, sink = []) {
  return async ({ node: workflowNode }) => {
    taskSeq += 1;
    const taskId = `task-${workflowNode.id}-${taskSeq}`;
    createTask({
      id: taskId,
      userId,
      nodeType: workflowNode.type === 'imageGen' || workflowNode.type === 'videoGen' ? 'image' : 'text',
      model: 'test-model',
      providerId: 'test',
      status: 'queued',
      input: { prompt: 'x' },
    });
    sink.push({ nodeId: workflowNode.id, taskId });
    return { taskId };
  };
}

const taskRepository = createTaskRepository();

function readTaskOutcome(taskId) {
  const task = taskRepository.getTask(taskId);
  if (!task) return null;
  return { durationMs: task.durationMs, error: task.error, output: task.output, status: task.status };
}

// ---- 创建运行 ----------------------------------------------------------

test('创建运行会存图快照并建出全部节点行', () => {
  const user = nextUser('wfrun-create');
  const workflow = saveWorkflow(user.id, PIPELINE.nodes, PIPELINE.edges);
  const service = makeService();

  const { created, run } = service.createRun({ userId: user.id, workflowId: workflow.id });

  assert.equal(created, true);
  assert.equal(run.status, 'queued');
  assert.equal(run.trigger, 'manual');
  assert.equal(run.totalNodes, 4);
  assert.equal(run.finishedNodes, 0);
  assert.ok(run.graphHash, '应当记录图指纹');
  // 快照必须完整，模板之后被改动也不影响这次运行
  assert.equal(run.definition.nodes.length, 4);
  assert.equal(run.definition.edges.length, 3);

  const nodes = workflowRunRepository.listWorkflowRunNodes(run.id);
  assert.equal(nodes.length, 4);
  assert.equal(nodes.every((item) => item.status === 'pending'), true);
  assert.deepEqual(nodes.map((item) => item.nodeId).sort(), ['i1', 'o1', 'p1', 't1']);
});

test('同一幂等键重复提交只产生一个运行', () => {
  const user = nextUser('wfrun-idempotent');
  const workflow = saveWorkflow(user.id, PIPELINE.nodes, PIPELINE.edges);
  const service = makeService();

  const first = service.createRun({ userId: user.id, workflowId: workflow.id, idempotencyKey: 'k-1' });
  const second = service.createRun({ userId: user.id, workflowId: workflow.id, idempotencyKey: 'k-1' });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.run.id, first.run.id);
  assert.equal(service.listRuns({ userId: user.id }).total, 1);
});

test('存在循环依赖的工作流被拒绝执行', () => {
  const user = nextUser('wfrun-cycle');
  const workflow = saveWorkflow(
    user.id,
    [node('a', 'textModel'), node('b', 'textModel')],
    [edge('a', 'b'), edge('b', 'a')]
  );
  const service = makeService();

  assert.throws(
    () => service.createRun({ userId: user.id, workflowId: workflow.id }),
    /cycle/i
  );
});

test('空工作流被拒绝执行，且不留下运行记录', () => {
  const user = nextUser('wfrun-empty');
  const workflow = saveWorkflow(user.id, [], []);
  const service = makeService();

  assert.throws(() => service.createRun({ userId: user.id, workflowId: workflow.id }), /no nodes/i);
  assert.equal(service.listRuns({ userId: user.id }).total, 0);
});

test('跨用户不能对他人工作流建运行', () => {
  const owner = nextUser('wfrun-owner');
  const intruder = nextUser('wfrun-intruder');
  const workflow = saveWorkflow(owner.id, PIPELINE.nodes, PIPELINE.edges);
  const service = makeService();

  assert.throws(
    () => service.createRun({ userId: intruder.id, workflowId: workflow.id }),
    /not found/i
  );
});

test('图指纹忽略节点位置，但配置变化会改变指纹', () => {
  const service = makeService();
  const base = [{ id: 'a', type: 'textInput', config: { content: 'x' } }];
  const moved = [{ id: 'a', type: 'textInput', config: { content: 'x' }, x: 999 }];
  const changed = [{ id: 'a', type: 'textInput', config: { content: 'y' } }];

  const hashOf = (nodes) => {
    const { normalizeGraph } = require('./services/workflowGraph.cjs');
    return service.graphHashOf(normalizeGraph({ nodes, edges: [] }));
  };

  assert.equal(hashOf(base), hashOf(moved), '挪动节点不应改变指纹');
  assert.notEqual(hashOf(base), hashOf(changed), '配置变化必须改变指纹');
});

// ---- 推进 --------------------------------------------------------------

test('推进一轮：本地节点直接产出，生成型节点入队，运行转为 running', async () => {
  const user = nextUser('wfrun-advance');
  const workflow = saveWorkflow(user.id, PIPELINE.nodes, PIPELINE.edges);
  const service = makeService();
  const { run } = service.createRun({ userId: user.id, workflowId: workflow.id });

  const enqueued = [];
  const result = await service.advanceRunOnce({
    runId: run.id,
    userId: user.id,
    enqueueNode: async ({ node: workflowNode }) => {
      enqueued.push(workflowNode.id);
      return { taskId: `task-for-${workflowNode.id}` };
    },
  });

  assert.deepEqual(enqueued, [], '首轮只有本地节点就绪，不应入队');
  assert.equal(result.status, 'running');

  const nodes = workflowRunRepository.listWorkflowRunNodes(run.id);
  const textNode = nodes.find((item) => item.nodeId === 't1');
  assert.equal(textNode.status, 'succeeded');
  assert.equal(textNode.output.text, '一只橘猫在阳光下打盹');

  // t1 有产物后，p1 在下一轮就绪
  const second = await service.advanceRunOnce({
    runId: run.id,
    userId: user.id,
    enqueueNode: async ({ node: workflowNode }) => {
      enqueued.push(workflowNode.id);
      return { taskId: `task-for-${workflowNode.id}` };
    },
  });
  assert.deepEqual(enqueued, ['p1']);
  assert.equal(second.status, 'running');
  assert.equal(workflowRunRepository.getWorkflowRunNode(run.id, 'p1').status, 'queued');
});

test('节点任务成功后产物回流，下游逐段推进直到运行成功', async () => {
  const user = nextUser('wfrun-end-to-end');
  const workflow = saveWorkflow(user.id, PIPELINE.nodes, PIPELINE.edges);
  const service = makeService();
  const taskRepository = createTaskRepository();
  const { run } = service.createRun({ userId: user.id, workflowId: workflow.id });

  const readTaskOutcome = (taskId) => {
    const task = taskRepository.getTask(taskId);
    if (!task) return null;
    return { durationMs: task.durationMs, error: task.error, output: task.output, status: task.status };
  };

  const enqueueNode = async ({ node: workflowNode }) => {
    const taskId = `task-${workflowNode.id}-${run.id.slice(0, 4)}`;
    createTask({
      id: taskId,
      userId: user.id,
      nodeType: workflowNode.type === 'imageGen' ? 'image' : 'text',
      model: 'test-model',
      providerId: 'test',
      status: 'queued',
      input: { prompt: 'x' },
    });
    return { taskId };
  };

  // 反复推进，模拟 worker 循环；每个生成型节点入队后立刻让它成功
  for (let round = 0; round < 8; round += 1) {
    await service.advanceRunOnce({ runId: run.id, userId: user.id, enqueueNode });

    const pending = workflowRunRepository.listWorkflowRunNodes(run.id)
      .filter((item) => item.status === 'queued' && item.taskId);
    for (const item of pending) {
      const output = item.nodeId === 'i1'
        ? { image: { id: 'asset-1', type: 'image', url: '/api/assets/asset-1' } }
        : { text: `${item.nodeId}-out` };
      updateTask(item.taskId, { status: 'succeeded', output });
    }
    service.syncNodeOutcomes({ runId: run.id, readTaskOutcome });

    const current = workflowRunRepository.getWorkflowRun(run.id);
    if (service.isTerminalRunStatus(current.status)) break;
  }

  const finished = workflowRunRepository.getWorkflowRun(run.id);
  assert.equal(finished.status, 'succeeded');
  assert.equal(finished.finishedNodes, 4);
  assert.equal(finished.error, null);
  // 成片产物从图片节点收集而来
  assert.deepEqual(finished.output.assets.map((item) => item.id), ['asset-1']);
});

test('节点失败会把下游整条链取消，运行最终为 failed', async () => {
  const user = nextUser('wfrun-failure');
  const workflow = saveWorkflow(user.id, PIPELINE.nodes, PIPELINE.edges);
  const service = makeService();
  const { run } = service.createRun({ userId: user.id, workflowId: workflow.id });

  const enqueueNode = makeEnqueuer(user.id);
  await service.advanceRunOnce({ runId: run.id, userId: user.id, enqueueNode });

  // 让 p1 入队后失败
  await service.advanceRunOnce({ runId: run.id, userId: user.id, enqueueNode });
  const p1 = workflowRunRepository.getWorkflowRunNode(run.id, 'p1');
  assert.ok(p1.taskId);
  updateTask(p1.taskId, { status: 'failed', error: { message: 'upstream exploded' } });

  service.syncNodeOutcomes({ runId: run.id, readTaskOutcome });

  const result = await service.advanceRunOnce({ runId: run.id, userId: user.id, enqueueNode });

  assert.equal(result.status, 'failed');
  assert.equal(result.finished, true);
  assert.equal(workflowRunRepository.getWorkflowRunNode(run.id, 'i1').status, 'cancelled');
  assert.equal(workflowRunRepository.getWorkflowRunNode(run.id, 'o1').status, 'cancelled');
  assert.deepEqual(result.run.error.failedNodeIds, ['p1']);
});

test('取消运行会把所有非终态节点一并取消', async () => {
  const user = nextUser('wfrun-cancel');
  const workflow = saveWorkflow(user.id, PIPELINE.nodes, PIPELINE.edges);
  const service = makeService();
  const { run } = service.createRun({ userId: user.id, workflowId: workflow.id });

  await service.advanceRunOnce({ runId: run.id, userId: user.id, enqueueNode: makeEnqueuer(user.id) });
  const cancelled = service.cancelRun({ runId: run.id, userId: user.id });

  assert.equal(cancelled.run.status, 'cancelled');
  // 未完成的节点全部取消；已完成的不动——取消不应抹掉已经产出的工作
  const byNode = Object.fromEntries(cancelled.nodes.map((item) => [item.nodeId, item.status]));
  assert.equal(byNode.t1, 'succeeded', '已完成的本地节点应保留成功状态');
  assert.equal(byNode.p1, 'cancelled');
  assert.equal(byNode.i1, 'cancelled');
  assert.equal(byNode.o1, 'cancelled');

  // 已终态的运行再次取消应当保持原样
  const again = service.cancelRun({ runId: run.id, userId: user.id });
  assert.equal(again.run.status, 'cancelled');
});

test('跨用户不能读取、取消或推进他人运行', async () => {
  const owner = nextUser('wfrun-iso-owner');
  const other = nextUser('wfrun-iso-other');
  const workflow = saveWorkflow(owner.id, PIPELINE.nodes, PIPELINE.edges);
  const service = makeService();
  const { run } = service.createRun({ userId: owner.id, workflowId: workflow.id });

  assert.throws(() => service.getRun({ runId: run.id, userId: other.id }), /not found/i);
  assert.throws(() => service.cancelRun({ runId: run.id, userId: other.id }), /not found/i);
  assert.equal(service.listRuns({ userId: other.id }).total, 0);
});

// ---- 崩溃恢复 ----------------------------------------------------------

test('reconcile 把"已入队但任务不存在"的节点标失败，避免运行永久卡住', async () => {
  const user = nextUser('wfrun-reconcile');
  const workflow = saveWorkflow(user.id, PIPELINE.nodes, PIPELINE.edges);
  const service = makeService();
  const { run } = service.createRun({ userId: user.id, workflowId: workflow.id });

  const enqueueNode = makeEnqueuer(user.id);
  await service.advanceRunOnce({ runId: run.id, userId: user.id, enqueueNode });
  await service.advanceRunOnce({ runId: run.id, userId: user.id, enqueueNode });
  const queuedNode = workflowRunRepository.getWorkflowRunNode(run.id, 'p1');
  assert.equal(queuedNode.status, 'queued');
  assert.ok(queuedNode.taskId, '任务应当已链接到节点');

  // 模拟任务在重启后丢失：节点还指向一个查不到结果的任务
  const { changed, run: reconciled } = service.reconcileRun({
    runId: run.id,
    readTaskOutcome: () => null,
  });

  assert.equal(changed, 1);
  assert.equal(reconciled.status, 'failed');
  assert.equal(workflowRunRepository.getWorkflowRunNode(run.id, 'p1').status, 'failed');
  assert.equal(workflowRunRepository.getWorkflowRunNode(run.id, 'i1').status, 'cancelled');
});

test('reconcile 不会动已经成功的运行', async () => {
  const user = nextUser('wfrun-reconcile-done');
  const workflow = saveWorkflow(user.id, [node('solo', 'preview')], []);
  const service = makeService();
  const { run } = service.createRun({ userId: user.id, workflowId: workflow.id });
  await service.advanceRunOnce({ runId: run.id, userId: user.id });
  await service.advanceRunOnce({ runId: run.id, userId: user.id });
  assert.equal(workflowRunRepository.getWorkflowRun(run.id).status, 'succeeded');

  const result = service.reconcileRun({ runId: run.id, readTaskOutcome: () => null });
  assert.equal(result.changed, 0);
  assert.equal(result.run.status, 'succeeded');
});

// ---- 失败重跑 ----------------------------------------------------------

test('重跑失败运行：只重置失败与受阻节点，已成功的节点保留不动', async () => {
  const user = nextUser('wfrun-retry');
  const workflow = saveWorkflow(user.id, PIPELINE.nodes, PIPELINE.edges);
  const service = makeService();
  const { run } = service.createRun({ userId: user.id, workflowId: workflow.id });

  const enqueueNode = makeEnqueuer(user.id);
  await service.advanceRunOnce({ runId: run.id, userId: user.id, enqueueNode });
  await service.advanceRunOnce({ runId: run.id, userId: user.id, enqueueNode });
  const p1 = workflowRunRepository.getWorkflowRunNode(run.id, 'p1');
  updateTask(p1.taskId, { status: 'failed', error: { message: 'boom' } });
  service.syncNodeOutcomes({ runId: run.id, readTaskOutcome });
  await service.advanceRunOnce({ runId: run.id, userId: user.id, enqueueNode });
  assert.equal(workflowRunRepository.getWorkflowRun(run.id).status, 'failed');

  const result = service.retryFailedNodes({ runId: run.id, userId: user.id });

  // p1 失败，i1/o1 被级联取消 —— 三者都要重置
  assert.deepEqual([...result.resetNodeIds].sort(), ['i1', 'o1', 'p1']);
  assert.equal(result.run.status, 'queued');
  assert.equal(result.run.error, null);

  const textNode = workflowRunRepository.getWorkflowRunNode(run.id, 't1');
  assert.equal(textNode.status, 'succeeded', '已成功的本地节点必须保留产物');
  assert.equal(textNode.output.text, '一只橘猫在阳光下打盹');
  assert.equal(textNode.attempt, 0, '已成功节点不应累加尝试次数');

  const retried = workflowRunRepository.getWorkflowRunNode(run.id, 'p1');
  assert.equal(retried.status, 'pending');
  assert.equal(retried.error, null);
  assert.equal(retried.taskId, null);
  // attempt 只在真正入队时累加，所以重置后仍是 1（首次入队那次）
  assert.equal(retried.attempt, 1, '重跑重置不应改动尝试次数');
});

test('重跑后继续推进可以成功，且不重复执行已完成的节点', async () => {
  const user = nextUser('wfrun-retry-resume');
  const workflow = saveWorkflow(user.id, PIPELINE.nodes, PIPELINE.edges);
  const service = makeService();
  const { run } = service.createRun({ userId: user.id, workflowId: workflow.id });

  const sink = [];
  const enqueueNode = makeEnqueuer(user.id, sink);
  await service.advanceRunOnce({ runId: run.id, userId: user.id, enqueueNode });
  await service.advanceRunOnce({ runId: run.id, userId: user.id, enqueueNode });
  const p1 = workflowRunRepository.getWorkflowRunNode(run.id, 'p1');
  updateTask(p1.taskId, { status: 'failed', error: { message: 'boom' } });
  service.syncNodeOutcomes({ runId: run.id, readTaskOutcome });
  await service.advanceRunOnce({ runId: run.id, userId: user.id, enqueueNode });

  const retryResult = service.retryFailedNodes({ runId: run.id, userId: user.id });
  assert.deepEqual([...retryResult.resetNodeIds].sort(), ['i1', 'o1', 'p1']);
  sink.length = 0;

  // 重跑 p1 并让它成功，再逐段推进到结束
  await service.advanceRunOnce({ runId: run.id, userId: user.id, enqueueNode });
  assert.deepEqual(
    sink.map((item) => item.nodeId),
    ['p1'],
    't1 已成功，不应重新入队；只有失败的 p1 需要重跑'
  );
  // 首次入队 1 次 + 重跑再入队 1 次 = 2 次尝试
  assert.equal(workflowRunRepository.getWorkflowRunNode(run.id, 'p1').attempt, 2);

  for (let round = 0; round < 6; round += 1) {
    for (const item of sink) {
      updateTask(item.taskId, {
        status: 'succeeded',
        output: { image: { id: 'asset-retry', type: 'image', url: '/api/assets/asset-retry' } },
      });
    }
    sink.length = 0;
    service.syncNodeOutcomes({ runId: run.id, readTaskOutcome });
    await service.advanceRunOnce({ runId: run.id, userId: user.id, enqueueNode });
    if (service.isTerminalRunStatus(workflowRunRepository.getWorkflowRun(run.id).status)) break;
  }

  const finished = workflowRunRepository.getWorkflowRun(run.id);
  assert.equal(finished.status, 'succeeded', '重跑后整条运行应当能跑完');
  assert.equal(finished.finishedNodes, 4);
  // 已成功的本地节点没有被重跑，尝试次数保持 0
  assert.equal(workflowRunRepository.getWorkflowRunNode(run.id, 't1').attempt, 0);
});

test('重跑拒绝：成功的运行没有可重试的内容，进行中的运行要先取消', async () => {
  const user = nextUser('wfrun-retry-guard');
  const workflow = saveWorkflow(user.id, [node('solo', 'preview')], []);
  const service = makeService();
  const { run } = service.createRun({ userId: user.id, workflowId: workflow.id });

  assert.throws(
    () => service.retryFailedNodes({ runId: run.id, userId: user.id }),
    /still in progress/i,
    '进行中的运行应拒绝重跑'
  );

  await service.advanceRunOnce({ runId: run.id, userId: user.id });
  await service.advanceRunOnce({ runId: run.id, userId: user.id });
  assert.equal(workflowRunRepository.getWorkflowRun(run.id).status, 'succeeded');

  assert.throws(
    () => service.retryFailedNodes({ runId: run.id, userId: user.id }),
    /already succeeded/i
  );
});

test('重跑不能跨用户操作', async () => {
  const owner = nextUser('wfrun-retry-owner');
  const other = nextUser('wfrun-retry-other');
  const workflow = saveWorkflow(owner.id, PIPELINE.nodes, PIPELINE.edges);
  const service = makeService();
  const { run } = service.createRun({ userId: owner.id, workflowId: workflow.id });

  assert.throws(() => service.retryFailedNodes({ runId: run.id, userId: other.id }), /not found/i);
});

test('推进已终态的运行不会改变任何节点', async () => {
  const user = nextUser('wfrun-terminal');
  const workflow = saveWorkflow(user.id, [node('solo', 'preview')], []);
  const service = makeService();
  const { run } = service.createRun({ userId: user.id, workflowId: workflow.id });
  await service.advanceRunOnce({ runId: run.id, userId: user.id });
  await service.advanceRunOnce({ runId: run.id, userId: user.id });

  const before = workflowRunRepository.listWorkflowRunNodes(run.id);
  const result = await service.advanceRunOnce({ runId: run.id, userId: user.id });
  const after = workflowRunRepository.listWorkflowRunNodes(run.id);

  assert.equal(result.finished, true);
  assert.deepEqual(after.map((item) => item.status), before.map((item) => item.status));
});
