import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canCancelTask,
  canRetryTask,
  chunkTaskAssetIds,
  collectArchivableTaskAssetIds,
  collectTaskAssets,
  extractTaskOutputText,
  extractTaskReusablePrompt,
  filterTaskHistoryItems,
  formatTaskHistoryPageSummary,
  formatTaskAssetArchiveSummary,
  formatTaskLogEvent,
  mergeTaskHistoryPages,
  serializeTaskInputForCopy,
  summarizeTaskError,
  summarizeTaskInput,
  uniqueTaskAssetIds,
} from './taskHistoryDisplay';
import type { ProxyAsset, ProxyTask } from './apiProxy';

function task(id: string, patch: Partial<ProxyTask>): ProxyTask {
  return {
    id,
    kind: 'image',
    status: 'succeeded',
    input: {},
    output: {},
    error: null,
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    durationMs: null,
    ...patch,
  };
}

function asset(id: string, patch: Partial<ProxyAsset>): ProxyAsset {
  return {
    id,
    type: 'image',
    url: `/api/assets/${id}`,
    ...patch,
  };
}

test('task action helpers allow soft cancel for queued and running tasks', () => {
  assert.equal(canCancelTask('queued'), true);
  assert.equal(canCancelTask('running'), true);
  assert.equal(canCancelTask('succeeded'), false);
  assert.equal(canRetryTask('failed'), true);
  assert.equal(canRetryTask('cancelled'), false);
});

test('task asset batch helpers dedupe ids and split large requests', () => {
  assert.deepEqual(
    uniqueTaskAssetIds([
      { id: 'asset-a' },
      { id: '' },
      { id: 'asset-a' },
      { id: 'asset-b' },
    ]),
    ['asset-a', 'asset-b']
  );
  assert.deepEqual(chunkTaskAssetIds(['a', 'b', 'c', 'd', 'e'], 2), [['a', 'b'], ['c', 'd'], ['e']]);
  assert.deepEqual(chunkTaskAssetIds(['a', 'b'], 0), [['a'], ['b']]);
});

test('task archive helpers summarize unique assets across filtered tasks', () => {
  const items = [
    {
      task: task('task-a', {}),
      assets: [
        asset('asset-a', {}),
        asset('asset-b', {}),
      ],
    },
    {
      task: task('task-b', {}),
      assets: [
        asset('asset-b', {}),
        asset('asset-c', {}),
      ],
    },
    {
      task: task('task-c', {}),
      assets: [],
    },
  ];

  assert.deepEqual(collectArchivableTaskAssetIds(items), ['asset-a', 'asset-b', 'asset-c']);
  assert.equal(formatTaskAssetArchiveSummary(items), '归档已加载的 2 个任务，共 3 个产物');
  assert.equal(formatTaskAssetArchiveSummary([{ task: task('empty', {}), assets: [] }]), '已加载结果里没有可入库产物');
});

test('collectTaskAssets extracts linked, video, and shot list assets for library reuse', () => {
  const linked = asset('linked-image', { fileName: 'linked.png' });
  const duplicateLinked = asset('linked-image', { fileName: 'duplicate.png' });
  const shotImage = asset('shot-image', { fileName: 'shot.png' });
  const video = asset('video-asset', {
    type: 'video',
    url: '/api/assets/video-asset',
    fileName: 'result.mp4',
  });

  const collected = collectTaskAssets(task('task-assets', {
    assets: [linked, duplicateLinked],
    output: {
      video,
      shotList: {
        type: 'shotList',
        items: [
          { title: '开场', image: shotImage },
          { title: '无图镜头' },
        ],
      },
      images: [
        asset('inline-image', { fileName: 'inline.png' }),
        { type: 'image', url: '/api/assets/no-id-image', fileName: 'no-id.png' },
      ],
    },
  }));

  assert.deepEqual(
    collected.map((item) => [item.id, item.type, item.fileName]),
    [
      ['linked-image', 'image', 'linked.png'],
      ['inline-image', 'image', 'inline.png'],
      [undefined, 'image', 'no-id.png'],
      ['video-asset', 'video', 'result.mp4'],
      ['shot-image', 'image', 'shot.png'],
    ]
  );
});

