const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.join(__dirname, '..');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function createFakeWorkbenchUpstream() {
  const requests = {
    chat: [],
    image: [],
    videoCreate: [],
    videoQuery: [],
    videoDownload: [],
  };
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;

    if (req.method === 'POST' && pathname === '/v1/chat/completions') {
      const body = await readJsonBody(req);
      requests.chat.push({
        authorization: req.headers.authorization,
        body,
        url: req.url,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-split-process',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'split worker ok',
            },
          },
        ],
      }));
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/images/generations') {
      const body = await readJsonBody(req);
      requests.image.push({
        authorization: req.headers.authorization,
        body,
        url: req.url,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          {
            b64_json: Buffer.from('split image bytes').toString('base64'),
          },
        ],
      }));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/v3/contents/generations/tasks') {
      const body = await readJsonBody(req);
      requests.videoCreate.push({
        authorization: req.headers.authorization,
        body,
        url: req.url,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'split-video-upstream-task',
        status: 'queued',
      }));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/v3/contents/generations/tasks/split-video-upstream-task') {
      requests.videoQuery.push({
        authorization: req.headers.authorization,
        url: req.url,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'split-video-upstream-task',
        status: 'succeeded',
        output_video: `http://${req.headers.host}/generated/split-video.mp4`,
      }));
      return;
    }

    if (req.method === 'GET' && pathname === '/generated/split-video.mp4') {
      requests.videoDownload.push({ url: req.url });
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(Buffer.from('split video bytes'));
      return;
    }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
  });

  return {
    requests,
    server,
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    server.on('error', reject);
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function spawnNode(script, env) {
  const child = spawn(process.execPath, [script], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString('utf8')));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString('utf8')));
  child.logs = logs;
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitFor(predicate, options = {}) {
  const timeoutMs = options.timeoutMs || 5000;
  const intervalMs = options.intervalMs || 50;
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw lastError || new Error('Timed out waiting for condition.');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  return {
    data,
    status: response.status,
  };
}

