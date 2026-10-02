// API 契约一致性检查。
//
// 目的：`src/lib/apiProxy.ts` 里的 Proxy* 接口是前端手写的响应结构描述，后端是纯 .cjs 没有类型。
// 两边靠人工同步，一旦后端改了字段名或类型，tsc / lint / 现有测试都不会报错。
//
// 这个脚本真实启动一次后端，逐个端点取响应，和 Proxy* 接口声明的必需字段做「键名 + 类型」核对。
// 发现不一致就失败，把 dev 期就能发现的问题拦在 CI 里。
//
// 结构沿用 appSplitDeployment.test.cjs：环境变量必须在 require 之前设置（db.cjs 是单例），
// 并且不删除临时目录 —— SQLite 句柄在进程结束前不会释放。
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

const J = (...kinds) => ({ kinds });

// 与 src/lib/apiProxy.ts 的 Proxy* 接口对应的必需字段表。
// 「必需」= 接口里声明为非可选的字段；带 ? 的可选字段不在此校验。
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

// 集合端点里元素的必需字段（对应 Proxy* 元素接口）
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
// 对应 src/lib/apiProxy.ts 里各 Proxy* 接口声明的顶层键。
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

test('API 响应形状与前端 Proxy* 契约一致', async () => {
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
      '处理方式：要么改后端返回，要么同步更新 src/lib/apiProxy.ts 的 Proxy* 接口。'
    );
  } finally {
    await closeServer(server);
    await runtime.stop();
  }
});
