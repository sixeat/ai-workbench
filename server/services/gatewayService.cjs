const cors = require('cors');
const express = require('express');
const { randomUUID } = require('node:crypto');
const { createApiAuthMiddleware } = require('./apiAuthMiddlewareService.cjs');
const { createRateLimitFactory } = require('./rateLimitService.cjs');
const { fetchWithTimeout } = require('./networkGuard.cjs');
const { createSecurityHeadersMiddleware } = require('./securityHeadersService.cjs');
const { createSessionMiddleware } = require('./sessionMiddlewareService.cjs');
const { sendSafeError } = require('../httpErrors.cjs');
const { parseBoolean } = require('../security.cjs');

const GATEWAY_ROUTE_TABLE = Object.freeze([
  { prefix: '/api/auth', service: 'auth-service', module: 'auth', upstreamKey: 'auth' },
  { prefix: '/api/tasks', service: 'worker-service', module: 'tasks', upstreamKey: 'worker' },
  { prefix: '/api/assets', service: 'asset-service', module: 'assets', upstreamKey: 'asset' },
  { prefix: '/api/asset-collections', service: 'asset-service', module: 'assets', upstreamKey: 'asset' },
  { prefix: '/api/asset-collection-templates', service: 'asset-service', module: 'assets', upstreamKey: 'asset' },
  { prefix: '/api/images', service: 'worker-service', module: 'generation', upstreamKey: 'worker', methods: ['POST'] },
  { prefix: '/api/images', service: 'asset-service', module: 'assets', upstreamKey: 'asset', methods: ['GET'] },
  { prefix: '/api/videos', service: 'worker-service', module: 'generation', upstreamKey: 'worker' },
  { prefix: '/api/workflows', service: 'workflow-service', module: 'workflows', upstreamKey: 'workflow' },
  { prefix: '/api/models', service: 'model-service', module: 'models', upstreamKey: 'model' },
  { prefix: '/api/model-capabilities', service: 'model-service', module: 'modelCapabilities', upstreamKey: 'model' },
  { prefix: '/api/model-capability-presets', service: 'model-service', module: 'modelCapabilities', upstreamKey: 'model' },
  { prefix: '/api/providers', service: 'model-service', module: 'providers', upstreamKey: 'model' },
  { prefix: '/api/api-keys', service: 'model-service', module: 'apiKeys', upstreamKey: 'model' },
  { prefix: '/api/chat', service: 'model-service', module: 'generation', upstreamKey: 'model' },
  { prefix: '/api/claude', service: 'model-service', module: 'generation', upstreamKey: 'model' },
  { prefix: '/api/proxy', service: 'model-service', module: 'proxy', upstreamKey: 'model' },
  { prefix: '/api/admin/health', service: 'admin-gateway', module: 'health' },
  { prefix: '/api/health', service: 'gateway', module: 'health' },
]);

const GATEWAY_UPSTREAM_ENV = Object.freeze({
  asset: 'WORKBENCH_GATEWAY_ASSET_URL',
  auth: 'WORKBENCH_GATEWAY_AUTH_URL',
  model: 'WORKBENCH_GATEWAY_MODEL_URL',
  worker: 'WORKBENCH_GATEWAY_WORKER_URL',
  workflow: 'WORKBENCH_GATEWAY_WORKFLOW_URL',
});

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const PUBLIC_CREDENTIAL_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-workbench-admin-token',
  'x-workbench-token',
]);

const INTERNAL_CONTEXT_HEADERS = new Set([
  'x-workbench-internal-token',
  'x-workbench-request-id',
  'x-workbench-session-id',
  'x-workbench-user-id',
  'x-workbench-user-role',
]);

function routeSupportsMethod(route, method) {
  if (!route?.methods || route.methods.length === 0 || !method) return true;
  return route.methods.includes(String(method).toUpperCase());
}

function gatewayRouteForPath(pathname = '', method) {
  const normalized = String(pathname || '').split('?')[0].replace(/\/+$/, '') || '/';
  return GATEWAY_ROUTE_TABLE.find((route) =>
    routeSupportsMethod(route, method) &&
    (normalized === route.prefix || normalized.startsWith(`${route.prefix}/`))
  ) || null;
}

