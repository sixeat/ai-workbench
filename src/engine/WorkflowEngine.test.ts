import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { Edge, Node } from '@xyflow/react';
import type { ExecutionEvent, ExecutionPatch, TextModelContext } from './executionTypes';
import type { NodeData, NodeType } from '../types/nodes';

type WorkflowEngineModule = typeof import('./WorkflowEngine');

interface TestSink {
  starts: number;
  patches: ExecutionPatch[];
  events: ExecutionEvent[];
  startExecution: () => void;
  applyPatch: (patch: ExecutionPatch) => void;
  applyEvent: (event: ExecutionEvent) => void;
}

function installLocalStorage() {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
}

async function loadEngine(): Promise<WorkflowEngineModule> {
  installLocalStorage();
  return import('./WorkflowEngine');
}

function makeNode(id: string, type: NodeType, config: Record<string, any> = {}, outputs: Record<string, any> = {}): Node<NodeData> {
  return {
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      type,
      config,
      inputs: {},
      outputs,
      status: 'idle',
    },
  };
}

function makeSink(nodes: Node<NodeData>[]): TestSink {
  const sink: TestSink = {
    starts: 0,
    patches: [],
    events: [],
    startExecution: () => {
      sink.starts += 1;
    },
    applyPatch: (patch) => {
      sink.patches.push(patch);
      const node = nodes.find((item) => item.id === patch.nodeId);
      if (node) node.data = { ...node.data, ...patch.data };
    },
    applyEvent: (event) => {
      sink.events.push(event);
    },
  };
  return sink;
}

function logMessages(events: ExecutionEvent[]) {
  return events
    .filter((event): event is Extract<ExecutionEvent, { type: 'log' }> => event.type === 'log')
    .map((event) => event.log.message);
}

beforeEach(() => {
  delete (globalThis as any).fetch;
});

test('executeNodeIdsOnGraph completes a text input node and reuses it when unchanged', async () => {
  const { executeNodeIdsOnGraph } = await loadEngine();
  const nodes = [makeNode('input', 'textInput', { content: 'hello' })];
  const edges: Edge[] = [];

  const firstSink = makeSink(nodes);
  await executeNodeIdsOnGraph(new Set(['input']), '运行测试节点', nodes, edges, firstSink);

  assert.equal(firstSink.starts, 1);
  assert.equal(nodes[0].data.status, 'completed');
  assert.equal(nodes[0].data.outputs.text, 'hello');
  assert.equal(typeof nodes[0].data.executionFingerprint, 'string');

  const secondSink = makeSink(nodes);
  await executeNodeIdsOnGraph(new Set(['input']), '复用测试节点', nodes, edges, secondSink);

  assert.equal(secondSink.patches.length, 0);
  assert.ok(logMessages(secondSink.events).some((message) => message.includes('复用已完成节点')));
});

test('executeNodeIdsOnGraph stops downstream nodes after a failed dependency', async () => {
  const { executeNodeIdsOnGraph } = await loadEngine();
  const nodes = [
    makeNode('input', 'textInput', { content: '' }),
    makeNode('model', 'textModel', { modelSource: 'inherit' }),
    makeNode('preview', 'preview'),
  ];
  const edges: Edge[] = [
    { id: 'e1', source: 'input', target: 'model' },
    { id: 'e2', source: 'model', target: 'preview' },
  ];

  const sink = makeSink(nodes);
  await executeNodeIdsOnGraph(new Set(nodes.map((node) => node.id)), '运行失败链路', nodes, edges, sink);

  assert.equal(nodes[0].data.status, 'completed');
  assert.equal(nodes[1].data.status, 'error');
  assert.equal(nodes[1].data.error, '文本模型需要 prompt 输入');
  assert.equal(nodes[2].data.status, 'idle');
});

