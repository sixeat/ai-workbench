// API 契约一致性检查（本文件是契约的**真源之一**）。
//
// 目的：本文件里的 ENDPOINT_CONTRACT / ELEMENT_CONTRACT / UNDECLARED_FIELD_CONTRACT
// 三张表，声明了各端点「必须返回哪些字段、什么类型」。
// 它真实启动一次后端、逐个端点取响应、做「键名 + 类型」核对——
// 后端一旦改了字段名或类型，这里会立刻失败。
//
// 双向核对：
//   · 正向：表里声明为必需的字段，响应里必须存在且类型相符
//   · 反向：白名单里的端点，不允许出现表外的顶层字段（漂移的早期信号）
//
// 消费方是前端 `../frontend/src/lib/api.js`（以及对契约的所有读者）。
// 后端改返回、或前端新增对某字段的依赖时，同步更新本文件的表。
//
// 结构沿用 appSplitDeployment.test.cjs：环境变量必须在 require 之前设置（db.cjs 是单例）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-contract-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'contract.sqlite');
process.env.IMAGE_OUTPUT_DIR = path.join(tempDir, 'outputs');
process.env.WORKBENCH_DEPLOYMENT_MODE = 'local';
process.env.WORKBENCH_REQUIRE_LOGIN = 'false';
process.env.WORKBENCH_ALLOW_PUBLIC_SERVER = 'true';
process.env.WORKBENCH_SERVE_STATIC = 'false';
process.env.WORKBENCH_START_WORKERS = 'false';

const { createWorkbenchApp } = require('./app.cjs');
const { db } = require('./db.cjs');

// 先关库再删目录：SQLite 句柄不释放则 Windows 删不掉。
// 不加这个钩子会每跑一次留一个临时目录（曾累积 52 个）。
test.after(() => {
  try { db.close(); } catch { /* 已关闭 */ }
  fs.rmSync(tempDir, { force: true, recursive: true });
});

const J = (...kinds) => ({ kinds });

// 与契约表对应的必需字段。
// 「必需」= 前端确实依赖的字段。带 ? 的可选字段不在此校验。
const ENDPOINT_CONTRACT = {
  'GET /api/health': {
    status: J('string'),
    time: J('string'),
    deploymentMode: J('string'),
    serveStatic: J('boolean'),
  },
  'GET /api/admin/health': {
    status: J('string'),
    time: J('string'),
    deploymentMode: J('string'),
    host: J('string'),
    serveStatic: J('boolean'),
    outputDir: J('string'),
    dbPath: J('string'),
    defaultUserId: J('string'),
    assets: J('number'),
    tasks: J('number'),
    users: J('number'),
    enabledUsers: J('number'),
  },
  'GET /api/auth/me': {
    authenticated: J('boolean'),
    user: J('object', 'null'),
    deploymentMode: J('string'),
    requireLogin: J('boolean'),
  },
  'GET /api/tasks': { tasks: J('array'), count: J('number') },
  'GET /api/assets': { assets: J('array'), count: J('number') },
  'GET /api/workflows': { workflows: J('array'), count: J('number') },
  'GET /api/providers': { providers: J('array') },
  'GET /api/model-capability-presets': { presets: J('array') },
  'GET /api/credits/me': { account: J('object') },
  // 注意：这个端点返回 {transactions, total}，**没有** count —— 对应 ProxyCreditTransactionListOptions 的用法
  'GET /api/credits/transactions': { transactions: J('array'), total: J('number') },
  // 注意：字段名是 models，不是 platformModels（后者是 /api/model-catalog 的字段）
  'GET /api/platform-models': { models: J('array'), count: J('number') },
  'GET /api/asset-collections': { collections: J('array'), count: J('number') },
  // /api/model-catalog 才是同时提供 personalModels + platformModels 的端点
  'GET /api/model-catalog': {
    personalModels: J('array'),
    platformModels: J('array'),
    count: J('number'),
  },
};

