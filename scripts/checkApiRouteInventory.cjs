// 核对 docs/api-contract.md 的路由清单与后端实际注册的路由是否一致。
//
// 起因：该文档标题长期写「88 个路由」，实际是 94 个（其中 5 条默认不注册），
// 没人发现——因为数字是人工数的，没有东西会因为它变错而失败。
// 这个脚本把「路由清单」变成可执行的检查，改路由忘了改文档就会红。
//
// 用法：npm run check:routes
// 退出码：0 = 一致；1 = 有差异（差异逐条打印）
//
// 注意：5 条路由默认不注册，这里全部打开开关后统计，与文档清单的口径一致。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const contractDoc = path.join(root, 'docs', 'api-contract.md');

// 环境变量必须在 require app.cjs 之前设置（db.cjs 是单例）。
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-route-inventory-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'routes.sqlite');
process.env.IMAGE_OUTPUT_DIR = path.join(tempDir, 'outputs');
process.env.WORKBENCH_DEPLOYMENT_MODE = 'local';
process.env.WORKBENCH_SERVE_STATIC = 'false';
process.env.WORKBENCH_START_WORKERS = 'false';
process.env.WORKBENCH_ENABLE_SYNC_GENERATION = 'true';
process.env.WORKBENCH_ENABLE_OPEN_LOCATION = 'true';

const { createWorkbenchApp } = require('../server/app.cjs');

// 遍历 Express 路由栈，取出所有 /api 路由。
// 路由是分层挂载的（app 上挂子 router），所以要递归进去并尽量还原挂载前缀。
function collectRoutes(stack, prefix, depth, out) {
  if (!stack || depth > 6) return;
  for (const layer of stack) {
    if (layer.route) {
      const routePath = prefix + (layer.route.path === '/' ? '' : layer.route.path);
      const methods = Object.keys(layer.route.methods || {}).filter((m) => layer.route.methods[m]);
      for (const method of methods) out.push(`${method.toUpperCase()} ${routePath}`);
      continue;
    }
    const handle = layer.handle;
    if (!handle || !handle.stack) continue;

    let next = prefix;
    const source = layer.regexp && layer.regexp.source;
    if (source && /^\^\\\//.test(source)) {
      const literal = source
        .replace(/^\^/, '')
        .replace(/\\\//g, '/')
        .replace(/\(\?:\.\*\)\??\$$/, '')
        .replace(/\$$/, '');
      if (literal && !literal.includes('(') && !literal.includes('|')) next = prefix + literal;
    }
    collectRoutes(handle.stack, next, depth + 1, out);
  }
}

// 解析文档里的 Markdown 路由表格：| `GET` | `/api/xxx` | ... |
function collectDocumentedRoutes(markdown) {
  const routes = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^\|\s*`([A-Z]+)`\s*\|\s*`([^`]+)`\s*\|/.exec(line);
    if (match) routes.push(`${match[1]} ${match[2]}`);
  }
  return routes;
}

async function main() {
  const runtime = createWorkbenchApp({ startWorkers: false });
  const app = runtime.app;
  const stack = app.router ? app.router.stack : app._router.stack;

  const collected = [];
  collectRoutes(stack, '', 0, collected);
  const actual = [...new Set(collected.filter((r) => r.includes(' /api')))].sort();
  const documented = [...new Set(collectDocumentedRoutes(fs.readFileSync(contractDoc, 'utf8')))].sort();

  const missingInDoc = actual.filter((r) => !documented.includes(r));
  const missingInApp = documented.filter((r) => !actual.includes(r));

  console.log(`实际注册：${actual.length} 条（条件路由已全开）`);
  console.log(`文档清单：${documented.length} 条（${path.relative(root, contractDoc)}）`);

  if (missingInDoc.length === 0 && missingInApp.length === 0) {
    console.log('\n路由清单一致。');
    return 0;
  }

  console.log('');
  if (missingInDoc.length > 0) {
    console.log(`后端有、文档漏记（${missingInDoc.length} 条）：`);
    for (const route of missingInDoc) console.log(`  + ${route}`);
  }
  if (missingInApp.length > 0) {
    console.log(`文档有、后端没有（${missingInApp.length} 条，通常是路由被删或路径写错）：`);
    for (const route of missingInApp) console.log(`  - ${route}`);
  }
  console.log('\n处理方式：改文档清单，或改回去掉的路由——两者必须一致。');
  return 1;
}

// 先关库再删目录：SQLite 句柄不释放，Windows 下删不掉（会 EPERM）。
// 清理失败不能掩盖真实错误，所以整体 best-effort。
function cleanup() {
  try {
    require('../server/db.cjs').db.close();
  } catch {
    /* 已关闭 */
  }
  try {
    fs.rmSync(tempDir, { force: true, recursive: true, maxRetries: 3 });
  } catch {
    /* 系统临时目录，残留可接受 */
  }
}

main()
  .then((code) => {
    cleanup();
    process.exit(code);
  })
  .catch((error) => {
    console.error('路由清单核对失败：', error);
    cleanup();
    process.exit(1);
  });
