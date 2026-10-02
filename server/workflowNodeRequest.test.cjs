// 节点 → 任务请求体映射的回归测试。
//
// 这层是新增的"数据搬运"逻辑：把节点配置、连线上游产物、参数信封
// 整理成生成服务期望的请求体。搬错字段会导致上游收到错误参数，
// 而且不会报错——所以覆盖要密。
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildNodeTaskBody,
  collectImages,
  isLocalNodeType,
  mergeUpstreamInputs,
  taskKindForNodeType,
  toText,
  unsupportedNodeTypesInGraph,
} = require('./services/workflowNodeRequest.cjs');

function node(id, type, config = {}) {
  return { id, type, config };
}

function edge(source, target, targetKey = '') {
  return { id: `${source}->${target}`, source, target, targetKey };
}

function outputs(entries) {
  return new Map(entries);
}

// ---- 节点类型 → 队列类型 ----------------------------------------------

test('节点类型正确映射到队列处理器', () => {
  assert.equal(taskKindForNodeType('imageGen'), 'image');
  assert.equal(taskKindForNodeType('imageToImage'), 'image');
  assert.equal(taskKindForNodeType('videoGen'), 'video');
  assert.equal(taskKindForNodeType('multiImageVideo'), 'video');
  assert.equal(taskKindForNodeType('textModel'), 'text');
  assert.equal(taskKindForNodeType('script'), 'text');
  assert.equal(taskKindForNodeType('shotSplit'), 'text');
  assert.equal(taskKindForNodeType('promptOptimize'), 'text');
});

test('本地节点与未知节点没有队列处理器', () => {
  for (const type of ['textInput', 'imageInput', 'preview', 'seedParam', 'merge']) {
    assert.equal(taskKindForNodeType(type), null, type);
    assert.equal(isLocalNodeType(type), true, type);
  }
  assert.equal(taskKindForNodeType('nope'), null);
  assert.equal(isLocalNodeType('nope'), false);
});

test('unsupportedNodeTypesInGraph 只报既非本地也无处理器的类型', () => {
  const nodes = [
    node('a', 'textInput'),
    node('b', 'imageGen'),
    node('c', 'weirdNode'),
    node('d', 'preview'),
    node('e', 'anotherWeird'),
  ];
  assert.deepEqual(unsupportedNodeTypesInGraph(nodes), ['weirdNode', 'anotherWeird']);
});

// ---- 文本降级 ----------------------------------------------------------

test('toText 认得各种信封形状', () => {
  assert.equal(toText('plain'), 'plain');
  assert.equal(toText(42), '42');
  assert.equal(toText(null), '');
  assert.equal(toText({ type: 'text', text: 'T' }), 'T');
  assert.equal(toText({ type: 'prompt', prompt: 'P' }), 'P');
  assert.equal(toText({ type: 'script', text: 'S' }), 'S');
  assert.equal(toText({ type: 'parameter', key: 'k', value: 7 }), '7');
  assert.equal(toText({ type: 'image', url: '/a.png' }), '/a.png');
});

test('toText 认得节点产物里的聚合形状，不退化成一坨 JSON', () => {
  // 节点产物在库里是 { text, value:TextValue }，必须取 text
  assert.equal(toText({ text: 'hi', value: { type: 'text', text: 'hi' } }), 'hi');
});

test('toText 从完整模型响应里只取语义文本，不夹带 JSON', () => {
  // 这是真实跑出来过的形状：promptOptimize 的产物带整包模型响应。
  // 若退化成 JSON，下游供应商会收到一坨 {"model":"qwen-plus","id":"chatcmpl-…"}。
  const nodeOutput = {
    model: 'qwen-plus',
    id: 'chatcmpl-abc123',
    choices: [{ message: { content: '阳光像融化的蜂蜜' } }],
    prompt: '阳光像融化的蜂蜜，缓缓流淌在窗台上',
    text: '阳光像融化的蜂蜜，缓缓流淌在窗台上',
    rawText: '{"model":"qwen-plus","id":"chatcmpl-abc123"}',
    task: { id: 'task-1' },
    mode: 'json',
  };
  const result = toText(nodeOutput);

  assert.equal(result, '阳光像融化的蜂蜜，缓缓流淌在窗台上');
  assert.equal(result.includes('chatcmpl'), false, '不应夹带响应 ID');
  assert.equal(result.includes('{'), false, '不应夹带 JSON 括号');
  assert.equal(result.includes('qwen-plus'), false, '不应夹带模型名');
});

