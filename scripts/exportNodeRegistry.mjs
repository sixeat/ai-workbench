// 从节点注册表生成机器可读的节点清单（docs/node-registry.json）。
//
// 用途：给重写前端的那一侧当「陈设依据」——节点类型、端口、配色、配置字段全部照搬后端，
// 不允许新增或删除，避免新前端发明出后端执行不了的节点体系。
//
// 用法：node --import tsx scripts/exportNodeRegistry.mjs
// 输出：docs/node-registry.json
//
// 注意：这是生成物。改节点定义请改 src/data/nodeRegistry.ts，然后重新生成，不要手改 JSON。
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// Windows 下动态 import 必须用 file:// URL，不能直接给盘符绝对路径。
const load = (relative) => import(pathToFileURL(path.join(root, relative)).href);

const { NODE_REGISTRY } = await load('src/data/nodeRegistry.ts');
const { NODE_CATEGORIES } = await load('src/types/nodes.ts');
// 定价来自后端 preset（CommonJS），用于让前端显示单价与预估成本。
const { listCreditPricedPresets } = await import(
  pathToFileURL(path.join(root, 'server/modelCapabilities.cjs')).href
);

// 端口类型语义与连线兼容表。来源：src/lib/connectionInference.ts 的 portTypeMatches。
// 新前端必须用这份表决定「哪两个端口能连」，否则会出现视觉上能连、执行时取不到值的静默错误。
const PORT_TYPES = {
  string: { label: '字符串', acceptsFrom: ['string', 'text', 'prompt', 'script', 'any'] },
  number: { label: '数字', acceptsFrom: ['number', 'any'] },
  text: { label: '文本', acceptsFrom: ['text', 'string', 'prompt', 'script', 'any'] },
  prompt: { label: '提示词', acceptsFrom: ['prompt', 'any'] },
  script: { label: '剧本', acceptsFrom: ['script', 'any'] },
  shotList: { label: '分镜列表', acceptsFrom: ['shotList', 'any'] },
  image: { label: '图片', acceptsFrom: ['image', 'any'] },
  video: { label: '视频', acceptsFrom: ['video', 'any'] },
  parameter: { label: '参数', acceptsFrom: ['parameter', 'any'] },
  asset: { label: '素材', acceptsFrom: ['asset', 'image', 'video', 'shotList', 'any'] },
  any: { label: '任意', acceptsFrom: ['*'] },
};

function port(p) {
  return {
    id: p.id,
    label: p.label,
    type: p.type,
    ...(p.required ? { required: true } : {}),
  };
}

function configField(f) {
  return {
    key: f.key,
    label: f.label,
    type: f.type,
    ...(f.required ? { required: true } : {}),
    ...(f.defaultValue !== undefined ? { defaultValue: f.defaultValue } : {}),
    ...(f.options ? { options: f.options.map((o) => ({ label: o.label, value: o.value })) } : {}),
    ...(f.placeholder ? { placeholder: f.placeholder } : {}),
  };
}

const nodes = NODE_REGISTRY.map((def) => ({
  type: def.type,
  label: def.label,
  category: def.category,
  icon: def.icon,
  color: def.color,
  description: def.description,
  ...(def.hidden ? { hidden: true, hiddenReason: '仅用于兼容旧工作流，新建时不应出现在节点面板' } : {}),
  inputs: def.inputs.map(port),
  outputs: def.outputs.map(port),
  ...(def.connection ? { connection: def.connection } : {}),
  configFields: def.configFields.map(configField),
}));

