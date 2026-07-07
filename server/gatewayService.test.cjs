const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const test = require('node:test');

const {
  createApiGateway,
  createGatewayRequestLogger,
  gatewayForwardHeaders,
  gatewayRouteForPath,
  requestLogEnabled,
  resolveGatewayUpstreams,
} = require('./services/gatewayService.cjs');

function authRepositoryStub() {
  return {
    deleteExpiredSessions() {},
    deleteSessionByTokenHash() {},
    getSessionByTokenHash() {
      return null;
    },
  };
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        server,
      });
    });
    server.on('error', reject);
  });
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function withGatewayApp(gatewayOptions, registerRoutes, fn) {
  const app = express();
  const gateway = createApiGateway({
    accessToken: '',
    authRepository: authRepositoryStub(),
    corsOrigin: 'https://workbench.example.com',
    env: {},
    rateLimits: {
      expensive: 1,
      proxy: 1,
      upload: 1,
      windowMs: 60_000,
    },
    requireLogin: false,
    sessionCookieOptions: {},
    trustForwardedFor: false,
    uploadLimits: {
      uploadBodyLimitMb: 1,
    },
    ...gatewayOptions,
  });

  gateway.registerBeforeRoutes(app);
  registerRoutes?.(app);
  gateway.registerAfterRoutes(app);

  const { baseUrl, server } = await listen(app);
  try {
    return await fn({ baseUrl, gateway });
  } finally {
    await closeServer(server);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return {
    data,
    headers: response.headers,
    status: response.status,
  };
}

test('gateway route table maps public API paths to future service boundaries', () => {
  assert.equal(gatewayRouteForPath('/api/auth/login')?.service, 'auth-service');
  assert.equal(gatewayRouteForPath('/api/tasks/task-1')?.service, 'worker-service');
  assert.equal(gatewayRouteForPath('/api/assets/asset-1')?.service, 'asset-service');
  assert.equal(gatewayRouteForPath('/api/api-keys')?.service, 'model-service');
  assert.equal(gatewayRouteForPath('/api/asset-collections')?.service, 'asset-service');
  assert.equal(gatewayRouteForPath('/api/chat')?.service, 'model-service');
  assert.equal(gatewayRouteForPath('/api/workflows/workflow-1')?.service, 'workflow-service');
  assert.equal(gatewayRouteForPath('/api/models')?.service, 'model-service');
  assert.equal(gatewayRouteForPath('/api/model-capabilities/resolve')?.service, 'model-service');
  assert.equal(gatewayRouteForPath('/api/providers')?.service, 'model-service');
  assert.equal(gatewayRouteForPath('/api/images', 'POST')?.service, 'worker-service');
  assert.equal(gatewayRouteForPath('/api/images/image-1', 'GET')?.service, 'asset-service');
  assert.equal(gatewayRouteForPath('/api/unknown'), null);
});

test('gateway request log switch accepts either gateway env name', () => {
  assert.equal(requestLogEnabled({}), false);
  assert.equal(requestLogEnabled({ WORKBENCH_REQUEST_LOGS: 'true' }), true);
  assert.equal(requestLogEnabled({ WORKBENCH_GATEWAY_REQUEST_LOGS: '1' }), true);
});

test('gateway upstream config accepts service origins only', () => {
  const upstreams = resolveGatewayUpstreams({
    WORKBENCH_GATEWAY_ASSET_URL: 'http://127.0.0.1:4100/',
    WORKBENCH_GATEWAY_AUTH_URL: '',
    WORKBENCH_GATEWAY_MODEL_URL: 'https://model.internal.example',
  });

  assert.deepEqual(upstreams, {
    asset: 'http://127.0.0.1:4100',
    model: 'https://model.internal.example',
  });
  assert.throws(() => resolveGatewayUpstreams({
    WORKBENCH_GATEWAY_WORKER_URL: 'https://worker.internal.example/api',
  }), /origin only/);
});

test('gateway forwarding headers strip public credentials and keep internal identity', () => {
  const headers = gatewayForwardHeaders({
    authSession: { id: 'session-1' },
    authUser: { id: 'user-1', role: 'admin' },
    gateway: { requestId: 'request-1' },
    headers: {
      authorization: 'Bearer public-token',
      cookie: 'ai_workbench_session=secret',
      'content-type': 'application/json',
      host: 'public.example.com',
      'x-workbench-internal-token': 'spoofed-internal-token',
      'x-workbench-request-id': 'spoofed-request',
      'x-workbench-session-id': 'spoofed-session',
      'x-workbench-token': 'legacy-token',
      'x-workbench-user-id': 'spoofed-user',
      'x-workbench-user-role': 'spoofed-admin',
    },
  }, {
    internalServiceToken: 'internal-token',
  });

  assert.equal(headers.authorization, undefined);
  assert.equal(headers.cookie, undefined);
  assert.equal(headers.host, undefined);
  assert.equal(headers['x-workbench-token'], undefined);
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(headers['x-workbench-request-id'], 'request-1');
  assert.equal(headers['x-workbench-user-id'], 'user-1');
  assert.equal(headers['x-workbench-user-role'], 'admin');
  assert.equal(headers['x-workbench-session-id'], 'session-1');
  assert.equal(headers['x-workbench-internal-token'], 'internal-token');

  const authHeaders = gatewayForwardHeaders({
    headers: {
      authorization: 'Bearer public-token',
      cookie: 'ai_workbench_session=secret',
      host: 'public.example.com',
      'x-workbench-token': 'legacy-token',
    },
  }, {
    internalServiceToken: 'internal-token',
    preserveCookie: true,
  });
  assert.equal(authHeaders.authorization, undefined);
  assert.equal(authHeaders.cookie, 'ai_workbench_session=secret');
  assert.equal(authHeaders.host, undefined);
  assert.equal(authHeaders['x-workbench-token'], undefined);
  assert.equal(authHeaders['x-workbench-internal-token'], 'internal-token');
});

test('gateway request logger adds request id and logs service route metadata', async () => {
  const entries = [];
  const app = express();
  app.use(createGatewayRequestLogger({
    enabled: true,
    idFactory: () => 'request-1',
    logger: {
      info(event, data) {
        entries.push({ data, event });
      },
    },
    now: (() => {
      let value = 100;
      return () => {
        value += 25;
        return value;
      };
    })(),
  }));
  app.get('/api/tasks/task-1', (_req, res) => {
    res.json({ ok: true });
  });

  const { baseUrl, server } = await listen(app);
  try {
    const response = await fetch(`${baseUrl}/api/tasks/task-1?apiKey=secret`);
    assert.equal(response.headers.get('x-request-id'), 'request-1');
    assert.equal(response.status, 200);
  } finally {
    await closeServer(server);
  }

  assert.equal(entries.length, 1);
  assert.equal(entries[0].event, 'gateway.request');
  assert.equal(entries[0].data.path, '/api/tasks/task-1');
  assert.equal(entries[0].data.service, 'worker-service');
  assert.equal(entries[0].data.route, 'tasks');
});

test('api gateway applies CORS and returns stable API 404 payloads', async () => {
  await withGatewayApp({}, null, async ({ baseUrl }) => {
    const response = await fetchJson(`${baseUrl}/api/missing`, {
      headers: {
        Origin: 'https://workbench.example.com',
      },
    });

    assert.equal(response.status, 404);
    assert.deepEqual(response.data, { error: 'API route not found.' });
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://workbench.example.com');
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  });
});

test('api gateway protects routes before handlers run', async () => {
  await withGatewayApp({
    accessToken: 'shared-secret',
    requireLogin: false,
  }, (app) => {
    app.get('/api/tasks', (_req, res) => res.json({ ok: true }));
  }, async ({ baseUrl }) => {
    const rejected = await fetchJson(`${baseUrl}/api/tasks`);
    assert.equal(rejected.status, 401);
    assert.deepEqual(rejected.data, { error: 'Access token is required.' });

    const accepted = await fetchJson(`${baseUrl}/api/tasks`, {
      headers: {
        Authorization: 'Bearer shared-secret',
      },
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.data, { ok: true });
  });
});

test('api gateway applies expensive route rate limits', async () => {
  await withGatewayApp({}, (app) => {
    app.post('/api/chat', (_req, res) => res.json({ ok: true }));
  }, async ({ baseUrl }) => {
    const first = await fetchJson(`${baseUrl}/api/chat`, { method: 'POST' });
    const second = await fetchJson(`${baseUrl}/api/chat`, { method: 'POST' });

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(second.data.error, 'Too many generation requests. Please try again later.');
  });
});

test('api gateway normalizes thrown API errors', async () => {
  await withGatewayApp({}, (app) => {
    app.get('/api/tasks/explode', () => {
      throw Object.assign(new Error('Visible task error.'), {
        expose: true,
        status: 418,
      });
    });
  }, async ({ baseUrl }) => {
    const response = await fetchJson(`${baseUrl}/api/tasks/explode`);
    assert.equal(response.status, 418);
    assert.deepEqual(response.data, { error: 'Visible task error.' });
  });
});

test('api gateway falls back to monolith routes when no upstream is configured', async () => {
  await withGatewayApp({}, (app) => {
    app.get('/api/tasks', (_req, res) => res.json({ source: 'monolith' }));
  }, async ({ baseUrl, gateway }) => {
    assert.deepEqual(gateway.upstreams, {});

    const response = await fetchJson(`${baseUrl}/api/tasks`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.data, { source: 'monolith' });
  });
});

test('api gateway forwards configured service routes before monolith handlers', async () => {
  const upstreamRequests = [];
  const upstreamApp = express();
  upstreamApp.use(express.text({ type: '*/*' }));
  upstreamApp.post('/api/tasks', (req, res) => {
    upstreamRequests.push({
      authorization: req.headers.authorization || '',
      body: req.body,
      cookie: req.headers.cookie || '',
      path: req.originalUrl,
      requestId: req.headers['x-workbench-request-id'] || '',
      serviceToken: req.headers['x-workbench-internal-token'] || '',
      token: req.headers['x-workbench-token'] || '',
    });
    res.status(202).json({ source: 'worker-service' });
  });
  const { baseUrl: upstreamBaseUrl, server: upstreamServer } = await listen(upstreamApp);

  try {
    await withGatewayApp({
      env: {
        WORKBENCH_INTERNAL_SERVICE_TOKEN: 'internal-token',
        WORKBENCH_GATEWAY_REQUEST_LOGS: 'true',
      },
      logger: {
        info() {},
      },
      upstreams: {
        worker: upstreamBaseUrl,
      },
    }, (app) => {
      app.post('/api/tasks', (_req, res) => res.status(500).json({ source: 'monolith' }));
    }, async ({ baseUrl }) => {
      const response = await fetchJson(`${baseUrl}/api/tasks?from=gateway`, {
        body: JSON.stringify({ hello: 'worker' }),
        headers: {
          Authorization: 'Bearer public-token',
          Cookie: 'ai_workbench_session=secret',
          'Content-Type': 'application/json',
          'x-workbench-internal-token': 'spoofed-token',
          'x-workbench-user-id': 'spoofed-user',
          'x-workbench-token': 'legacy-token',
        },
        method: 'POST',
      });

      assert.equal(response.status, 202);
      assert.deepEqual(response.data, { source: 'worker-service' });
    });
  } finally {
    await closeServer(upstreamServer);
  }

  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0].path, '/api/tasks?from=gateway');
  assert.equal(upstreamRequests[0].body, '{"hello":"worker"}');
  assert.equal(upstreamRequests[0].authorization, '');
  assert.equal(upstreamRequests[0].cookie, '');
  assert.equal(upstreamRequests[0].token, '');
  assert.equal(upstreamRequests[0].serviceToken, 'internal-token');
  assert.ok(upstreamRequests[0].requestId);
});