function requestLogEnabled(env = process.env) {
  return parseBoolean(env.WORKBENCH_REQUEST_LOGS || env.WORKBENCH_GATEWAY_REQUEST_LOGS, false);
}

function normalizeGatewayUpstreamUrl(value, envName) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${envName} must be a valid http or https origin.`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${envName} must use http or https.`);
  }

  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${envName} must be an origin only. Do not include paths, query strings, or hashes.`);
  }

  return parsed.origin;
}

function resolveGatewayUpstreams(env = process.env) {
  return Object.fromEntries(
    Object.entries(GATEWAY_UPSTREAM_ENV)
      .map(([key, envName]) => [key, normalizeGatewayUpstreamUrl(env[envName], envName)])
      .filter(([, value]) => Boolean(value))
  );
}

function safeRequestPath(req) {
  const raw = req.originalUrl || req.url || '';
  return String(raw).split('?')[0] || req.path || '/';
}

function createGatewayRequestLogger(options = {}) {
  const {
    enabled = false,
    idFactory = randomUUID,
    logger = console,
    now = () => Date.now(),
  } = options;

  return (req, res, next) => {
    if (!enabled) return next();

    const startedAt = now();
    const requestId = String(req.headers['x-request-id'] || idFactory());
    req.gateway = {
      ...(req.gateway || {}),
      requestId,
      startedAt,
      route: gatewayRouteForPath(req.originalUrl || req.url || req.path || '', req.method),
    };
    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
      logger.info?.('gateway.request', {
        durationMs: Math.max(0, now() - startedAt),
        method: req.method,
        path: safeRequestPath(req),
        requestId,
        route: req.gateway?.route?.module || null,
        service: req.gateway?.route?.service || null,
        status: res.statusCode,
        userId: req.authUser?.id || null,
      });
    });

    return next();
  };
}

function createApiNotFoundHandler() {
  return (req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  };
}

function createGatewayErrorHandler(options = {}) {
  const { logger = console } = options;

  return (error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (!String(req.originalUrl || req.url || '').startsWith('/api')) return next(error);
    if (Number(error?.status || 500) >= 500) {
      logger.error?.('gateway.error', {
        message: error?.message || 'Unknown error',
        path: safeRequestPath(req),
        requestId: req.gateway?.requestId || null,
      });
    }
    return sendSafeError(res, error, { message: 'Request failed.' });
  };
}

function buildGatewayForwardUrl(baseUrl, req) {
  const path = String(req.originalUrl || req.url || '/');
  return new URL(path, `${baseUrl}/`).toString();
}

function gatewayForwardHeaders(req, options = {}) {
  const {
    internalServiceToken = '',
    preserveCookie = false,
  } = options;
  const headers = {};
  for (const [key, value] of Object.entries(req.headers || {})) {
    const normalized = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalized)) continue;
    if (PUBLIC_CREDENTIAL_HEADERS.has(normalized) && !(preserveCookie && normalized === 'cookie')) continue;
    if (INTERNAL_CONTEXT_HEADERS.has(normalized)) continue;
    if (value === undefined) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }

  if (req.gateway?.requestId) headers['x-workbench-request-id'] = req.gateway.requestId;
  if (req.authUser?.id) headers['x-workbench-user-id'] = req.authUser.id;
  if (req.authUser?.role) headers['x-workbench-user-role'] = req.authUser.role;
  if (req.authSession?.id) headers['x-workbench-session-id'] = req.authSession.id;
  if (internalServiceToken) headers['x-workbench-internal-token'] = internalServiceToken;
  return headers;
}

function gatewayForwardBody(req, headers) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return undefined;
  if (req.body === undefined) return undefined;
  if (typeof req.body === 'string') {
    if (!headers['content-type'] && !headers['Content-Type']) headers['content-type'] = 'text/plain; charset=utf-8';
    return req.body;
  }
  if (Buffer.isBuffer(req.body)) return req.body;
  if (!headers['content-type'] && !headers['Content-Type']) headers['content-type'] = 'application/json';
  return JSON.stringify(req.body);
}

function copyGatewayResponseHeaders(upstreamResponse, res) {
  for (const [key, value] of upstreamResponse.headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    res.setHeader(key, value);
  }
}

function createGatewayForwarder(options = {}) {
  const {
    fetchImpl = fetchWithTimeout,
    internalServiceToken = '',
    upstreams = {},
  } = options;

  return async (req, res, next) => {
    const route = gatewayRouteForPath(req.originalUrl || req.url || req.path || '', req.method);
    const upstreamUrl = route?.upstreamKey ? upstreams[route.upstreamKey] : '';
    if (!upstreamUrl) return next();

    try {
      const headers = gatewayForwardHeaders(req, {
        internalServiceToken,
        preserveCookie: route.upstreamKey === 'auth',
      });
      const body = gatewayForwardBody(req, headers);
      const upstreamResponse = await fetchImpl(buildGatewayForwardUrl(upstreamUrl, req), {
        body,
        headers,
        method: req.method,
        redirect: 'manual',
      });
      const payload = Buffer.from(await upstreamResponse.arrayBuffer());
      copyGatewayResponseHeaders(upstreamResponse, res);
      res.status(upstreamResponse.status);
      return res.send(payload);
    } catch (error) {
      return next(Object.assign(new Error('Gateway upstream request failed.'), {
        cause: error,
        expose: true,
        status: 502,
      }));
    }
  };
}

function createApiGateway(options = {}) {
  const {
    accessToken = '',
    authRepository,
    corsOrigin,
    env = process.env,
    logger = console,
    rateLimits,
    requireLogin = true,
    sessionCookieOptions = {},
    trustForwardedFor = false,
    uploadLimits,
  } = options;
  const rateLimit = createRateLimitFactory({ trustForwardedFor });
  const requestLogs = requestLogEnabled(env);
  const upstreams = options.upstreams || resolveGatewayUpstreams(env);

  function registerBeforeRoutes(app) {
    app.use(cors({
      origin: corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-workbench-token', 'x-workbench-admin-token', 'x-request-id'],
    }));

    app.use(createGatewayRequestLogger({
      enabled: requestLogs,
      logger,
    }));

    app.use(['/api/assets/upload', '/api/images', '/api/videos'], express.json({ limit: `${uploadLimits.uploadBodyLimitMb}mb` }));
    app.use(express.json({ limit: '1mb' }));
    app.use(express.text({ limit: '1mb' }));
    app.use(createSecurityHeadersMiddleware({ env }));
    app.use(createSessionMiddleware({
      authRepository,
      sessionCookieOptions,
    }));

    app.use('/api', createApiAuthMiddleware({
      accessToken,
      requireLogin,
    }));

    app.use(['/api/images', '/api/videos', '/api/chat', '/api/claude'], rateLimit({
      windowMs: rateLimits.windowMs,
      max: rateLimits.expensive,
      label: 'generation',
    }));
    app.use('/api/assets/upload', rateLimit({
      windowMs: rateLimits.windowMs,
      max: rateLimits.upload,
      label: 'upload',
    }));
    app.use('/api/proxy', rateLimit({
      windowMs: rateLimits.windowMs,
      max: rateLimits.proxy,
      label: 'proxy',
    }));

    app.use('/api', createGatewayForwarder({
      fetchImpl: options.fetchImpl,
      internalServiceToken: env.WORKBENCH_INTERNAL_SERVICE_TOKEN,
      upstreams,
    }));
  }

  function registerAfterRoutes(app) {
    app.use('/api', createApiNotFoundHandler());
    app.use(createGatewayErrorHandler({ logger }));
  }

  return {
    rateLimit,
    registerAfterRoutes,
    registerBeforeRoutes,
    routeTable: GATEWAY_ROUTE_TABLE,
    upstreams,
  };
}

module.exports = {
  GATEWAY_ROUTE_TABLE,
  GATEWAY_UPSTREAM_ENV,
  INTERNAL_CONTEXT_HEADERS,
  createApiGateway,
  createApiNotFoundHandler,
  createGatewayErrorHandler,
  createGatewayForwarder,
  createGatewayRequestLogger,
  gatewayForwardHeaders,
  gatewayRouteForPath,
  requestLogEnabled,
  resolveGatewayUpstreams,
};
