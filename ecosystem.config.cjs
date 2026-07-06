const cwd = __dirname;

const gatewayUpstreams = {
  WORKBENCH_GATEWAY_AUTH_URL: 'http://127.0.0.1:3004',
  WORKBENCH_GATEWAY_WORKER_URL: 'http://127.0.0.1:3001',
  WORKBENCH_GATEWAY_ASSET_URL: 'http://127.0.0.1:3002',
  WORKBENCH_GATEWAY_MODEL_URL: 'http://127.0.0.1:3003',
  WORKBENCH_GATEWAY_WORKFLOW_URL: 'http://127.0.0.1:3005',
};

const serverDefaults = {
  NODE_ENV: 'production',
  WORKBENCH_DEPLOYMENT_MODE: 'server',
};

function app(name, script, env = {}) {
  return {
    name,
    script,
    cwd,
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
    time: true,
    env: {
      ...serverDefaults,
      ...env,
    },
  };
}

module.exports = {
  apps: [
    app('ai-workbench-api', 'server/api.cjs', {
      ...gatewayUpstreams,
      PROXY_HOST: '0.0.0.0',
      PROXY_PORT: '3000',
      WORKBENCH_SERVE_STATIC: 'false',
      WORKBENCH_START_WORKERS: 'false',
    }),
    app('ai-workbench-auth-service', 'server/authService.cjs', {
      WORKBENCH_AUTH_SERVICE_HOST: '127.0.0.1',
      WORKBENCH_AUTH_SERVICE_PORT: '3004',
    }),
    app('ai-workbench-worker-service', 'server/workerService.cjs', {
      WORKBENCH_WORKER_SERVICE_HOST: '127.0.0.1',
      WORKBENCH_WORKER_SERVICE_PORT: '3001',
      WORKBENCH_WORKER_SERVICE_START_QUEUE: 'true',
    }),
    app('ai-workbench-asset-service', 'server/assetService.cjs', {
      WORKBENCH_ASSET_SERVICE_HOST: '127.0.0.1',
      WORKBENCH_ASSET_SERVICE_PORT: '3002',
    }),
    app('ai-workbench-model-service', 'server/modelService.cjs', {
      WORKBENCH_MODEL_SERVICE_HOST: '127.0.0.1',
      WORKBENCH_MODEL_SERVICE_PORT: '3003',
      WORKBENCH_MODEL_SERVICE_START_QUEUE: 'false',
    }),
    app('ai-workbench-workflow-service', 'server/workflowService.cjs', {
      WORKBENCH_WORKFLOW_SERVICE_HOST: '127.0.0.1',
      WORKBENCH_WORKFLOW_SERVICE_PORT: '3005',
    }),
  ],
};
