// 工作流运行 worker 的回归测试。
//
// 用真实数据库 + 真实编排服务，只把"真正入队"换成假的 enqueueTask，
// 这样能验证推进、产物回流、恢复、去重的完整链路。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-wfrun-worker-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const { createTask, createUser, db, updateTask } = require('./db.cjs');
const { createTaskRepository } = require('./repositories/taskRepository.cjs');
const { workflowRepository } = require('./repositories/workflowRepository.cjs');
const { workflowRunRepository } = require('./repositories/workflowRunRepository.cjs');
const { createWorkflowRunService } = require('./services/workflowRunService.cjs');
const { createWorkflowRunWorker } = require('./workers/workflowRunWorker.cjs');

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const taskRepository = createTaskRepository();
const workflowRunService = createWorkflowRunService({ workflowRepository });

let seq = 0;
function nextUser(label) {
  seq += 1;
  const email = `${label}-${seq}@example.com`;
  return createUser({ email, username: email, name: label, passwordHash: 'test' });
}

function node(id, type, config = {}) {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, type, config } };
}

function edge(source, target, targetKey = '') {
  return { id: `${source}->${target}`, source, target, data: { targetKey } };
}

const PIPELINE_NODES = [
  node('t1', 'textInput', { content: '一只橘猫在阳光下打盹' }),
  node('s1', 'styleParam', { style: 'cinematic' }),
  node('i1', 'imageGen', { model: 'gpt-image-1', instanceId: 'inst-1' }),
  node('o1', 'preview'),
];
const PIPELINE_EDGES = [
  edge('t1', 'i1', 'prompt'),
  edge('s1', 'i1', 'style'),
  edge('i1', 'o1', 'content'),
];

/** 建任务并入队；返回的 taskId 立刻落库，模拟真实入队顺序。 */
function makeEnqueueTask(userId, sink = []) {
  return async ({ body, kind, node: workflowNode }) => {
    const taskId = `task-${workflowNode.id}-${seq}-${sink.length}`;
    createTask({
      id: taskId,
      userId,
      nodeType: kind,
      model: body.model || 'test-model',
      providerId: body.providerId || 'test',
      status: 'queued',
      input: body,
    });
    sink.push({ body, kind, nodeId: workflowNode.id, taskId });
    return { taskId };
  };
}

function makeWorker(userId, sink = [], overrides = {}) {
  return createWorkflowRunWorker({
    autoStart: false,
    enabled: true,
    pollIntervalMs: 0,
    taskRepository,
    workflowRunRepository,
    workflowRunService,
    enqueueTask: makeEnqueueTask(userId, sink),
    logger: { error: () => {} },
    ...overrides,
  });
}

function createRun(userId, workflowId, extra = {}) {
  return workflowRunService.createRun({ userId, workflowId, ...extra }).run;
}

test('一轮 tick 推进流水线：本地节点产出、生成节点入队、任务落库', async () => {
  const user = nextUser('wfworker-basic');
  const workflow = workflowRepository.upsertWorkflow({
    userId: user.id,
    name: 'wf',
    description: '',
    nodes: PIPELINE_NODES,
    edges: PIPELINE_EDGES,
  });
  const run = createRun(user.id, workflow.id);
  const sink = [];
  const worker = makeWorker(user.id, sink);

  // 第一轮：本地节点产出，同时 i1 的两个上游就绪后入队
  await worker.tick();

  const nodes = Object.fromEntries(
    workflowRunRepository.listWorkflowRunNodes(run.id).map((item) => [item.nodeId, item])
  );
  assert.equal(nodes.t1.status, 'succeeded');
  assert.equal(nodes.t1.output.text, '一只橘猫在阳光下打盹');
  assert.equal(nodes.s1.status, 'succeeded');
  assert.equal(nodes.s1.output.style.value, 'cinematic');
  assert.equal(nodes.i1.status, 'queued', 'i1 应在本地节点产出后同轮入队');
  assert.ok(nodes.i1.taskId, '入队后节点应链接到任务');

  assert.equal(sink.length, 1);
  assert.equal(sink[0].kind, 'image');
  assert.equal(sink[0].nodeId, 'i1');
  // 上游文本落到 prompt，参数落到 style
  assert.equal(sink[0].body.prompt, '一只橘猫在阳光下打盹');
  assert.equal(sink[0].body.style, 'cinematic');
  assert.equal(sink[0].body.model, 'gpt-image-1');
});