// 集合端点里元素的必需字段。
const ELEMENT_CONTRACT = {
  'GET /api/tasks': {
    field: 'tasks',
    typeName: 'ProxyTask',
    expected: {
      id: J('string'),
      kind: J('string'),
      status: J('string'),
      createdAt: J('string'),
      updatedAt: J('string'),
    },
  },
  'GET /api/assets': {
    field: 'assets',
    typeName: 'ProxyAsset',
    expected: {
      id: J('string'),
      type: J('string'),
      url: J('string'),
      createdAt: J('string'),
    },
  },
  'GET /api/workflows': {
    field: 'workflows',
    typeName: 'ProxyWorkflowProject',
    expected: {
      id: J('string'),
      name: J('string'),
      nodes: J('array'),
      edges: J('array'),
      nodeCount: J('number'),
      createdAt: J('string'),
      updatedAt: J('string'),
    },
  },
  'GET /api/credits/transactions': {
    field: 'transactions',
    typeName: 'ProxyCreditTransaction',
    expected: {
      id: J('string'),
      userId: J('string'),
      type: J('string'),
      amount: J('number'),
      balanceAfter: J('number'),
      createdAt: J('string'),
    },
  },
};

// 需要管理员身份的端点，用 WORKBENCH_ADMIN_TOKEN 通过请求头授权。
const ADMIN_ROUTES = new Set(['GET /api/admin/health']);
const CONTRACT_ADMIN_TOKEN = 'contract-check-admin-token';

// 反向检查用的白名单：这些端点只允许出现这里列出的顶层字段。
const UNDECLARED_FIELD_CONTRACT = {
  'GET /api/model-catalog': ['personalModels', 'platformModels', 'count'],
  'GET /api/credits/me': ['account'],
  'GET /api/providers': ['providers', 'count'],
  'GET /api/tasks': ['tasks', 'count', 'total', 'limit', 'offset'],
  'GET /api/assets': ['assets', 'count', 'total', 'limit', 'offset'],
};

function kindOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function checkShape(actual, expected, label, problems) {
  for (const [key, spec] of Object.entries(expected)) {
    if (!(key in actual)) {
      problems.push(`${label}: 缺少必需字段 \`${key}\``);
      continue;
    }
    const kind = kindOf(actual[key]);
    if (!spec.kinds.includes(kind)) {
      problems.push(`${label}: 字段 \`${key}\` 类型为 ${kind}，契约声明为 ${spec.kinds.join('|')}`);
    }
  }
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
    server.on('error', reject);
  });
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