test('summarizeTaskInput keeps useful fields and avoids raw apiKey', () => {
  const rows = summarizeTaskInput({
    prompt: '生成一个电影感角色设定',
    model: 'gpt-image-test',
    providerId: 'openai-compatible',
    apiKeyId: 'key-1',
    apiKey: 'sk-should-not-appear',
    size: '1024x1024',
    n: 2,
    messages: [
      { role: 'user', content: '写一个短剧本' },
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.label),
    ['提示词', '模型', 'Provider', 'Key', '尺寸', '数量', '消息数', '最后消息']
  );
  assert.equal(rows.some((row) => row.value.includes('sk-should-not-appear')), false);
});

test('extractTaskReusablePrompt supports prompt, chat messages, and multimodal content text', () => {
  assert.equal(extractTaskReusablePrompt({ prompt: '生成一个角色三视图' }), '生成一个角色三视图');
  assert.equal(
    extractTaskReusablePrompt({
      messages: [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: '写一个短剧本' },
      ],
    }),
    '写一个短剧本'
  );
  assert.equal(
    extractTaskReusablePrompt({
      content: [
        { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
        { type: 'text', text: '生成 8 秒产品广告' },
      ],
    }),
    '生成 8 秒产品广告'
  );
});

test('serializeTaskInputForCopy redacts secrets but keeps reusable parameters', () => {
  const text = serializeTaskInputForCopy({
    prompt: '生成一个角色三视图',
    model: 'gpt-image-test',
    apiKey: 'sk-secret',
    apiKeyId: 'key-1',
    headers: {
      Authorization: 'Bearer secret',
      'x-trace-id': 'trace-1',
    },
    nested: {
      refresh_token: 'token-secret',
      size: '1024x1024',
    },
  });
  const copied = JSON.parse(text);

  assert.equal(copied.prompt, '生成一个角色三视图');
  assert.equal(copied.apiKey, '[已隐藏]');
  assert.equal(copied.apiKeyId, 'key-1');
  assert.equal(copied.headers.Authorization, '[已隐藏]');
  assert.equal(copied.headers['x-trace-id'], 'trace-1');
  assert.equal(copied.nested.refresh_token, '[已隐藏]');
  assert.equal(copied.nested.size, '1024x1024');
});

test('extractTaskOutputText supports text, script, prompt, and shot list outputs', () => {
  assert.equal(extractTaskOutputText('直接文本'), '直接文本');
  assert.equal(extractTaskOutputText({ text: '模型输出文本' }), '模型输出文本');
  assert.equal(extractTaskOutputText({ script: { text: '剧本文本' } }), '剧本文本');
  assert.equal(extractTaskOutputText({ prompt: { prompt: '图片提示词' } }), '图片提示词');
  assert.equal(
    extractTaskOutputText({
      shotList: {
        items: [
          { title: '开场', description: '雨夜街区远景' },
          { title: '特写', visualPrompt: '角色脸部特写，电影光' },
        ],
      },
    }),
    '开场: 雨夜街区远景\n特写: 角色脸部特写，电影光'
  );
});

test('formatTaskLogEvent translates known queue events', () => {
  assert.equal(formatTaskLogEvent('started'), '开始执行');
  assert.equal(formatTaskLogEvent('upstream_image_submitted'), '图片请求已提交');
  assert.equal(formatTaskLogEvent('upstream_text_submitted'), '文本请求已提交');
  assert.equal(formatTaskLogEvent('upstream_video_request_submitted'), '视频请求已提交');
  assert.equal(formatTaskLogEvent('retry_created'), '创建重试任务');
  assert.equal(formatTaskLogEvent('custom_event'), 'custom_event');
});

test('summarizeTaskError explains normalized upstream failures', () => {
  const summary = summarizeTaskError({
    message: 'Image generation failed.',
    upstreamStatus: 429,
    upstreamStatusText: 'Too Many Requests',
    upstreamCategory: 'rate_limit',
    upstreamRetryable: true,
    upstreamCode: 'RateLimitExceeded',
    upstreamMessage: 'Requests are too frequent.',
    upstreamRequestId: 'req-123',
  });

  assert.deepEqual(summary, {
    title: '触发限流',
    detail: 'Requests are too frequent.',
    actionLabel: '稍后重试',
    category: 'rate_limit',
    categoryLabel: '触发限流',
    retryable: true,
    retryHint: '触发限流。可以稍后重试，或降低队列并发后再试。',
    code: 'RateLimitExceeded',
    requestId: 'req-123',
    status: '429 Too Many Requests',
  });
});

test('summarizeTaskError supports nested upstream envelopes', () => {
  const summary = summarizeTaskError({
    message: 'Text generation failed.',
    upstream: {
      status: 401,
      category: 'auth',
      retryable: false,
      message: 'Invalid API key.',
    },
  });

  assert.equal(summary?.title, '鉴权失败');
  assert.equal(summary?.detail, 'Invalid API key.');
  assert.equal(summary?.actionLabel, '检查 Key');
  assert.equal(summary?.retryHint, '请检查 API Key 是否有效、是否属于当前厂商，或重新保存后再试。');
});

test('summarizeTaskError labels content policy failures', () => {
  const summary = summarizeTaskError({
    message: 'Video task failed upstream.',
    upstreamCategory: 'content_policy',
    upstreamRetryable: false,
    upstreamCode: 'SensitiveContentDetected',
    upstreamMessage: '输入内容被安全策略拦截。',
  });

  assert.equal(summary?.title, '内容安全拦截');
  assert.equal(summary?.categoryLabel, '内容安全拦截');
  assert.equal(summary?.detail, '输入内容被安全策略拦截。');
  assert.equal(summary?.actionLabel, '调整内容');
  assert.equal(summary?.retryHint, '请调整提示词或参考素材，避开被厂商安全策略拦截的内容。');
});

test('summarizeTaskError keeps plain string errors readable', () => {
  assert.deepEqual(summarizeTaskError('Worker crashed'), {
    title: '任务失败',
    detail: 'Worker crashed',
  });
});

test('filterTaskHistoryItems filters by status and searches task inputs, errors, and assets', () => {
  const items = [
    {
      task: task('task-a', {
        status: 'failed',
        input: { prompt: '雨夜街区角色海报', model: 'gpt-image-test' },
        error: { upstreamCategory: 'quota', upstreamMessage: 'Insufficient balance.' },
      }),
      assets: [],
    },
    {
      task: task('task-b', {
        status: 'succeeded',
        input: { prompt: '苹果果茶广告' },
      }),
      assets: [asset('asset-b', { fileName: 'tea-product.png', libraryRole: '产品参考' })],
    },
  ];

  assert.deepEqual(filterTaskHistoryItems(items, { status: 'failed' }).map((item) => item.task.id), ['task-a']);
  assert.deepEqual(filterTaskHistoryItems(items, { search: '雨夜' }).map((item) => item.task.id), ['task-a']);
  assert.deepEqual(filterTaskHistoryItems(items, { search: '额度不足' }).map((item) => item.task.id), ['task-a']);
  assert.deepEqual(filterTaskHistoryItems(items, { search: '检查额度' }).map((item) => item.task.id), ['task-a']);
  assert.deepEqual(filterTaskHistoryItems(items, { search: '产品参考' }).map((item) => item.task.id), ['task-b']);
});

test('mergeTaskHistoryPages deduplicates overlapping task pages', () => {
  const firstPage = [
    { task: task('task-a', {}), assets: [] },
    { task: task('task-b', {}), assets: [] },
  ];
  const secondPage = [
    { task: task('task-b', { status: 'failed' }), assets: [] },
    { task: task('task-c', {}), assets: [] },
  ];

  const merged = mergeTaskHistoryPages(firstPage, secondPage);
  assert.deepEqual(merged.map((item) => item.task.id), ['task-a', 'task-b', 'task-c']);
  assert.equal(merged[1].task.status, 'succeeded');
});

test('formatTaskHistoryPageSummary explains loaded and filtered task counts', () => {
  assert.equal(formatTaskHistoryPageSummary(20, 80, 200), '已加载 80/200 条任务');
  assert.equal(
    formatTaskHistoryPageSummary(3, 80, 200, { search: 'seedance' }),
    '3/80 条匹配，已加载 80/200'
  );
  assert.equal(
    formatTaskHistoryPageSummary(2, 80, 200, { status: 'failed' }),
    '2/80 条匹配，已加载 80/200'
  );
  assert.equal(formatTaskHistoryPageSummary(0, 10, 0), '已加载 10/10 条任务');
});