test('toText 在只有 rawText 时退而取它，而不是整包 JSON', () => {
  assert.equal(
    toText({ rawText: '模型原文', task: { id: 't1' }, mode: 'fallback' }),
    '模型原文'
  );
});

test('toText 能从原始上游响应里解出文本（这是真实产物形状）', () => {
  // textGenerationService 把 result.data 直接存成任务产物，
  // 所以下游拿到的就是这一层响应体。
  const openAiEnvelope = {
    id: 'chatcmpl-x',
    object: 'chat.completion',
    model: 'qwen-plus',
    choices: [{ index: 0, message: { role: 'assistant', content: '阳光像融化的蜂蜜' }, finish_reason: 'stop' }],
    usage: { total_tokens: 120 },
  };
  const result = toText(openAiEnvelope);
  assert.equal(result, '阳光像融化的蜂蜜');
  assert.equal(result.includes('chatcmpl'), false, '不应夹带响应 ID');
  assert.equal(result.includes('usage'), false, '不应夹带用量信息');

  // Anthropic 形状
  assert.equal(
    toText({ content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }] }),
    '第一段第二段'
  );

  // DashScope 原生形状
  assert.equal(toText({ output: { text: '原生输出' } }), '原生输出');
  assert.equal(toText({ output: { choices: [{ message: { content: '嵌套输出' } }] } }), '嵌套输出');
});

test('toText 解不出响应信封时才退化成 JSON', () => {
  const result = toText({ totally: 'unknown', shape: true });
  assert.match(result, /"totally"/);
});

test('toText 把 ShotList 展开成逐镜文本', () => {
  const shotList = {
    type: 'shotList',
    items: [
      { index: 1, title: '开场', description: '远景', visualPrompt: 'wide shot' },
      { index: 2, title: '推进', description: '近景' },
    ],
  };
  const text = toText(shotList);
  assert.match(text, /1\. 开场/);
  assert.match(text, /wide shot/);
  assert.match(text, /2\. 推进/);
});

test('toText 对数组逐项降级并用空行连接', () => {
  assert.equal(toText(['a', { type: 'text', text: 'b' }]), 'a\n\nb');
  assert.equal(toText(['a', '', null]), 'a');
});

// ---- 图片收集 ----------------------------------------------------------

test('collectImages 认得单图、图片数组与带图分镜', () => {
  assert.deepEqual(collectImages({ type: 'image', url: '/1.png' }).map((i) => i.url), ['/1.png']);
  assert.deepEqual(
    collectImages([{ type: 'image', url: '/1.png' }, { type: 'image', url: '/2.png' }]).map((i) => i.url),
    ['/1.png', '/2.png']
  );
  const shotList = {
    type: 'shotList',
    items: [{ image: { type: 'image', url: '/a.png' } }, { image: null }, { image: { type: 'image', url: '/b.png' } }],
  };
  assert.deepEqual(collectImages(shotList).map((i) => i.url), ['/a.png', '/b.png']);
});

test('collectImages 忽略视频与空值，且能穿透聚合产物', () => {
  assert.deepEqual(collectImages({ type: 'video', url: '/v.mp4' }), []);
  assert.deepEqual(collectImages(null), []);
  assert.deepEqual(
    collectImages({ images: [{ type: 'image', url: '/x.png' }], text: 'ignored' }).map((i) => i.url),
    ['/x.png']
  );
});

// ---- 上游合并 ----------------------------------------------------------

test('prompt 槽位把上游文本降级后拼接', () => {
  const merged = mergeUpstreamInputs({
    body: { model: 'm' },
    edges: [edge('a', 't', 'prompt'), edge('b', 't', 'prompt')],
    outputsByNodeId: outputs([
      ['a', { text: '第一段', value: { type: 'text', text: '第一段' } }],
      ['b', { type: 'script', text: '第二段' }],
    ]),
  });
  assert.equal(merged.prompt, '第一段\n\n第二段');
});

test('参数槽位解出裸值，覆盖节点自身配置', () => {
  const merged = mergeUpstreamInputs({
    body: { model: 'm', seed: 1 },
    edges: [edge('s', 't', 'seed'), edge('y', 't', 'style')],
    outputsByNodeId: outputs([
      ['s', { seed: { type: 'parameter', key: 'seed', value: 4242 } }],
      ['y', { style: { type: 'parameter', key: 'style', value: 'anime' } }],
    ]),
  });
  assert.equal(merged.seed, 4242);
  assert.equal(merged.style, 'anime');
});