test('任务完成后产物回流，下游继续推进直到运行成功并集齐成片', async () => {
  const user = nextUser('wfworker-e2e');
  const workflow = workflowRepository.upsertWorkflow({
    userId: user.id,
    name: 'wf',
    description: '',
    nodes: PIPELINE_NODES,
    edges: PIPELINE_EDGES,
  });
  const run = createRun(user.id, workflow.id);
  const sink = [];
  const worker = makeWorker(user.id, sink);

  for (let round = 0; round < 6; round += 1) {
    await worker.tick();
    for (const item of sink) {
      updateTask(item.taskId, {
        status: 'succeeded',
        output: {
          image: { id: 'asset-9', type: 'image', url: '/api/assets/asset-9' },
          images: [{ id: 'asset-9', type: 'image', url: '/api/assets/asset-9' }],
        },
      });
    }
    sink.length = 0;
    if (workflowRunService.isTerminalRunStatus(workflowRunRepository.getWorkflowRun(run.id).status)) break;
  }

  const finished = workflowRunRepository.getWorkflowRun(run.id);
  assert.equal(finished.status, 'succeeded');
  assert.equal(finished.finishedNodes, 4);
  assert.deepEqual(finished.output.assets.map((item) => item.id), ['asset-9']);

  const preview = workflowRunRepository.getWorkflowRunNode(run.id, 'o1');
  assert.equal(preview.status, 'succeeded');
  assert.equal(preview.output.displayed, true);
});

test('节点任务失败会把整条下游取消，运行终态为 failed', async () => {
  const user = nextUser('wfworker-failure');
  const workflow = workflowRepository.upsertWorkflow({
    userId: user.id,
    name: 'wf',
    description: '',
    nodes: PIPELINE_NODES,
    edges: PIPELINE_EDGES,
  });
  const run = createRun(user.id, workflow.id);
  const sink = [];
  const worker = makeWorker(user.id, sink);

  await worker.tick();
  const imageTask = sink.find((item) => item.nodeId === 'i1');
  assert.ok(imageTask);
  updateTask(imageTask.taskId, { status: 'failed', error: { message: 'upstream rejected' } });

  await worker.tick();

  const finished = workflowRunRepository.getWorkflowRun(run.id);
  assert.equal(finished.status, 'failed');
  assert.deepEqual(finished.error.failedNodeIds, ['i1']);
  assert.equal(workflowRunRepository.getWorkflowRunNode(run.id, 'o1').status, 'cancelled');
});

test('重复 tick 不会为同一个节点重复建任务（不重复扣费）', async () => {
  const user = nextUser('wfworker-idempotent');
  const workflow = workflowRepository.upsertWorkflow({
    userId: user.id,
    name: 'wf',
    description: '',
    nodes: PIPELINE_NODES,
    edges: PIPELINE_EDGES,
  });
  const run = createRun(user.id, workflow.id);
  const sink = [];
  const worker = makeWorker(user.id, sink);

  await worker.tick();
  await worker.tick();
  await worker.tick();

  // 任务还没完成，i1 应仍然只有一个任务
  assert.equal(sink.filter((item) => item.nodeId === 'i1').length, 1);
  const i1 = workflowRunRepository.getWorkflowRunNode(run.id, 'i1');
  assert.equal(i1.status, 'queued');
  assert.equal(i1.attempt, 1, '不应因重复推进而累加尝试次数');
});

