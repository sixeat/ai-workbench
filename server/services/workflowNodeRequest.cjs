// 工作流节点 → 生成任务请求体的映射。
//
// 这一层只做「数据搬运」：把节点的 config、连线上游节点的产物、参数节点的信封，
// 整理成生成服务期望的请求体形状。它**不复制执行器的业务逻辑**——
// 真正的调用仍由现有 image/video/text 生成服务完成。
//
// 输出形状对齐 src/engine/nodeExecutors 的做法（见 docs/workflow-execution-semantics.md）：
// - 上游产物按 targetKey 落到对应输入槽
// - 参数节点解出裸值后覆盖同名配置
// - prompt 类输入走 toText 降级

/** 节点类型 → 队列里的 nodeType。与 generationWorker/textWorker 的 handlers 对齐。 */
const NODE_TYPE_TO_TASK_KIND = {
  imageGen: 'image',
  imageToImage: 'image',
  multiImageVideo: 'video',
  promptOptimize: 'text',
  script: 'text',
  shotSplit: 'text',
  textModel: 'text',
  videoGen: 'video',
};

/** 只在 promptOptimize 上成立的默认前缀，与前端执行器保持一致。 */
const PARAMETER_INPUT_KEYS = new Set([
  'count',
  'negativePrompt',
  'prompt',
  'quality',
  'seed',
  'shotParams',
  'size',
  'strength',
  'style',
]);

function taskKindForNodeType(nodeType) {
  return NODE_TYPE_TO_TASK_KIND[String(nodeType || '')] || null;
}

/** 从原始上游响应里取文本。返回空串表示"这不是一个可识别的响应信封"。 */
function textFromUpstreamEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';

  // OpenAI 兼容 / DashScope 兼容模式：{ choices: [{ message: { content } }] }
  const choice = Array.isArray(value.choices) ? value.choices[0] : null;
  const chatContent = choice?.message?.content ?? choice?.delta?.content ?? choice?.text;
  if (typeof chatContent === 'string' && chatContent.trim()) return chatContent;

  // Anthropic：{ content: [{ type:'text', text }] }
  if (Array.isArray(value.content)) {
    const parts = value.content
      .filter((item) => item && typeof item.text === 'string')
      .map((item) => item.text);
    if (parts.length > 0) return parts.join('');
  }

  // DashScope 原生：{ output: { text } } 或 { output: { choices: [...] } }
  if (value.output && typeof value.output === 'object') {
    if (typeof value.output.text === 'string' && value.output.text.trim()) return value.output.text;
    return textFromUpstreamEnvelope(value.output);
  }

  return '';
}

/** 与前端 workflowValues.toText 对齐的文本降级。 */
function toText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join('\n\n');
  if (typeof value !== 'object') return String(value);

  if (value.type === 'prompt') {
    // 既可能是 { type:'prompt', prompt:string }，也可能是 { type:'prompt', prompt:PromptValue }
    const inner = value.prompt;
    if (typeof inner === 'string' && inner) return inner;
    if (inner && typeof inner === 'object' && typeof inner.prompt === 'string') return inner.prompt;
  }
  if (value.type === 'script' && typeof value.text === 'string') return value.text;
  if (value.type === 'text' && typeof value.text === 'string') return value.text;
  if (value.type === 'image' && typeof value.url === 'string') return value.url;
  if (value.type === 'parameter') return String(value.value ?? '');
  if (value.type === 'shotList' && Array.isArray(value.items)) {
    return value.items
      .map((shot) => `${shot.index ?? ''}. ${shot.title ?? ''}\n${shot.visualPrompt || shot.description || ''}`)
      .join('\n\n');
  }

  // 关键：文本类任务的产物**就是原始上游响应**（textGenerationService 存的是 result.data）。
  // 必须先把语义文本解出来，最后才退化成 JSON——
  // 否则整包 {choices, usage, id} 会被当成提示词发给下游供应商。
  if (typeof value.text === 'string' && value.text) return value.text;
  if (typeof value.prompt === 'string' && value.prompt) return value.prompt;
  if (typeof value.merged === 'string' && value.merged) return value.merged;
  if (typeof value.rawText === 'string' && value.rawText) return value.rawText;

  const fromEnvelope = textFromUpstreamEnvelope(value);
  if (fromEnvelope) return fromEnvelope;

  return JSON.stringify(value, null, 2);
}

/** 从上游产物收集图片资产。支持单图、图片数组、带图分镜三种形态。 */
function collectImages(value, collected = []) {
  if (!value) return collected;
  if (Array.isArray(value)) {
    for (const item of value) collectImages(item, collected);
    return collected;
  }
  if (typeof value !== 'object') return collected;

  if (value.type === 'image' && typeof value.url === 'string') {
    collected.push(value);
    return collected;
  }
  if (value.type === 'shotList' && Array.isArray(value.items)) {
    for (const shot of value.items) collectImages(shot?.image, collected);
    return collected;
  }
  if (value.type === 'video' || value.type === 'asset') return collected;

  // 节点产物是 { image, images, shotList, ... } 这种聚合结构，继续往里找
  for (const item of Object.values(value)) collectImages(item, collected);
  return collected;
}