test('参数值为空时不覆盖，保留节点自身配置', () => {
  const merged = mergeUpstreamInputs({
    body: { model: 'm', quality: 'high' },
    edges: [edge('q', 't', 'quality')],
    outputsByNodeId: outputs([['q', { quality: { type: 'parameter', key: 'quality', value: '' } }]]),
  });
  assert.equal(merged.quality, 'high');
});

test('图片按上游收集并去重，单图同时写入 image 字段', () => {
  const merged = mergeUpstreamInputs({
    body: { model: 'm' },
    edges: [edge('i', 't', 'images')],
    outputsByNodeId: outputs([
      ['i', { images: [{ id: 'a', type: 'image', url: '/a.png' }, { id: 'a', type: 'image', url: '/a.png' }] }],
    ]),
  });
  assert.deepEqual(merged.images.map((item) => item.url), ['/a.png']);
  assert.equal(merged.image, '/a.png');
});

test('上游没有产物时不改动请求体', () => {
  const merged = mergeUpstreamInputs({
    body: { model: 'm', prompt: '原样' },
    edges: [edge('missing', 't', 'prompt')],
    outputsByNodeId: outputs([]),
  });
  assert.deepEqual(merged, { model: 'm', prompt: '原样' });
});

// ---- 请求体构造 --------------------------------------------------------

test('构造请求体：上游优先，节点配置兜底，参数槽位不残留', () => {
  const body = buildNodeTaskBody({
    node: node('i1', 'imageGen', {
      instanceId: 'inst-1',
      model: 'gpt-image-1',
      prompt: '节点自带提示词',
      seed: 1,
      style: 'realistic',
    }),
    edges: [edge('t1', 'i1', 'prompt'), edge('s1', 'i1', 'seed')],
    outputsByNodeId: outputs([
      ['t1', { text: '上游提示词', value: { type: 'text', text: '上游提示词' } }],
      ['s1', { seed: { type: 'parameter', key: 'seed', value: 99 } }],
    ]),
  });

  assert.equal(body.prompt, '上游提示词', '上游提示词应覆盖节点自带的');
  assert.equal(body.seed, 99, '参数节点应覆盖节点配置');
  assert.equal(body.style, 'realistic', '未被上游覆盖的配置应保留');
  assert.equal(body.model, 'gpt-image-1');
  assert.equal(body.instanceId, 'inst-1');
  assert.equal(body.nodeType, 'image', 'nodeType 由映射决定，不由配置决定');
});

test('没有上游时使用节点自身 prompt 作为兜底', () => {
  const body = buildNodeTaskBody({
    node: node('i2', 'imageGen', { model: 'm', prompt: '只有节点提示词' }),
    edges: [],
    outputsByNodeId: outputs([]),
  });
  assert.equal(body.prompt, '只有节点提示词');
});

test('videoGen 保留时长与比例等节点配置', () => {
  const body = buildNodeTaskBody({
    node: node('v1', 'videoGen', {
      aspectRatio: '9:16',
      duration: 8,
      model: 'doubao-seedance-2-0-mini-260615',
      motion: 'slow pan',
      resolution: '720P',
    }),
    edges: [],
    outputsByNodeId: outputs([]),
  });
  assert.equal(body.nodeType, 'video');
  assert.equal(body.duration, 8);
  assert.equal(body.aspectRatio, '9:16');
  assert.equal(body.resolution, '720P');
  assert.equal(body.motion, 'slow pan');
});

test('没有队列处理器的节点类型返回 null 而不是编造请求体', () => {
  assert.equal(buildNodeTaskBody({ node: node('x', 'weird'), edges: [], outputsByNodeId: outputs([]) }), null);
});

test('分镜图上游能把带图分镜成组喂给视频节点', () => {
  const body = buildNodeTaskBody({
    node: node('v1', 'videoGen', { model: 'm' }),
    edges: [edge('split', 'v1', 'images')],
    outputsByNodeId: outputs([
      ['split', {
        shotList: {
          type: 'shotList',
          items: [
            { image: { id: 's1', type: 'image', url: '/s1.png' } },
            { image: { id: 's2', type: 'image', url: '/s2.png' } },
          ],
        },
      }],
    ]),
  });
  assert.deepEqual(body.images.map((item) => item.url), ['/s1.png', '/s2.png']);
});