test('任务查不到结果时 worker 会收尾并让运行到达终态，而不是永久卡住', async () => {
  const user = nextUser('wfworker-recover');
  const workflow = workflowRepository.upsertWorkflow({
    userId: user.id,
    name: 'wf',
    description: '',
    nodes: PIPELINE_NODES,
    edges: PIPELINE_EDGES,
  });
  const run = createRun(user.id, workflow.id);
  const sink = [];
  const worker = makeWorker(user.id, sink);

  await worker.tick();
  const imageTask = sink.find((item) => item.nodeId === 'i1');
  assert.ok(imageTask);

  // 模拟中断后任务不可用。
  // 注意：任务行不能直接删——节点表对 tasks 有外键，数据库会拒绝，
  // 也就是说"任务凭空消失"在数据层不可能发生。真实情形是节点指向的任务查不到结果，
  // 这里用断开链接来建模它。
  db.prepare('UPDATE workflow_run_nodes SET task_id = NULL WHERE run_id = ? AND node_id = ?')
    .run(run.id, 'i1');
  assert.equal(workflowRunRepository.getWorkflowRunNode(run.id, 'i1').taskId, null);

  await worker.tick();

  const finished = workflowRunRepository.getWorkflowRun(run.id);
  assert.equal(finished.status, 'failed');
  assert.equal(workflowRunRepository.getWorkflowRunNode(run.id, 'i1').status, 'failed');
  assert.equal(workflowRunRepository.getWorkflowRunNode(run.id, 'o1').status, 'cancelled');
});

test('没有队列处理器的节点类型会让节点失败，而不是静默停在 queued', async () => {
  const user = nextUser('wfworker-unsupported');
  const workflow = workflowRepository.upsertWorkflow({
    userId: user.id,
    name: 'wf',
    description: '',
    nodes: [node('t1', 'textInput', { content: 'x' }), node('weird', 'unknownNodeType')],
    edges: [edge('t1', 'weird', 'prompt')],
  });
  const run = createRun(user.id, workflow.id);
  const worker = makeWorker(user.id, []);

  await worker.tick();

  const weird = workflowRunRepository.getWorkflowRunNode(run.id, 'weird');
  assert.equal(weird.status, 'failed');
  assert.match(weird.error.message, /no queue handler/i);
  assert.equal(workflowRunRepository.getWorkflowRun(run.id).status, 'failed');
});

test('单次 tick 扫描所有活跃运行，并把它们各自推进一次', async () => {
  const user = nextUser('wfworker-single');
  const workflow = workflowRepository.upsertWorkflow({
    userId: user.id,
    name: 'wf',
    description: '',
    nodes: PIPELINE_NODES,
    edges: PIPELINE_EDGES,
  });
  const run = createRun(user.id, workflow.id);
  const worker = makeWorker(user.id, []);

  // worker 是全局扫描的：它按活跃运行集合工作，不去区分是哪次测试建的。
  const first = await worker.tick();
  assert.ok(first.scanned >= 1, '至少应扫到本次运行');
  assert.ok(first.advanced >= 1);

  // 收尾后本次运行不再出现在活跃集合里
  workflowRunService.cancelRun({ runId: run.id, userId: user.id });
  const after = await worker.tick();
  const stillActive = workflowRunRepository
    .listActiveWorkflowRuns()
    .some((item) => item.id === run.id);
  assert.equal(stillActive, false, '取消后不应再被扫到');
  assert.equal(after.scanned, workflowRunRepository.listActiveWorkflowRuns().length);
});

test('worker 的 start/stop 可重复调用且不留下定时器', async () => {
  const user = nextUser('wfworker-lifecycle');
  const workflow = workflowRepository.upsertWorkflow({
    userId: user.id,
    name: 'wf',
    description: '',
    nodes: [node('solo', 'preview')],
    edges: [],
  });
  createRun(user.id, workflow.id);
  // 必须给正间隔：pollIntervalMs 为 0 表示"只手动 tick"，不会建定时器
  const worker = makeWorker(user.id, [], { pollIntervalMs: 60_000 });

  assert.equal(worker.getWorkflowRunWorkerStats().scheduled, false, '未启动时不应有定时器');
  assert.equal(worker.getWorkflowRunWorkerStats().stopped, false);

  worker.startWorkflowRunWorker();
  const started = worker.getWorkflowRunWorkerStats();
  assert.equal(started.scheduled, true);
  assert.equal(started.stopped, false);

  // wait:false 让测试不等在途轮次（生产关停应保持默认的等待行为）
  await worker.stopWorkflowRunWorker({ wait: false });
  const stopped = worker.getWorkflowRunWorkerStats();
  assert.equal(stopped.scheduled, false);
  assert.equal(stopped.stopped, true);

  // 重复 stop 不应抛错
  await worker.stopWorkflowRunWorker({ wait: false });
  assert.equal(worker.getWorkflowRunWorkerStats().stopped, true);

  // 再次 start 应当能重新调度，且重复 start 不会叠加定时器
  worker.startWorkflowRunWorker();
  worker.startWorkflowRunWorker();
  assert.equal(worker.getWorkflowRunWorkerStats().scheduled, true);
  await worker.stopWorkflowRunWorker({ wait: false });
  assert.equal(worker.getWorkflowRunWorkerStats().scheduled, false);
});

