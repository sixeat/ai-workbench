// 回归测试：视频轮询必须带上 userId，且失败状态要可见。
//
// 真实踩过的坑：worker 调用 advanceVideoTask 时只传了 taskId，
// 查询因此定位不到任务属主 → 拿不到 API Key → 静默返回 400 而不抛异常。
// 表现是"轮询在跑、状态永远不动、日志干净"，极难排查。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-video-poll-args-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 't.sqlite');

const { createTask, createUser, db } = require('./db.cjs');
const { createTaskRepository } = require('./repositories/taskRepository.cjs');
const { workflowRepository } = require('./repositories/workflowRepository.cjs');
const { workflowRunRepository } = require('./repositories/workflowRunRepository.cjs');
const { createWorkflowRunService } = require('./services/workflowRunService.cjs');
const { createWorkflowRunWorker } = require('./workers/workflowRunWorker.cjs');

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

let setupSeq = 0;

function setup() {
  // 邮箱必须唯一：两个测试共用同一个数据库，固定邮箱会撞唯一约束
  setupSeq += 1;
  const email = `video-poll-${setupSeq}@example.com`;
  const user = createUser({
    email,
    username: email,
    name: 'Video Poll',
    passwordHash: 'test',
  });
  const workflow = workflowRepository.upsertWorkflow({
    userId: user.id,
    name: 'video-poll',
    description: '',
    nodes: [
      { id: 't1', type: 'textInput', position: { x: 0, y: 0 }, data: { label: 't', type: 'textInput', config: { content: '猫' } } },
      { id: 'v1', type: 'videoGen', position: { x: 100, y: 0 }, data: { label: 'v', type: 'videoGen', config: { model: 'wan2.7-t2v' } } },
    ],
    edges: [{ id: 'e1', source: 't1', target: 'v1', data: { targetKey: 'prompt' } }],
  });
  const service = createWorkflowRunService({ workflowRepository });
  const run = service.createRun({ userId: user.id, workflowId: workflow.id }).run;
  return { run, service, user };
}

test('视频轮询必须带上 userId，否则查询定位不到任务', async () => {
  const { service, user } = setup();
  const taskRepository = createTaskRepository();
  const seen = [];
  let taskSeq = 0;

  const worker = createWorkflowRunWorker({
    autoStart: false,
    enabled: true,
    pollIntervalMs: 0,
    taskRepository,
    workflowRunRepository,
    workflowRunService: service,
    enqueueTask: async ({ node }) => {
      taskSeq += 1;
      const taskId = `vtask-${taskSeq}`;
      createTask({
        id: taskId,
        userId: user.id,
        nodeType: 'video',
        model: 'wan2.7-t2v',
        providerId: 'aliyun-bailian',
        status: 'queued',
        input: {},
      });
      seen.push({ nodeId: node.id, taskId });
      return { taskId };
    },
    advanceVideoTask: async (input) => {
      // 关键断言：userId 必须传进来
      assert.ok(input.userId, `轮询必须传 userId，实际收到: ${JSON.stringify(input)}`);
      assert.equal(input.userId, user.id);
      assert.ok(input.taskId, '轮询必须传 taskId');
      return { status: 200, data: {} };
    },
    logger: { error: () => {} },
  });

  await worker.tick(); // t1 产出、v1 入队
  const result = await worker.tick(); // 轮询 v1

  assert.equal(result.polled, 1, '应当轮询一次视频任务');
  assert.equal(seen.length, 1);
});

test('轮询返回错误状态时会记录日志，不再静默', async () => {
  const { run, service, user } = setup();
  const taskRepository = createTaskRepository();
  const errors = [];
  let taskSeq = 0;

  const worker = createWorkflowRunWorker({
    autoStart: false,
    enabled: true,
    pollIntervalMs: 0,
    taskRepository,
    workflowRunRepository,
    workflowRunService: service,
    enqueueTask: async () => {
      taskSeq += 1;
      const taskId = `vtask-err-${taskSeq}`;
      createTask({
        id: taskId,
        userId: user.id,
        nodeType: 'video',
        model: 'wan2.7-t2v',
        providerId: 'aliyun-bailian',
        status: 'queued',
        input: {},
      });
      return { taskId };
    },
    // 模拟"定位不到任务"时的返回：状态码 400，但不抛异常
    advanceVideoTask: async () => ({ status: 400, data: { error: 'API key is required' } }),
    logger: { error: (event, data) => errors.push({ data, event }) },
  });

  await worker.tick();
  await worker.tick();

  // worker 是全局扫描的：它也会处理前面测试留下的活跃运行，
  // 所以要在日志里找属于本次运行的那一条。
  const failure = errors.find(
    (item) => item.event === 'workflow video poll returned an error' && item.data.runId === run.id
  );
  assert.ok(
    failure,
    `应当记录本次运行的轮询失败日志，实际收到: ${JSON.stringify(errors.map((e) => [e.event, e.data.runId]))}`
  );
  assert.equal(failure.data.status, 400);
  assert.equal(failure.data.message, 'API key is required');
});
