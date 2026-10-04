// 服务端工作流运行的最小闭环测试（真实装配 + 真实 HTTP + 真实 worker）。
//
// 为什么要单独一个文件：现有测试都没覆盖这条路径——
//   · workflowRunService.test.cjs   只测服务层
//   · workflowRunWorker.test.cjs    只测 worker 本体，且注入假的 enqueueTask
//   · apiContract.test.cjs          故意不启动 worker（状态才确定）
// 而「app.cjs 按环境变量装配 worker，前端走 HTTP 提交，运行自己跑完」这条真实
// 路径上正好有一个静默陷阱：路由是无条件注册的，worker 却要
// WORKBENCH_SERVER_SIDE_RUNS=true 才启动。装配一旦错，POST 照常 201，
// 运行永远停在 queued，没有任何报错。
//
// 本测试只用本地节点（textInput / preview），不产生任何上游调用，闭环确定、不花钱。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// 环境变量必须在 require app.cjs 之前设置（db.cjs 是单例）。
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-wfrun-loop-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'loop.sqlite');
process.env.IMAGE_OUTPUT_DIR = path.join(tempDir, 'outputs');
process.env.WORKBENCH_DEPLOYMENT_MODE = 'local';
process.env.WORKBENCH_REQUIRE_LOGIN = 'false';
process.env.WORKBENCH_ALLOW_PUBLIC_SERVER = 'true';
process.env.WORKBENCH_SERVE_STATIC = 'false';
process.env.WORKBENCH_START_WORKERS = 'true';
process.env.WORKBENCH_SERVER_SIDE_RUNS = 'true';
// 默认 2 秒一轮，测试里缩短，避免等太久
process.env.WORKBENCH_WORKFLOW_RUN_POLL_INTERVAL_MS = '25';

const { createWorkbenchApp } = require('./app.cjs');
const { db } = require('./db.cjs');

test.after(() => {
  try {
    db.close();
  } catch {
    /* 已关闭 */
  }
  fs.rmSync(tempDir, { force: true, recursive: true });
});

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ baseUrl: `http://127.0.0.1:${server.address().port}`, server });
    });
    server.on('error', reject);
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function call(baseUrl, method, pathname, body) {
  const hasBody = body !== undefined;
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: hasBody ? { 'content-type': 'application/json' } : {},
    method,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  return { body: await response.json(), status: response.status };
}

/** 轮询运行直到终态；超时直接失败，避免测试永久挂住。 */
async function waitForTerminalRun(baseUrl, runId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const detail = await call(baseUrl, 'GET', `/api/workflow-runs/${runId}`);
    assert.equal(detail.status, 200, `查询运行详情失败：${detail.status}`);
    last = detail.body;
    if (['succeeded', 'failed', 'cancelled'].includes(last.run.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(
    `运行未在 ${timeoutMs}ms 内进入终态，最后状态 ${JSON.stringify({
      nodes: last?.nodes?.map((node) => `${node.nodeId}:${node.status}`),
      run: last?.run?.status,
    })}——如果一直是 queued/pending，先确认 worker 真的启动了（见 app.cjs 的 enabled/autoStart）`
  );
}

test('最小闭环：提交运行后由 worker 自行推进到 succeeded，产物回流', async () => {
  const runtime = createWorkbenchApp({ env: { ...process.env }, startWorkers: true });
  const { server, baseUrl } = await listen(runtime.app);

  try {
    // 装配必须如实反映开关，否则下面的闭环会静默失败
    assert.equal(runtime.config.enableWorkflowRuns, true, 'config 应如实反映工作流运行开关');

    const workflow = await call(baseUrl, 'POST', '/api/workflows', {
      edges: [{ data: { targetKey: 'content' }, id: 'e1', source: 't1', target: 'p1' }],
      name: '闭环检查',
      nodes: [
        { data: { config: { content: '一只橘猫' }, label: '文本', type: 'textInput' }, id: 't1', position: { x: 0, y: 0 }, type: 'textInput' },
        { data: { config: {}, label: '预览', type: 'preview' }, id: 'p1', position: { x: 0, y: 0 }, type: 'preview' },
      ],
    });
    assert.equal(workflow.status, 201, `创建工作流失败：${JSON.stringify(workflow.body)}`);
    const workflowId = workflow.body.workflow.id;

    const submitted = await call(baseUrl, 'POST', '/api/workflow-runs', {
      idempotencyKey: 'loop-1',
      workflowId,
    });
    assert.equal(submitted.status, 201, `提交运行失败：${JSON.stringify(submitted.body)}`);
    const runId = submitted.body.run.id;

    const detail = await waitForTerminalRun(baseUrl, runId);

    // 整次运行成功
    assert.equal(detail.run.status, 'succeeded', `运行状态：${JSON.stringify(detail.run.error)}`);
    assert.equal(detail.run.error, null, '成功的运行不应带 error');
    assert.equal(detail.run.totalNodes, 2);
    assert.equal(detail.run.finishedNodes, 2, '两个本地节点都应计入 finishedNodes');
    assert.deepEqual(detail.run.output, { assets: [] }, '没有生成型节点时产物资产为空数组');

    // 每个节点都真的产出了
    const byId = new Map(detail.nodes.map((node) => [node.nodeId, node]));
    assert.deepEqual([...byId.keys()].sort(), ['p1', 't1']);
    for (const node of detail.nodes) {
      assert.equal(node.status, 'succeeded', `节点 ${node.nodeId} 状态应为 succeeded`);
      assert.ok(node.output != null, `节点 ${node.nodeId} 应有产物`);
    }
    // 本地节点产物形状与前端单跑一致（见 workflowRunService.localNodeOutput）
    assert.equal(byId.get('t1').output.value.text, '一只橘猫');
    assert.equal(byId.get('p1').output.displayed, true);
    // 本地节点不去上游，不应产生任何任务
    assert.equal(byId.get('t1').taskId, null);
    assert.equal(byId.get('p1').taskId, null);
  } finally {
    await closeServer(server);
    await runtime.stop();
  }
});

test('功能开关关着时拒绝创建（503），而不是返回 201 后静默卡死', async () => {
  const runtime = createWorkbenchApp({
    env: { ...process.env, WORKBENCH_SERVER_SIDE_RUNS: 'false' },
    startWorkers: true,
  });
  const { server, baseUrl } = await listen(runtime.app);

  try {
    assert.equal(runtime.config.enableWorkflowRuns, false);

    // 开关检查必须发生在查库之前：workflowId 是个不存在的值，
    // 期望 503 而不是 404——否则就说明护栏被放到了业务流程后面。
    const rejected = await call(baseUrl, 'POST', '/api/workflow-runs', {
      idempotencyKey: 'disabled-1',
      workflowId: 'no-such-workflow',
    });
    assert.equal(
      rejected.status,
      503,
      `功能关闭时应拒绝创建，实际 ${rejected.status} ${JSON.stringify(rejected.body)}`
    );
    assert.match(
      String(rejected.body.error),
      /WORKBENCH_SERVER_SIDE_RUNS=true/,
      '拒绝文案必须直接给出打开方式，否则运维还是要翻源码'
    );
  } finally {
    await closeServer(server);
    await runtime.stop();
  }
});
