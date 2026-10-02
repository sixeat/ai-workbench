// 真实供应商端到端验证（默认跳过）。
//
// 与其它测试不同：这个会**真的调用百炼**并产生费用，所以默认不跑。
// 需要显式提供凭据才会执行：
//
//   WORKBENCH_E2E_DASHSCOPE_KEY=sk-xxx \
//   WORKBENCH_E2E_DASHSCOPE_BASE=https://dashscope.aliyuncs.com \
//   node --test server/e2eDashscope.test.cjs
//
// 它验证的是单元测试覆盖不到的那一层：
// 真实 HTTP 接口 → 凭据链路 → 平台模型路由 → 后台 worker 推进 → 供应商真实出产物。
//
// 只在明确想验证集成时运行；CI 上应当跳过。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const API_KEY = String(process.env.WORKBENCH_E2E_DASHSCOPE_KEY || '').trim();
const BASE_URL = String(process.env.WORKBENCH_E2E_DASHSCOPE_BASE || 'https://dashscope.aliyuncs.com').trim();
const ENABLED = API_KEY.length > 0;

// 文本与图片都会真实计费，所以要点名开启
const RUN_IMAGE = process.env.WORKBENCH_E2E_IMAGE === 'true';

if (!ENABLED) {
  test('真实供应商端到端验证（未提供凭据，跳过）', { skip: 'set WORKBENCH_E2E_DASHSCOPE_KEY to enable' }, () => {});
} else {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-e2e-dashscope-'));
  const ADMIN_EMAIL = 'e2e-admin@example.com';
  const ADMIN_PASSWORD = 'E2eTestPassword-123';

  process.env.WORKBENCH_DEPLOYMENT_MODE = 'local';
  process.env.WORKBENCH_REQUIRE_LOGIN = 'false';
  process.env.WORKBENCH_ALLOW_PUBLIC_SERVER = 'true';
  process.env.WORKBENCH_SERVE_STATIC = 'false';
  process.env.WORKBENCH_START_WORKERS = 'true';
  process.env.WORKBENCH_SERVER_SIDE_RUNS = 'true';
  process.env.WORKBENCH_WORKFLOW_RUN_POLL_INTERVAL_MS = '500';
  process.env.WORKBENCH_KEY_SECRET = 'e2e-test-secret-0123456789abcdefghij';
  process.env.WORKBENCH_ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.WORKBENCH_ADMIN_PASSWORD = ADMIN_PASSWORD;
  process.env.WORKBENCH_ADMIN_NAME = 'E2E Admin';
  process.env.WORKBENCH_ALLOW_PUBLIC_REGISTRATION = 'false';
  process.env.WORKBENCH_DATA_DIR = path.join(dataDir, 'data');
  process.env.WORKBENCH_DB_PATH = path.join(dataDir, 'data', 'e2e.sqlite');
  process.env.IMAGE_OUTPUT_DIR = path.join(dataDir, 'outputs');

  const { createWorkbenchApp } = require('./app.cjs');
  const { workflowRepository } = require('./repositories/workflowRepository.cjs');
  const { taskRepository } = require('./repositories/taskRepository.cjs');
  const { db } = require('./db.cjs');

  test.after(() => {
    try { db.close(); } catch { /* 已关闭 */ }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function listen(app) {
    const server = http.createServer(app);
    return new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve({ baseUrl: `http://127.0.0.1:${server.address().port}`, server }));
      server.on('error', reject);
    });
  }

  async function closeServer(server) {
    await new Promise((resolve) => server.close(resolve));
  }

  async function waitForRun({ call, authed, runId, timeoutMs = 180_000 }) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const detail = await call('GET', `/api/workflow-runs/${runId}`, null, authed);
      const run = detail.body?.run;
      if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) {
        return { nodes: detail.body.nodes || [], run };
      }
    }
    throw new Error(`运行在 ${timeoutMs}ms 内未结束`);
  }

  test('真实调用百炼：凭据链路 → 平台模型 → 后台 worker → 真实产物', { timeout: 240_000 }, async () => {
    const runtime = createWorkbenchApp({ env: process.env, startWorkers: true });
    const { baseUrl, server } = await listen(runtime.app);

    const call = async (method, url, body, headers = {}) => {
      const response = await fetch(baseUrl + url, {
        method,
        headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* 保留原文 */ }
      return { status: response.status, body: parsed };
    };

    try {
      // 登录管理员：模型目录等接口检查 req.authUser.role
      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      });
      assert.equal(loginResponse.status, 200, '管理员登录应当成功');
      const cookie = (loginResponse.headers.getSetCookie?.() || []).map((item) => item.split(';')[0]).join('; ');
      const authed = { Cookie: cookie };

      const owner = (await call('GET', '/api/auth/me', null, authed)).body.user;
      await call('POST', '/api/admin/credits/adjust', {
        userId: owner.id, amount: 2000, description: 'e2e 额度',
      }, authed);

      // 凭据链路
      const created = await call('POST', '/api/api-keys', {
        providerId: 'aliyun-bailian',
        baseUrl: BASE_URL,
        apiKey: API_KEY,
        keyScope: 'server',
        name: 'e2e dashscope',
        models: ['qwen-plus'],
      }, authed);
      assert.equal(created.status, 201, 'should create the server key');
      const apiKeyId = created.body.apiKey.id;

      const discovered = await call('POST', `/api/api-keys/${apiKeyId}/models/discover`, null, authed);
      assert.equal(discovered.status, 200, 'model discovery should succeed');

      const list = (await call('GET', `/api/api-keys/${apiKeyId}/models?limit=200`, null, authed)).body.models || [];
      const chatRecord = list.find((model) => model.upstreamModel === 'qwen-plus');
      assert.ok(chatRecord, 'qwen-plus 应当被发现');
      assert.equal(chatRecord.adapterId, 'openai-chat', '对话模型应当解析出 openai-chat 适配器');

      // 新发现的模型默认是禁用的：管理员必须显式启用，才能挂到平台模型路由上。
      // 这是有意的安全设计，不是缺陷——测试要走完整的启用流程。
      const enableModel = async (record, label) => {
        if (record.isEnabled) return record;
        const patched = await call('PATCH', `/api/api-keys/${apiKeyId}/models/${record.id}`, {
          isEnabled: true,
        }, authed);
        assert.ok(patched.status < 300, `启用 ${label} 应当成功: ${JSON.stringify(patched.body).slice(0, 300)}`);
        return patched.body.model;
      };
      const enabledChatRecord = await enableModel(chatRecord, 'qwen-plus');

      const platformModel = await call('POST', '/api/admin/platform-models', {
        displayName: 'e2e qwen-plus',
        capability: 'chat',
        model: 'qwen-plus',
        isEnabled: true,
      }, authed);
      assert.equal(platformModel.status, 201);
      const chatPlatformModelId = platformModel.body.model.id;

      const route = await call('POST', `/api/admin/platform-models/${chatPlatformModelId}/routes`, {
        apiKeyId, apiKeyModelId: enabledChatRecord.id, upstreamModel: 'qwen-plus', providerId: 'aliyun-bailian', priority: 1,
      }, authed);
      assert.ok(route.status < 300, `建路由应当成功: ${JSON.stringify(route.body).slice(0, 200)}`);

      // 工作流：文本 → 提示词优化 → 预览（可选加图片节点）
      const nodes = [
        { id: 't1', type: 'textInput', position: { x: 0, y: 0 }, data: { label: '主题', type: 'textInput', config: { content: '一只橘猫在阳光下的窗台上打盹' } } },
        { id: 'p1', type: 'promptOptimize', position: { x: 200, y: 0 }, data: { label: '提示词优化', type: 'promptOptimize', config: { modelSource: 'platform', platformModelId: chatPlatformModelId, maxTokens: 200 } } },
        { id: 'o1', type: 'preview', position: { x: 400, y: 0 }, data: { label: '预览', type: 'preview', config: {} } },
      ];
      const edges = [
        { id: 'e1', source: 't1', target: 'p1', data: { targetKey: 'content' } },
        { id: 'e2', source: 'p1', target: 'o1', data: { targetKey: 'content' } },
      ];

      const workflow = workflowRepository.upsertWorkflow({
        userId: owner.id, name: 'e2e', description: '', nodes, edges,
      });

      const submitted = await call('POST', '/api/workflow-runs', { workflowId: workflow.id, idempotencyKey: 'e2e-1' }, authed);
      assert.equal(submitted.status, 201, '提交运行应当成功');
      const runId = submitted.body.run.id;

      const { run, nodes: runNodes } = await waitForRun({ call, authed, runId });

      // 运行应当成功，且每个节点都有产物
      assert.equal(run.status, 'succeeded', `运行应当成功，实际 ${run.status}: ${JSON.stringify(run.error || {})}`);
      assert.equal(run.finishedNodes, nodes.length);
      for (const node of runNodes) {
        assert.equal(node.status, 'succeeded', `节点 ${node.nodeId} 应当成功`);
      }

      // 关键断言：下游拿到的提示词必须是语义文本，不能是整包上游响应
      const textNode = runNodes.find((node) => node.nodeId === 't1');
      assert.equal(textNode.output.text, '一只橘猫在阳光下的窗台上打盹');

      const optimizeNode = runNodes.find((node) => node.nodeId === 'p1');
      assert.ok(optimizeNode.output, '提示词优化节点应当有产物');

      // 图片链路（需显式开启，因为会额外计费）
      if (RUN_IMAGE) {
        const imageRecord = list.find((model) => model.upstreamModel === 'wan2.7-image');
        assert.ok(imageRecord, 'wan2.7-image 应当被发现');
        assert.equal(imageRecord.adapterId, 'dashscope-image', '图片模型应当解析出 dashscope-image 适配器');
        // 发现后默认禁用，必须先启用才能建路由
        const enabledImageRecord = await enableModel(imageRecord, 'wan2.7-image');
        assert.equal(enabledImageRecord.isEnabled, true, '启用后图片模型应当可用');

        const imagePlatformModel = await call('POST', '/api/admin/platform-models', {
          displayName: 'e2e wan2.7-image', capability: 'imageGeneration', model: 'wan2.7-image', isEnabled: true,
        }, authed);
        // 必须断言创建成功：否则 id 会是 undefined 被静默带下去，
        // 最终只在下游表现为 "Platform model is not available."
        assert.equal(
          imagePlatformModel.status,
          201,
          `建图片平台模型应当成功: ${JSON.stringify(imagePlatformModel.body).slice(0, 400)}`
        );
        const imagePlatformModelId = imagePlatformModel.body.model.id;
        assert.ok(imagePlatformModelId, '应当返回平台模型 id');
        assert.equal(imagePlatformModel.body.model.isEnabled, true, '平台模型应当处于启用状态');

        const imageRoute = await call('POST', `/api/admin/platform-models/${imagePlatformModelId}/routes`, {
          apiKeyId, apiKeyModelId: enabledImageRecord.id, upstreamModel: 'wan2.7-image', providerId: 'aliyun-bailian', priority: 1,
        }, authed);
        assert.ok(
          imageRoute.status < 300,
          `建图片路由应当成功: ${JSON.stringify(imageRoute.body).slice(0, 400)}`
        );

        const imageWorkflow = workflowRepository.upsertWorkflow({
          userId: owner.id,
          name: 'e2e image',
          description: '',
          nodes: [
            ...nodes.slice(0, 2),
            { id: 'i1', type: 'imageGen', position: { x: 300, y: 0 }, data: { label: '图片生成', type: 'imageGen', config: { platformModelId: imagePlatformModelId, n: 1 } } },
            { id: 'o2', type: 'preview', position: { x: 500, y: 0 }, data: { label: '预览', type: 'preview', config: {} } },
          ],
          edges: [
            edges[0],
            { id: 'e2', source: 'p1', target: 'i1', data: { targetKey: 'prompt' } },
            { id: 'e3', source: 'i1', target: 'o2', data: { targetKey: 'content' } },
          ],
        });

        const imageSubmitted = await call('POST', '/api/workflow-runs', { workflowId: imageWorkflow.id, idempotencyKey: 'e2e-2' }, authed);
        assert.equal(imageSubmitted.status, 201, `提交图片运行失败: ${JSON.stringify(imageSubmitted.body).slice(0, 300)}`);
        const imageRunId = imageSubmitted.body.run.id;
        const imageResult = await waitForRun({ call, authed, runId: imageRunId });

        // 失败时把节点级错误一并带出来，否则只看到"某节点失败"没法定位
        const nodeErrors = imageResult.nodes
          .filter((node) => node.status !== 'succeeded')
          .map((node) => `${node.nodeId}(${node.nodeType}): ${JSON.stringify(node.error)}`)
          .join('; ');
        assert.equal(
          imageResult.run.status,
          'succeeded',
          `图片运行应当成功: ${JSON.stringify(imageResult.run.error || {})} | 节点错误: ${nodeErrors}`
        );
        assert.ok(imageResult.run.output?.assets?.length > 0, '运行产物里应当有成片资产');

        // 上游文本必须干净地传进图片提示词：不能夹带响应 ID 或 JSON 括号
        const imageNode = imageResult.nodes.find((node) => node.nodeId === 'i1');
        const assetRecord = taskRepository.getTask(imageNode.taskId);
        const usedPrompt = String(assetRecord?.input?.prompt || '');
        assert.ok(usedPrompt.length > 0, '图片任务应当有提示词');
        assert.equal(usedPrompt.includes('chatcmpl'), false, '提示词不应夹带响应 ID');
        assert.equal(usedPrompt.includes('"choices"'), false, '提示词不应夹带响应 JSON');
        assert.equal(usedPrompt.includes('"usage"'), false, '提示词不应夹带用量信息');
      }
    } finally {
      await runtime.stop();
      await closeServer(server);
    }
  });
}