test('视频节点会被轮询上游，产物落定后下游才推进', async () => {
  const user = nextUser('wfworker-video');
  const workflow = workflowRepository.upsertWorkflow({
    userId: user.id,
    name: 'wf',
    description: '',
    nodes: [
      node('t1', 'textInput', { content: '一只橘猫' }),
      node('v1', 'videoGen', { model: 'wan2.7-t2v', duration: 5 }),
      node('o1', 'preview'),
    ],
    edges: [edge('t1', 'v1', 'prompt'), edge('v1', 'o1', 'content')],
  });
  const run = createRun(user.id, workflow.id);
  const sink = [];

  // 模拟上游异步任务：第一次轮询仍是进行中，第二次才成功
  let pollCount = 0;
  const polled = [];
  const worker = createWorkflowRunWorker({
    autoStart: false,
    enabled: true,
    pollIntervalMs: 0,
    taskRepository,
    workflowRunRepository,
    workflowRunService,
    enqueueTask: makeEnqueueTask(user.id, sink),
    advanceVideoTask: async ({ taskId }) => {
      pollCount += 1;
      polled.push(taskId);
      if (pollCount >= 2) {
        updateTask(taskId, {
          status: 'succeeded',
          output: { video: { id: 'asset-video', type: 'video', url: '/api/assets/asset-video' } },
        });
      }
      return { status: 200, data: {} };
    },
    logger: { error: () => {} },
  });

  // 第一轮：t1 产出、v1 入队
  await worker.tick();
  const videoNode = workflowRunRepository.getWorkflowRunNode(run.id, 'v1');
  assert.equal(videoNode.status, 'queued');
  assert.ok(videoNode.taskId, '视频节点应当已入队');

  // 第二轮：轮询上游，仍是进行中
  const second = await worker.tick();
  assert.equal(second.polled, 1, '应当轮询一次上游');
  assert.equal(workflowRunRepository.getWorkflowRunNode(run.id, 'v1').status, 'queued');

  // 第三轮：轮询后上游成功，产物回流，下游推进
  await worker.tick();
  assert.equal(workflowRunRepository.getWorkflowRunNode(run.id, 'v1').status, 'succeeded');
  assert.deepEqual(polled, [videoNode.taskId, videoNode.taskId], '两轮都应对同一个任务轮询');

  await worker.tick();
  const finished = workflowRunRepository.getWorkflowRun(run.id);
  assert.equal(finished.status, 'succeeded');
  assert.deepEqual(finished.output.assets.map((item) => item.id), ['asset-video']);
});

test('没有注入视频轮询时不会崩，视频节点保持等待', async () => {
  const user = nextUser('wfworker-video-absent');
  const workflow = workflowRepository.upsertWorkflow({
    userId: user.id,
    name: 'wf',
    description: '',
    nodes: [
      node('t1', 'textInput', { content: 'x' }),
      node('v1', 'videoGen', { model: 'wan2.7-t2v' }),
    ],
    edges: [edge('t1', 'v1', 'prompt')],
  });
  const run = createRun(user.id, workflow.id);
  const worker = makeWorker(user.id, []);

  await worker.tick();
  const result = await worker.tick();

  assert.equal(result.polled, 0, '未注入轮询时计为 0');
  assert.equal(workflowRunRepository.getWorkflowRunNode(run.id, 'v1').status, 'queued');
  assert.equal(workflowRunRepository.getWorkflowRun(run.id).status, 'running');
});

test('未启用时 autoStart 不会启动定时器（默认不影响现有部署）', () => {
  const worker = createWorkflowRunWorker({
    autoStart: true,
    enabled: false,
    pollIntervalMs: 0,
    taskRepository,
    workflowRunRepository,
    workflowRunService,
  });
  assert.equal(worker.getWorkflowRunWorkerStats().scheduled, false);
});