test('api gateway forwards cookies only to auth-service upstreams', async () => {
  const authRequests = [];
  const modelRequests = [];
  const authApp = express();
  authApp.get('/api/auth/me', (req, res) => {
    authRequests.push({
      authorization: req.headers.authorization || '',
      cookie: req.headers.cookie || '',
      serviceToken: req.headers['x-workbench-internal-token'] || '',
      token: req.headers['x-workbench-token'] || '',
    });
    res.json({ source: 'auth-service' });
  });
  const modelApp = express();
  modelApp.post('/api/models', (req, res) => {
    modelRequests.push({
      authorization: req.headers.authorization || '',
      cookie: req.headers.cookie || '',
      serviceToken: req.headers['x-workbench-internal-token'] || '',
      token: req.headers['x-workbench-token'] || '',
    });
    res.json({ source: 'model-service' });
  });

  const { baseUrl: authBaseUrl, server: authServer } = await listen(authApp);
  const { baseUrl: modelBaseUrl, server: modelServer } = await listen(modelApp);

  try {
    await withGatewayApp({
      env: {
        WORKBENCH_INTERNAL_SERVICE_TOKEN: 'internal-token',
      },
      upstreams: {
        auth: authBaseUrl,
        model: modelBaseUrl,
      },
    }, null, async ({ baseUrl }) => {
      const commonHeaders = {
        Authorization: 'Bearer public-token',
        Cookie: 'ai_workbench_session=secret',
        'x-workbench-token': 'legacy-token',
      };
      const authResponse = await fetchJson(`${baseUrl}/api/auth/me`, {
        headers: commonHeaders,
      });
      const modelResponse = await fetchJson(`${baseUrl}/api/models`, {
        headers: commonHeaders,
        method: 'POST',
      });

      assert.equal(authResponse.status, 200);
      assert.deepEqual(authResponse.data, { source: 'auth-service' });
      assert.equal(modelResponse.status, 200);
      assert.deepEqual(modelResponse.data, { source: 'model-service' });
    });
  } finally {
    await closeServer(authServer);
    await closeServer(modelServer);
  }

  assert.equal(authRequests.length, 1);
  assert.equal(authRequests[0].cookie, 'ai_workbench_session=secret');
  assert.equal(authRequests[0].authorization, '');
  assert.equal(authRequests[0].token, '');
  assert.equal(authRequests[0].serviceToken, 'internal-token');
  assert.equal(modelRequests.length, 1);
  assert.equal(modelRequests[0].cookie, '');
  assert.equal(modelRequests[0].authorization, '');
  assert.equal(modelRequests[0].token, '');
  assert.equal(modelRequests[0].serviceToken, 'internal-token');
});