/**
 * 把上游节点产物合并进请求体。
 *
 * 参数类节点的信封解出裸值后覆盖同名配置；其余按 targetKey 落槽。
 */
function mergeUpstreamInputs({ body, edges, outputsByNodeId }) {
  const merged = { ...body };
  const images = [];

  for (const edge of edges) {
    const upstreamOutput = outputsByNodeId.get(edge.source);
    if (upstreamOutput == null) continue;

    const targetKey = edge.targetKey || '';

    // prompt 槽位特殊：上游可能是提示词、剧本、分镜，统一降级成文本，
    // 多条上游按顺序拼接（与前端 getNodeInputs 对 prompt 的收集行为一致）。
    if (targetKey === 'prompt' || targetKey === 'content' || targetKey === 'script') {
      const text = toText(upstreamOutput);
      if (text) merged.prompt = merged.prompt ? `${merged.prompt}\n\n${text}` : text;
      continue;
    }

    // 参数槽位：上游是 { type:'parameter', key, value } 时解出裸值，
    // 否则按同名键取值。解出的裸值覆盖节点自身配置。
    if (targetKey && PARAMETER_INPUT_KEYS.has(targetKey)) {
      const value = extractParameterValue(upstreamOutput, targetKey);
      if (value !== undefined && value !== null && value !== '') merged[targetKey] = value;
      continue;
    }

    const found = collectImages(upstreamOutput);
    if (found.length > 0) images.push(...found);
  }

  if (images.length > 0) {
    // 去重，避免同一条上游被多个 key 重复带进来
    const seen = new Set();
    const unique = images.filter((item) => {
      const key = String(item.id || item.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    merged.images = unique;
    if (unique.length === 1 && !merged.image) merged.image = unique[0].url;
    if (!merged.prompt && unique.length > 0) {
      merged.prompt = unique.map((item) => item.prompt).filter(Boolean).join('\n');
    }
  }

  return merged;
}

function extractParameterValue(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  if (value.type === 'parameter' && value.key === key) return value.value;
  // 节点产物是 { style: ParameterValue } 这种聚合形状，要再拆一层信封
  const nested = value[key];
  if (nested && typeof nested === 'object' && nested.type === 'parameter') return nested.value;
  if (nested !== undefined && nested !== null) return nested;
  return undefined;
}

/**
 * 由节点与上游产物构造生成请求体。
 *
 * 返回 null 表示这个节点类型没有对应的队列处理器——调用方应当拒绝而不是静默入队，
 * 否则节点会永远停在 queued。
 */
function buildNodeTaskBody({ node, edges, outputsByNodeId }) {
  const kind = taskKindForNodeType(node?.type);
  if (!kind) return null;

  const config = node.config || {};
  const body = {
    ...config,
    nodeType: kind,
    providerId: config.providerId || undefined,
    model: config.model || undefined,
  };

  // 参数槽位只保留"可由上游参数节点覆盖"的键，其余配置原样带下去。
  // 注意不要把 prompt 从 body 里删掉——它是节点的兜底提示词，上游没连时才用。
  for (const key of PARAMETER_INPUT_KEYS) delete body[key];
  delete body.nodeType;

  const merged = mergeUpstreamInputs({ body, edges, outputsByNodeId });

  // 节点自身配置里的提示词与参数作为兜底
  if (!merged.prompt) merged.prompt = toText(config.prompt || '');
  if (config.negativePrompt && !merged.negativePrompt) merged.negativePrompt = config.negativePrompt;
  if (config.style && merged.style == null) merged.style = config.style;
  if (config.n != null && merged.n == null) merged.n = config.n;
  if (config.duration != null && merged.duration == null) merged.duration = config.duration;

  merged.nodeType = kind;
  return merged;
}

/** 运行需要哪些队列的能力，用于把不支持的节点类型挡在创建运行之前。 */
function unsupportedNodeTypesInGraph(nodes = []) {
  return nodes
    .filter((node) => node.type && !taskKindForNodeType(node.type) && !isLocalNodeType(node.type))
    .map((node) => node.type);
}

const LOCAL_NODE_TYPES = new Set([
  'imageInput',
  'merge',
  'multiImageInput',
  'negativePromptParam',
  'preview',
  'promptParam',
  'qualityParam',
  'referenceStrengthParam',
  'seedParam',
  'shotParam',
  'sizeParam',
  'styleParam',
  'textInput',
  'countParam',
]);

function isLocalNodeType(nodeType) {
  return LOCAL_NODE_TYPES.has(String(nodeType || ''));
}

module.exports = {
  buildNodeTaskBody,
  collectImages,
  isLocalNodeType,
  mergeUpstreamInputs,
  NODE_TYPE_TO_TASK_KIND,
  taskKindForNodeType,
  toText,
  unsupportedNodeTypesInGraph,
};