test('text model inherits upstream model context', async () => {
  const { executeNodeIdsOnGraph } = await loadEngine();
  const { useApiStore } = await import('../stores/apiStore');
  const instanceId = useApiStore.getState().addInstance({
    name: 'Test OpenAI',
    providerId: 'openai-compatible',
    baseUrl: 'https://example.test',
    apiKey: 'test-key',
    customHeaders: {},
    models: ['gpt-upstream'],
    modelFetchMode: 'manual',
    isEnabled: true,
  });

  const requests: any[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init?.body || '{}')) });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'inherited response' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const nodes = [
    makeNode('upstream', 'textModel', {}, {
      text: 'write a short line',
      task: { id: 'upstream-task-1', status: 'succeeded' },
      modelContext: {
        instanceId,
        model: 'gpt-upstream',
        sourceNodeId: 'upstream',
        sourceNodeType: 'textModel',
        sourceNodeLabel: 'upstream',
      },
    }),
    makeNode('model', 'textModel', { modelSource: 'inherit' }),
  ];
  const edges: Edge[] = [{ id: 'e1', source: 'upstream', target: 'model' }];

  const sink = makeSink(nodes);
  await executeNodeIdsOnGraph(new Set(['model']), '运行继承模型', nodes, edges, sink);

  assert.equal(nodes[1].data.status, 'completed');
  assert.equal(nodes[1].data.outputs.text, 'inherited response');
  assert.equal(nodes[1].data.outputs.modelSourceUsed, 'inherit');
  const modelContext = nodes[1].data.outputs.modelContext as TextModelContext;
  assert.equal(modelContext.model, 'gpt-upstream');
  assert.equal(requests[0].url, '/api/chat');
  assert.equal(requests[0].body.model, 'gpt-upstream');
  assert.deepEqual(requests[0].body.upstreamTaskIds, ['upstream-task-1']);
});

test('connection inference uses node definition rules', async () => {
  await loadEngine();
  const { inferConnection } = await import('../lib/connectionInference');

  const imageInput = makeNode('image-input', 'imageInput');
  const imageGen = makeNode('image-gen', 'imageGen');
  const styleParam = makeNode('style', 'styleParam');
  const videoGen = makeNode('video-gen', 'videoGen');

  const firstImage = inferConnection(imageInput, imageGen, []);
  assert.equal(firstImage.sourceKey, 'image');
  assert.equal(firstImage.targetKey, 'referenceImage');

  const secondImage = inferConnection(imageInput, imageGen, [
    { id: 'existing-image', source: 'old-image', target: 'image-gen', data: { targetKey: 'referenceImage' } },
  ]);
  assert.equal(secondImage.targetKey, 'referenceImages');

  const styleToImage = inferConnection(styleParam, imageGen, []);
  assert.equal(styleToImage.sourceKey, 'style');
  assert.equal(styleToImage.targetKey, 'style');

  const imageToVideo = inferConnection(imageInput, videoGen, []);
  assert.equal(imageToVideo.targetKey, 'image');
});

test('node IO schema is derived from node definitions', async () => {
  await loadEngine();
  const { getNodeConfigSchema, getNodeIOSchema } = await import('./nodeIoSchema');

  const schema = getNodeIOSchema('imageGen');
  assert.equal(schema?.inputs.prompt.type, 'any');
  assert.equal(schema?.inputs.referenceImage.type, 'image');
  assert.equal(schema?.outputs.image.type, 'image');

  const configSchema = getNodeConfigSchema('imageGen');
  assert.equal(configSchema?.fields.instanceId.required, true);
  assert.equal(configSchema?.fields.n.type, 'number');
});