const registry = {
  $comment:
    '这是生成物，来源 src/data/nodeRegistry.ts。请勿手改本文件；改节点定义后重新运行 scripts/exportNodeRegistry.mjs。' +
    '新前端的节点库必须严格照此陈设：不新增类型、不删除类型、不改端口 id 与类型。',
  generatedFrom: 'src/data/nodeRegistry.ts + src/types/nodes.ts',
  version: 1,
  summary: {
    nodeTypeCount: nodes.length,
    visibleNodeTypeCount: nodes.filter((n) => !n.hidden).length,
    hiddenNodeTypeCount: nodes.filter((n) => n.hidden).length,
    categories: NODE_CATEGORIES,
    portTypes: PORT_TYPES,
  },
  // 幂等落库约束：这些字段必须原样保存到工作流的 nodes_json / edges_json，否则后端执行链路认不出来。
  persistence: {
    saveEndpoint: {
      create: 'POST /api/workflows',
      update: 'PUT /api/workflows/:workflowId',
      note: 'nodes 与 edges 以整图 JSON 提交，服务端不做拆分。nodeCount 由服务端按 nodes.length 推导，客户端传了也会被忽略。',
    },
    // 提交给后端的请求体形状（来源 server/services/workflowService.cjs 的 workflowPayload）
    workflowRequestBody: {
      name: 'string（默认 "Untitled workflow"，超长报 400）',
      description: 'string（默认 ""）',
      nodes: 'WorkflowNode[]',
      edges: 'WorkflowEdge[]',
      metadata: 'object（可选，默认 {}，按 UTF-8 计不超过 64 KB）',
      createdAt: 'string（可选，ISO 8601；非法值会被丢弃）',
    },
    // 列表/详情响应里的工作流对象（对应 ProxyWorkflowProject）
    workflowResponseShape: {
      id: 'string',
      userId: 'string',
      name: 'string',
      description: 'string',
      nodes: 'WorkflowNode[]',
      edges: 'WorkflowEdge[]',
      metadata: 'object',
      nodeCount: 'number（服务端推导）',
      createdAt: 'string',
      updatedAt: 'string',
    },
    // 服务端强制上限（来源 WORKFLOW_PAYLOAD_LIMITS），超限直接 4xx
    limits: {
      maxNodes: 500,
      maxEdges: 1000,
      maxIdLength: 160,
      maxNameLength: 160,
      maxDescriptionLength: 4000,
      maxMetadataBytes: 65536,
    },
    workflowShape: {
      nodes: 'WorkflowNode[]',
      edges: 'WorkflowEdge[]',
    },
    nodeRequiredFields: {
      id: 'string',
      type: 'string（本清单里的 type 之一）',
      position: '{ x: number, y: number }',
      data: {
        label: 'string',
        type: 'string（同 node.type）',
        config: 'Record<string, unknown>（键取自该节点的 configFields）',
        inputs: 'Record<string, unknown>（执行时填充，前端不必预置）',
        outputs: 'Record<string, unknown>（执行时填充，前端不必预置）',
        status: "'idle' | 'running' | 'completed' | 'error'",
      },
    },
    edgeRequiredFields: {
      id: 'string',
      source: 'string（源节点 id）',
      target: 'string（目标节点 id）',
      sourceHandle: "string | null（用 '__main_output' 表示由后端按 primaryOutput 推断）",
      targetHandle: "string | null（用 '__main_input' 表示由后端推断目标输入）",
      data: '{ sourceKey?: string, targetKey?: string }',
    },
    sentinels: {
      mainOutput: '__main_output',
      mainInput: '__main_input',
      note: '拖拽产生的连线只带 handle 时，用哨兵表示「按规则推断」。显式指定时写具体端口 id。',
    },
    primaryOutput: '取 connection.primaryOutput，否则 outputs[0].id，否则 "content"',
  },
  // 积分定价：单价按模型分档，前端可以用它显示单价与预估成本。
  creditPricing: {
    note:
      '任务在入队时即扣费，只有服务端 Key（server_key）会扣；用户自有 Key 不扣积分。' +
      ' creditCost 支持 textPerRequest / imagePerItem / videoPerSecond 三个字段，' +
      '按字段逐层回退：平台模型能力表 → 平台模型路由所指 apiKeyModel → 直接选的 apiKeyModel → ' +
      '按 model+provider 回算 preset → 全局默认价。0 是合法的免费定价，不是"未配置"。',
    units: {
      imagePerItem: '每张图片消耗的积分',
      textPerRequest: '每次文本请求消耗的积分',
      videoPerSecond: '每秒视频消耗的积分（时长不足 1 秒按 1 秒计）',
    },
    // 全局默认价（环境变量可覆盖）：未匹配任何 preset 的模型走这里
    fallbackDefaults: {
      imagePerItem: 10,
      textPerRequest: 1,
      userKeyMultiplier: 0,
      videoDefaultSeconds: 5,
      videoPerSecond: 20,
    },
    // 标定基准：图片 10 积分 ≈ ¥0.4 上游成本，即约 1 积分 ≈ ¥0.04
    benchmark: '图片 10 积分 ≈ ¥0.4；文本 1 积分 ≈ ¥0.005；视频 75 积分/秒 ≈ ¥0.6',
    presets: listCreditPricedPresets(),
  },
  // 硬约束：列在这里的节点/能力在后端不存在，新前端不得引入。
  mustNotInvent: {
    reason: '后端执行链路只认识本清单里的节点类型。新增类型不会报错，但保存后无法执行或行为不可预期。',
    forbiddenExamples: [
      '条件分支 / 条件判断（执行引擎只做拓扑排序与循环检测，没有条件求值或分支跳转）',
      '循环 / 迭代节点',
      '知识库 / 向量检索节点（后端无此能力）',
      '工具调用 / 函数调用节点（后端无此能力）',
      '触发器类节点（入口只能是文本输入与图片输入）',
      '任意形式的多分支路由',
    ],
  },
  nodes,
};

const outPath = path.join(root, 'docs/node-registry.json');
writeFileSync(outPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

console.log(`已生成 ${path.relative(root, outPath)}`);
console.log(`节点类型: ${nodes.length}（可见 ${registry.summary.visibleNodeTypeCount}，兼容旧工作流 ${registry.summary.hiddenNodeTypeCount}）`);
console.log(`类别: ${Object.keys(NODE_CATEGORIES).join(', ')}`);
console.log(`定价档位: ${registry.creditPricing.presets.length} 条`);