test('api gateway can split image reads and image generation by HTTP method', async () => {
  const assetRequests = [];
  const workerRequests = [];
  const assetApp = express();
  assetApp.get('/api/images/:imageId', (req, res) => {
    assetRequests.push({ imageId: req.params.imageId, path: req.originalUrl });
    res.json({ source: 'asset-service' });
  });
  assetApp.get('/api/asset-collections', (req, res) => {
    assetRequests.push({ path: req.originalUrl });
    res.json({ source: 'asset-service', type: 'collections' });
  });
  const workerApp = express();
  workerApp.use(express.text({ type: '*/*' }));
  workerApp.post('/api/images', (req, res) => {
    workerRequests.push({ body: req.body, path: req.originalUrl });
    res.status(202).json({ source: 'worker-service' });
  });

  const { baseUrl: assetBaseUrl, server: assetServer } = await listen(assetApp);
  const { baseUrl: workerBaseUrl, server: workerServer } = await listen(workerApp);

  try {
    await withGatewayApp({
      rateLimits: {
        expensive: 10,
        proxy: 10,
        upload: 10,
        windowMs: 60_000,
      },
      upstreams: {
        asset: assetBaseUrl,
        worker: workerBaseUrl,
      },
    }, (app) => {
      app.get('/api/images/:imageId', (_req, res) => res.status(500).json({ source: 'monolith' }));
      app.post('/api/images', (_req, res) => res.status(500).json({ source: 'monolith' }));
    }, async ({ baseUrl }) => {
      const imageRead = await fetchJson(`${baseUrl}/api/images/image-1`);
      const imageGeneration = await fetchJson(`${baseUrl}/api/images`, {
        body: JSON.stringify({ prompt: 'generate image' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const collections = await fetchJson(`${baseUrl}/api/asset-collections`);

      assert.equal(imageRead.status, 200);
      assert.deepEqual(imageRead.data, { source: 'asset-service' });
      assert.equal(imageGeneration.status, 202);
      assert.deepEqual(imageGeneration.data, { source: 'worker-service' });
      assert.equal(collections.status, 200);
      assert.deepEqual(collections.data, { source: 'asset-service', type: 'collections' });
    });
  } finally {
    await closeServer(assetServer);
    await closeServer(workerServer);
  }

  assert.deepEqual(assetRequests.map((item) => item.path), ['/api/images/image-1', '/api/asset-collections']);
  assert.deepEqual(workerRequests.map((item) => item.path), ['/api/images']);
});
