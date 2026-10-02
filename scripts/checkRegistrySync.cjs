// 校验前端那份 node-registry.json 副本是否与后端生成物一致。
//
// 背景：前端把注册表复制到自己的 src/data/ 下当「陈设依据」。
// 后端改了节点定义或定价后，前端不会自动知道——副本一过期，
// 前端就可能显示旧价格、或引用后端已改动的字段，而且**不会有任何报错**。
//
// 用法：
//   node scripts/checkRegistrySync.cjs <前端项目路径>
//   node scripts/checkRegistrySync.cjs --print-hash
//
// 不带参数时只在设置了 WORKBENCH_FRONTEND_DIR 时才检查前端。
const { createHash } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const here = __dirname;
const root = path.resolve(here, '..');
const sourcePath = path.join(root, 'docs', 'node-registry.json');

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function main() {
  if (!existsSync(sourcePath)) {
    console.error(`找不到生成物: ${sourcePath}（先运行 npm run export:node-registry）`);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const sourceHash = sha256(sourcePath);

  if (args.includes('--print-hash')) {
    console.log(sourceHash);
    return 0;
  }

  const frontendDir = args.find((a) => !a.startsWith('--')) || process.env.WORKBENCH_FRONTEND_DIR;

  if (!frontendDir) {
    console.log('未指定前端目录，跳过副本比对。');
    console.log(`后端注册表 sha256: ${sourceHash}`);
    console.log('用法: node scripts/checkRegistrySync.cjs <前端项目路径>');
    return 0;
  }

  const copies = [
    path.join(frontendDir, 'src', 'data', 'node-registry.json'),
    path.join(frontendDir, 'src', 'data', 'nodeRegistry.json'),
  ].filter((p) => existsSync(p));

  if (copies.length === 0) {
    console.error(`在前端目录里找不到注册表副本: ${frontendDir}/src/data/`);
    return 1;
  }

  let failed = false;
  for (const copy of copies) {
    const copyHash = sha256(copy);
    const relative = path.relative(root, copy);
    if (copyHash === sourceHash) {
      console.log(`一致  ${relative}`);
      continue;
    }
    failed = true;
    console.error(`过期  ${relative}`);
    console.error(`      后端 ${sourceHash}`);
    console.error(`      前端 ${copyHash}`);
  }

  if (failed) {
    console.error('\n前端注册表副本已过期。请重新复制：');
    console.error(`  copy "${sourcePath}" "${path.join(frontendDir, 'src', 'data', 'node-registry.json')}"`);
    console.error('并在前端确认 22 个节点类型与定价显示仍然正确。');
    return 1;
  }

  console.log('前端注册表副本与后端生成物一致。');
  return 0;
}

process.exit(main());