test('node config schema can be constrained by model capabilities', async () => {
  await loadEngine();
  const { getNodeConfigSchema, validateNodeConfig } = await import('./nodeIoSchema');

  const videoSchema = getNodeConfigSchema('videoGen', {
    video: {
      durationMin: 3,
      durationMax: 11,
      resolutions: ['720P'],
      ratios: ['16:9', '9:16'],
      modes: ['text-to-video', 'image-to-video'],
    },
  });
  assert.equal(videoSchema?.fields.duration.min, 3);
  assert.equal(videoSchema?.fields.duration.max, 11);
  assert.deepEqual(videoSchema?.fields.resolution.options, [{ label: '720P', value: '720P' }]);
  assert.deepEqual(videoSchema?.fields.aspectRatio.options, [
    { label: '16:9', value: '16:9' },
    { label: '9:16', value: '9:16' },
  ]);
  assert.deepEqual(videoSchema?.fields.mode.options, [
    { label: '自动识别输入', value: 'auto' },
    { label: '文生视频', value: 'text-to-video' },
    { label: '图生视频', value: 'image-to-video' },
  ]);

  const result = validateNodeConfig(makeNode('video', 'videoGen', { duration: 20, resolution: '1080P', mode: 'images-to-video' }).data, {
    video: {
      durationMin: 3,
      durationMax: 11,
      resolutions: ['720P'],
      modes: ['text-to-video', 'image-to-video'],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /不能大于 11/);
  assert.match(result.errors.join('\n'), /需要 select 类型/);
});

test('executeNodeIdsOnGraph rejects incompatible connected input types', async () => {
  const { executeNodeIdsOnGraph } = await loadEngine();
  const nodes = [
    makeNode('input', 'countParam', { count: 2 }),
    makeNode('image-to-image', 'imageToImage', { prompt: 'edit this' }),
  ];
  const edges: Edge[] = [
    { id: 'e1', source: 'input', target: 'image-to-image', data: { sourceKey: 'count', targetKey: 'image' } },
  ];

  const sink = makeSink(nodes);
  await executeNodeIdsOnGraph(new Set(nodes.map((node) => node.id)), '运行类型错误链路', nodes, edges, sink);

  assert.equal(nodes[0].data.status, 'completed');
  assert.equal(nodes[1].data.status, 'error');
  assert.match(String(nodes[1].data.error), /需要 image 类型/);
});

test('executeNodeIdsOnGraph rejects invalid node config before running', async () => {
  const { executeNodeIdsOnGraph } = await loadEngine();
  const nodes = [makeNode('count', 'countParam', { count: 'not-a-number' })];
  const sink = makeSink(nodes);

  await executeNodeIdsOnGraph(new Set(['count']), '运行配置错误节点', nodes, [], sink);

  assert.equal(nodes[0].data.status, 'error');
  assert.match(String(nodes[0].data.error), /需要 number 类型/);
});

test('executeNodeIdsOnGraph de-duplicates image assets in node run summary', async () => {
  const { executeNodeIdsOnGraph } = await loadEngine();
  const { useApiStore } = await import('../stores/apiStore');
  const instanceId = useApiStore.getState().addInstance({
    name: 'Image Test',
    providerId: 'openai-compatible',
    baseUrl: 'https://example.test',
    apiKey: 'test-key',
    customHeaders: {},
    models: ['gpt-image-test'],
    modelFetchMode: 'manual',
    isEnabled: true,
  });

  const requests: any[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({
      data: [
        {
          id: 'asset-image-1',
          url: '/api/assets/asset-image-1',
          fileName: 'asset-image-1.png',
          createdAt: '2026-07-05T00:00:00.000Z',
        },
      ],
      task: {
        id: 'task-image-1',
        status: 'succeeded',
        model: 'gpt-image-test',
        providerId: 'openai-compatible',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const nodes = [
    makeNode('image', 'imageGen', {
      instanceId,
      model: 'gpt-image-test',
      prompt: 'draw a bright test image',
      promptExtend: true,
      enableSequential: false,
    }),
  ];
  const sink = makeSink(nodes);

  await executeNodeIdsOnGraph(new Set(['image']), '运行图片节点', nodes, [], sink);

  assert.equal(nodes[0].data.status, 'completed');
  assert.equal(nodes[0].data.lastRun?.taskId, 'task-image-1');
  assert.equal(nodes[0].data.lastRun?.taskStatus, 'succeeded');
  assert.equal(nodes[0].data.lastRun?.model, 'gpt-image-test');
  assert.equal(nodes[0].data.lastRun?.providerId, 'openai-compatible');
  assert.equal(nodes[0].data.lastRun?.assetCount, 1);
  assert.deepEqual(nodes[0].data.lastRun?.assets.map((asset) => asset.id), ['asset-image-1']);
  assert.equal(requests[0].promptExtend, true);
  assert.equal(Object.hasOwn(requests[0], 'enableSequential'), false);
});

test('executeNodeIdsOnGraph preserves queued video task even before asset url exists', async () => {
  const { executeNodeIdsOnGraph } = await loadEngine();
  const { useApiStore } = await import('../stores/apiStore');
  const instanceId = useApiStore.getState().addInstance({
    name: 'Video Test',
    providerId: 'seedance',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    apiKey: 'test-key',
    customHeaders: {},
    models: ['doubao-seedance-test'],
    modelFetchMode: 'manual',
    isEnabled: true,
  });

  const requests: any[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({
      taskId: 'video-task-1',
      data: { upstreamTaskId: 'upstream-video-task-1' },
      warnings: [],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const nodes = [
    makeNode('video', 'videoGen', {
      instanceId,
      model: 'doubao-seedance-test',
      prompt: 'a calm product video',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720P',
    }),
  ];
  const sink = makeSink(nodes);

  await executeNodeIdsOnGraph(new Set(['video']), '运行视频节点', nodes, [], sink);

  assert.equal(nodes[0].data.status, 'completed');
  assert.equal(nodes[0].data.lastRun?.taskId, 'video-task-1');
  assert.equal(nodes[0].data.lastRun?.taskStatus, 'queued');
  assert.equal(nodes[0].data.lastRun?.model, 'doubao-seedance-test');
  assert.equal(nodes[0].data.lastRun?.providerId, 'seedance');
  assert.equal(nodes[0].data.lastRun?.assetCount, 0);
  assert.deepEqual(nodes[0].data.lastRun?.assets, []);
  assert.equal(requests[0].mode, 'text-to-video');
});