test('API 响应形状与契约表一致', async () => {
  const runtime = createWorkbenchApp({
    env: {
      ...process.env,
      PROXY_HOST: '127.0.0.1',
      WORKBENCH_REQUIRE_LOGIN: 'false',
      WORKBENCH_ALLOW_PUBLIC_SERVER: 'true',
      WORKBENCH_START_WORKERS: 'false',
      WORKBENCH_SERVE_STATIC: 'false',
      WORKBENCH_ADMIN_TOKEN: CONTRACT_ADMIN_TOKEN,
    },
    startWorkers: false,
  });
  const { server, baseUrl } = await listen(runtime.app);
  const problems = [];

  try {
    for (const [route, expected] of Object.entries(ENDPOINT_CONTRACT)) {
      const [method, pathname] = route.split(' ');
      const headers = ADMIN_ROUTES.has(route)
        ? { 'x-workbench-admin-token': CONTRACT_ADMIN_TOKEN }
        : {};
      const response = await fetch(`${baseUrl}${pathname}`, { method, headers });
      assert.equal(response.status, 200, `${route} 期望 200，实际 ${response.status}`);

      const body = await response.json();
      assert.equal(kindOf(body), 'object', `${route} 响应不是对象`);
      checkShape(body, expected, route, problems);

      const element = ELEMENT_CONTRACT[route];
      if (element) {
        const items = body[element.field];
        if (Array.isArray(items) && items.length > 0) {
          checkShape(items[0], element.expected, `${route} → ${element.typeName}[0]`, problems);
        }
      }
    }

    // 反向检查：后端返回、但 TS 接口未声明的字段。
    // 这类字段不会让页面崩溃，但意味着前端「看不到已经存在的数据」——
    // 是文档漂移的早期信号。只对下面列出的端点做严格核对。
    for (const [route, declared] of Object.entries(UNDECLARED_FIELD_CONTRACT)) {
      const [, pathname] = route.split(' ');
      const response = await fetch(`${baseUrl}${pathname}`);
      const body = await response.json();
      const extra = Object.keys(body).filter((key) => !declared.includes(key));
      if (extra.length > 0) {
        problems.push(
          `${route}: 后端返回了 TS 接口未声明的顶层字段 ${extra.map((k) => `\`${k}\``).join(', ')}`
        );
      }
    }

    assert.deepEqual(
      problems,
      [],
      `发现 ${problems.length} 处契约不一致：\n  - ${problems.join('\n  - ')}\n\n` +
      '处理方式：要么改后端返回，要么同步更新本文件的契约表（以及前端 api.js 的消费代码）。'
    );
  } finally {
    await closeServer(server);
    await runtime.stop();
  }
});

// 写端点契约：工作流运行全生命周期。
//
// 上面三张表只覆盖读端点。写端点过去完全没有自动检查——api-contract.md 里
// 点名的最大契约盲区，也正是前端「保存工作流 / 提交运行」链路最容易被打断的地方
// （§3.8 就曾把 POST 的响应写成 {run, nodes}，实际是 {created, run}）。
// 契约细节见 docs/workflow-run-api.md。
//
// startWorkers:false 时不启动运行推进 worker，所以运行会停在 queued、节点停在
// pending，状态是确定的，不依赖时间。
const RUN_CONTRACT = {
  id: J('string'),
  workflowId: J('string'),
  workflowVersionId: J('string', 'null'),
  userId: J('string'),
  status: J('string'),
  trigger: J('string'),
  idempotencyKey: J('string', 'null'),
  graphHash: J('string'),
  definition: J('object'),
  output: J('object', 'null'),
  error: J('object', 'null'),
  creditCost: J('number'),
  creditStatus: J('string'),
  reservedCredits: J('number'),
  totalNodes: J('number'),
  finishedNodes: J('number'),
  createdAt: J('string'),
  updatedAt: J('string'),
};

const RUN_NODE_CONTRACT = {
  id: J('string'),
  runId: J('string'),
  nodeId: J('string'),
  nodeType: J('string'),
  status: J('string'),
  taskId: J('string', 'null'),
  attempt: J('number'),
  inputHash: J('string'),
  output: J('object', 'null'),
  error: J('object', 'null'),
  durationMs: J('number', 'null'),
  startedAt: J('string', 'null'),
  finishedAt: J('string', 'null'),
  createdAt: J('string'),
  updatedAt: J('string'),
};

const RUN_PLAN_CONTRACT = {
  blocked: J('array'),
  hasPendingWork: J('boolean'),
  ready: J('array'),
  runnable: J('array'),
  waiting: J('array'),
};

test('工作流运行写端点响应形状与生命周期契约一致', async () => {
  const runtime = createWorkbenchApp({
    env: {
      ...process.env,
      PROXY_HOST: '127.0.0.1',
      WORKBENCH_REQUIRE_LOGIN: 'false',
      WORKBENCH_ALLOW_PUBLIC_SERVER: 'true',
      WORKBENCH_START_WORKERS: 'false',
      WORKBENCH_SERVE_STATIC: 'false',
      WORKBENCH_ADMIN_TOKEN: CONTRACT_ADMIN_TOKEN,
      // 功能开关关着时创建会被拒绝（503），本测试要验的是成功路径的形状
      WORKBENCH_SERVER_SIDE_RUNS: 'true',
    },
    startWorkers: false,
  });
  const { server, baseUrl } = await listen(runtime.app);
  const problems = [];

  async function call(method, pathname, body) {
    const hasBody = body !== undefined;
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: hasBody ? { 'content-type': 'application/json' } : {},
      body: hasBody ? JSON.stringify(body) : undefined,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { body: payload, status: response.status };
  }

  function expectStatus(actual, expected) {
    assert.equal(actual.status, expected.status, `${expected.label} 期望 ${expected.status}，实际 ${actual.status}`);
  }

  function expectTopLevelKeys(actual, keys, label) {
    assert.deepEqual(
      Object.keys(actual.body || {}).sort(),
      [...keys].sort(),
      `${label} 的顶层字段应恰好是 ${keys.join(' + ')}，实际 ${JSON.stringify(Object.keys(actual.body || {}))}`
    );
  }

  try {
    // 1. 先建一张最小工作流：运行必须挂在已存在的工作流上。
    const createdWorkflow = await call('POST', '/api/workflows', {
      edges: [],
      name: '契约检查用工作流',
      nodes: [{
        data: { config: { content: 'hello' }, label: '文本输入', type: 'textInput' },
        id: 'contract-text',
        position: { x: 0, y: 0 },
        type: 'textInput',
      }],
    });
    expectStatus(createdWorkflow, { label: 'POST /api/workflows', status: 201 });
    expectTopLevelKeys(createdWorkflow, ['workflow'], 'POST /api/workflows');
    const workflowId = createdWorkflow.body?.workflow?.id;
    assert.equal(typeof workflowId, 'string', 'POST /api/workflows 未返回 workflow.id');

    const idempotencyKey = `contract-key-${Date.now()}`;

    // 2. 首次提交运行 → 201 + {created:true, run}
    const first = await call('POST', '/api/workflow-runs', { idempotencyKey, workflowId });
    expectStatus(first, { label: '首次 POST /api/workflow-runs', status: 201 });
    expectTopLevelKeys(first, ['created', 'run'], 'POST /api/workflow-runs');
    assert.equal(first.body.created, true, '首次提交的 created 应为 true');
    checkShape(first.body.run, RUN_CONTRACT, 'POST /api/workflow-runs → run', problems);
    const runId = first.body?.run?.id;
    assert.equal(typeof runId, 'string', 'POST /api/workflow-runs 未返回 run.id');
    assert.equal(first.body.run.status, 'queued', '新建运行的状态应为 queued');
    assert.equal(first.body.run.trigger, 'api', '本组路由提交的运行 trigger 应为 api');
    assert.equal(first.body.run.totalNodes, 1, '快照应记录 1 个节点');
    assert.equal(first.body.run.idempotencyKey, idempotencyKey, '运行应记住幂等键');

    // 3. 同键重复提交 → 200 + created:false，且是同一个运行
    const second = await call('POST', '/api/workflow-runs', { idempotencyKey, workflowId });
    expectStatus(second, { label: '幂等重复 POST /api/workflow-runs', status: 200 });
    expectTopLevelKeys(second, ['created', 'run'], '幂等重复 POST /api/workflow-runs');
    assert.equal(second.body.created, false, '幂等命中的 created 应为 false');
    assert.equal(second.body.run.id, runId, '幂等命中应返回同一个运行，而不是新建');

    // 4. 详情 → {run, nodes}
    const detail = await call('GET', `/api/workflow-runs/${runId}`);
    expectStatus(detail, { label: 'GET /api/workflow-runs/:runId', status: 200 });
    expectTopLevelKeys(detail, ['nodes', 'run'], 'GET /api/workflow-runs/:runId');
    checkShape(detail.body.run, RUN_CONTRACT, 'GET 运行详情 → run', problems);
    assert.equal(Array.isArray(detail.body.nodes) && detail.body.nodes.length, 1, '详情应带 1 个运行节点');
    checkShape(detail.body.nodes[0], RUN_NODE_CONTRACT, 'GET 运行详情 → nodes[0]', problems);
    assert.equal(detail.body.nodes[0].nodeId, 'contract-text', '节点应回指工作流图里的节点 id');
    assert.equal(detail.body.nodes[0].status, 'pending', '未推进的运行节点应停在 pending');
    assert.equal(detail.body.nodes[0].attempt, 0, '从未入队的节点 attempt 应为 0');

    // 5. 计划 → {plan, runId, status}，plan 里装节点 id 字符串
    const plan = await call('GET', `/api/workflow-runs/${runId}/plan`);
    expectStatus(plan, { label: 'GET /api/workflow-runs/:runId/plan', status: 200 });
    expectTopLevelKeys(plan, ['plan', 'runId', 'status'], 'GET /api/workflow-runs/:runId/plan');
    checkShape(plan.body.plan, RUN_PLAN_CONTRACT, '运行计划 → plan', problems);
    assert.ok(
      plan.body.plan.runnable.includes('contract-text'),
      'textInput 是本地节点，应出现在 plan.runnable 里'
    );

    // 6. 列表 → {runs, count, total, limit, offset}
    const list = await call('GET', '/api/workflow-runs?limit=10');
    expectStatus(list, { label: 'GET /api/workflow-runs', status: 200 });
    expectTopLevelKeys(list, ['runs', 'count', 'total', 'limit', 'offset'], 'GET /api/workflow-runs');
    assert.equal(list.body.count, list.body.runs.length, 'count 应是本页条数');
    assert.ok(list.body.total >= 1, 'total 应是匹配总数');

    // 7. 运行还在进行中时重试 → 409（本组接口唯一的 409）
    const retryWhileRunning = await call('POST', `/api/workflow-runs/${runId}/retry`);
    expectStatus(retryWhileRunning, { label: '进行中 retry', status: 409 });
    expectTopLevelKeys(retryWhileRunning, ['error'], '进行中 retry');
    assert.match(String(retryWhileRunning.body.error), /still in progress/i, '409 应说明原因');

    // 8. 取消 → {nodes, run}，运行与未终态节点都变 cancelled
    const cancelled = await call('POST', `/api/workflow-runs/${runId}/cancel`);
    expectStatus(cancelled, { label: 'POST /api/workflow-runs/:runId/cancel', status: 200 });
    expectTopLevelKeys(cancelled, ['nodes', 'run'], 'POST /api/workflow-runs/:runId/cancel');
    checkShape(cancelled.body.run, RUN_CONTRACT, '取消 → run', problems);
    assert.equal(cancelled.body.run.status, 'cancelled', '取消后运行应为 cancelled');
    assert.ok(
      cancelled.body.nodes.every((node) => node.status === 'cancelled'),
      '取消后未终态节点应全部变 cancelled'
    );

    // 9. 对已终态的运行再次取消 → 幂等，仍是 200 且状态不变
    const cancelledAgain = await call('POST', `/api/workflow-runs/${runId}/cancel`);
    expectStatus(cancelledAgain, { label: '重复 cancel', status: 200 });
    assert.equal(cancelledAgain.body.run.status, 'cancelled', '重复取消不应改变状态');

    // 10. 取消后重试 → {nodes, resetNodeIds, run}，节点重置为 pending
    const retried = await call('POST', `/api/workflow-runs/${runId}/retry`);
    expectStatus(retried, { label: 'POST /api/workflow-runs/:runId/retry', status: 200 });
    expectTopLevelKeys(retried, ['nodes', 'resetNodeIds', 'run'], 'POST /api/workflow-runs/:runId/retry');
    checkShape(retried.body.run, RUN_CONTRACT, 'retry → run', problems);
    assert.equal(retried.body.run.status, 'queued', '重试后运行应回到 queued');
    assert.deepEqual(retried.body.resetNodeIds, ['contract-text'], 'resetNodeIds 应列出被重置的节点');
    assert.ok(
      retried.body.nodes.every((node) => node.status === 'pending'),
      '重试后失败/取消的节点应重置为 pending'
    );

    // 11. 错误响应形状：单字段 error，且不泄露不存在的运行
    const missing = await call('GET', '/api/workflow-runs/does-not-exist');
    expectStatus(missing, { label: 'GET 不存在的运行', status: 404 });
    expectTopLevelKeys(missing, ['error'], 'GET 不存在的运行');
    assert.equal(typeof missing.body.error, 'string', '错误响应的 error 应是字符串');

    const missingWorkflowId = await call('POST', '/api/workflow-runs', {});
    expectStatus(missingWorkflowId, { label: '缺 workflowId 的提交', status: 400 });
    expectTopLevelKeys(missingWorkflowId, ['error'], '缺 workflowId 的提交');
    assert.equal(missingWorkflowId.body.error, 'workflowId is required.', '400 应回具体原因');

    assert.deepEqual(
      problems,
      [],
      `写端点契约不一致：\n  - ${problems.join('\n  - ')}\n\n` +
      '处理方式：要么改后端返回，要么同步更新本文件的契约表与 docs/workflow-run-api.md。'
    );
  } finally {
    await closeServer(server);
    await runtime.stop();
  }
});