test('split api and worker processes share the database and complete queued text image and video tasks', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-split-process-test-'));
  const apiPort = await getFreePort();
  const upstream = createFakeWorkbenchUpstream();
  const upstreamPort = await listen(upstream.server);
  const upstreamBaseUrl = `http://127.0.0.1:${upstreamPort}`;
  const sharedEnv = {
    IMAGE_OUTPUT_DIR: path.join(tempDir, 'outputs'),
    PROXY_HOST: '127.0.0.1',
    WORKBENCH_ALLOW_PRIVATE_MEDIA_FETCH: 'true',
    WORKBENCH_ACCESS_TOKEN: '',
    WORKBENCH_ADMIN_TOKEN: '',
    WORKBENCH_DATA_DIR: tempDir,
    WORKBENCH_DB_PATH: path.join(tempDir, 'test.sqlite'),
    WORKBENCH_DEPLOYMENT_MODE: 'local',
    WORKBENCH_KEY_SECRET: 'split-process-test-secret',
    WORKBENCH_REQUIRE_LOGIN: 'false',
    WORKBENCH_SERVER_API_KEY: 'split-process-key',
    WORKBENCH_SERVER_BASE_URL: upstreamBaseUrl,
    WORKBENCH_SERVE_STATIC: 'false',
    WORKBENCH_TASK_QUEUE_POLL_INTERVAL_MS: '50',
  };
  let apiProcess = null;
  let workerProcess = null;

  try {
    apiProcess = spawnNode('server/api.cjs', {
      ...sharedEnv,
      PROXY_PORT: String(apiPort),
    });

    const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
    await waitFor(async () => {
      const response = await fetch(`${apiBaseUrl}/api/health`);
      return response.ok;
    }, { timeoutMs: 8000 });

    workerProcess = spawnNode('server/worker.cjs', sharedEnv);
    await waitFor(() => workerProcess.logs.join('').includes('AI Workbench Worker'), {
      timeoutMs: 8000,
    });

    const savedApiKey = await fetchJson(`${apiBaseUrl}/api/api-keys`, {
      method: 'POST',
      body: JSON.stringify({
        apiKey: 'split-process-key',
        baseUrl: upstreamBaseUrl,
        name: 'Split Process Key',
        providerId: 'seedance',
      }),
    });
    assert.equal(savedApiKey.status, 201);
    assert.ok(savedApiKey.data.apiKey?.id);

    const created = await fetchJson(`${apiBaseUrl}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-split-process',
        messages: [{ role: 'user', content: 'hello split worker' }],
        providerId: 'openai-compatible',
      }),
    });
    assert.equal(created.status, 202);
    assert.equal(created.data.status, 'queued');
    assert.ok(created.data.taskId);

    const completed = await waitFor(async () => {
      const result = await fetchJson(`${apiBaseUrl}/api/tasks/${encodeURIComponent(created.data.taskId)}`);
      if (result.data.task?.status === 'succeeded') return result.data.task;
      return null;
    }, { timeoutMs: 8000 });

    assert.equal(completed.output.choices[0].message.content, 'split worker ok');
    assert.equal(upstream.requests.chat.length, 1);
    assert.equal(upstream.requests.chat[0].authorization, 'Bearer split-process-key');
    assert.equal(upstream.requests.chat[0].body.model, 'gpt-split-process');
    assert.equal(upstream.requests.chat[0].body.apiKey, undefined);
    assert.equal(upstream.requests.chat[0].body.baseUrl, undefined);

    const imageCreated = await fetchJson(`${apiBaseUrl}/api/images`, {
      method: 'POST',
      body: JSON.stringify({
        apiKeyId: savedApiKey.data.apiKey.id,
        model: 'gpt-image-1',
        n: 1,
        prompt: 'paint split process image',
        providerId: 'openai-compatible',
        quality: 'auto',
        response_format: 'b64_json',
        size: '1024x1024',
      }),
    });
    assert.equal(imageCreated.status, 202);
    assert.equal(imageCreated.data.status, 'queued');

    const imageCompleted = await waitFor(async () => {
      const result = await fetchJson(`${apiBaseUrl}/api/tasks/${encodeURIComponent(imageCreated.data.taskId)}`);
      if (result.data.task?.status === 'succeeded') return result.data.task;
      return null;
    }, { timeoutMs: 8000 });

    assert.equal(imageCompleted.output[0].type, 'image');
    assert.ok(imageCompleted.output[0].id);
    assert.equal(upstream.requests.image.length, 1);
    assert.equal(upstream.requests.image[0].authorization, 'Bearer split-process-key');
    assert.equal(upstream.requests.image[0].body.model, 'gpt-image-1');
    assert.equal(upstream.requests.image[0].body.prompt, 'paint split process image');
    assert.equal(upstream.requests.image[0].body.apiKeyId, undefined);
    assert.equal(upstream.requests.image[0].body.baseUrl, undefined);

    const assetResponse = await fetch(`${apiBaseUrl}${imageCompleted.output[0].url}`);
    assert.equal(assetResponse.status, 200);
    assert.equal(Buffer.from(await assetResponse.arrayBuffer()).toString('utf8'), 'split image bytes');

    const videoCreated = await fetchJson(`${apiBaseUrl}/api/videos`, {
      method: 'POST',
      body: JSON.stringify({
        apiKeyId: savedApiKey.data.apiKey.id,
        duration: 5,
        model: 'doubao-seedance-2-0-mini-260615',
        prompt: 'make split process video',
        providerId: 'seedance',
        ratio: '16:9',
        resolution: '720P',
        watermark: false,
      }),
    });
    assert.equal(videoCreated.status, 202);
    assert.equal(videoCreated.data.status, 'queued');

    const videoSubmitted = await waitFor(async () => {
      const result = await fetchJson(`${apiBaseUrl}/api/tasks/${encodeURIComponent(videoCreated.data.taskId)}`);
      if (result.data.task?.status === 'running' && result.data.task?.output?.upstream?.taskId) return result.data.task;
      return null;
    }, { timeoutMs: 8000 });

    assert.equal(videoSubmitted.output.upstream.taskId, 'split-video-upstream-task');
    assert.equal(upstream.requests.videoCreate.length, 1);
    assert.equal(upstream.requests.videoCreate[0].authorization, 'Bearer split-process-key');
    assert.equal(upstream.requests.videoCreate[0].body.model, 'doubao-seedance-2-0-mini-260615');
    assert.equal(upstream.requests.videoCreate[0].body.duration, 5);
    assert.equal(upstream.requests.videoCreate[0].body.content[0].text, 'make split process video');

    const videoLookup = await fetchJson(`${apiBaseUrl}/api/videos/${encodeURIComponent(videoCreated.data.taskId)}`);
    assert.equal(videoLookup.status, 200);
    assert.equal(videoLookup.data.task.status, 'succeeded');
    assert.equal(videoLookup.data.asset.type, 'video');
    assert.equal(upstream.requests.videoQuery.length, 1);
    assert.equal(upstream.requests.videoDownload.length, 1);

    const videoAssetResponse = await fetch(`${apiBaseUrl}${videoLookup.data.asset.url}`);
    assert.equal(videoAssetResponse.status, 200);
    assert.equal(Buffer.from(await videoAssetResponse.arrayBuffer()).toString('utf8'), 'split video bytes');
  } catch (error) {
    const logs = [
      apiProcess ? `API logs:\n${apiProcess.logs.join('')}` : '',
      workerProcess ? `Worker logs:\n${workerProcess.logs.join('')}` : '',
    ].filter(Boolean).join('\n');
    error.message = `${error.message}\n${logs}`;
    throw error;
  } finally {
    await stopChild(workerProcess);
    await stopChild(apiProcess);
    await closeServer(upstream.server);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
