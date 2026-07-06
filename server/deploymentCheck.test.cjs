const assert = require('node:assert/strict');
const test = require('node:test');

const { checkDeploymentConfig } = require('./deploymentCheck.cjs');

const baseServerEnv = {
  WORKBENCH_DEPLOYMENT_MODE: 'server',
  WORKBENCH_KEY_SECRET: '0123456789abcdef0123456789abcdef',
  WORKBENCH_REQUIRE_LOGIN: 'true',
  WORKBENCH_REQUIRE_INVITATION_CODE: 'false',
  WORKBENCH_ALLOW_PUBLIC_REGISTRATION: 'false',
  WORKBENCH_ENABLE_GENERIC_PROXY: 'false',
  WORKBENCH_TRUST_CLIENT_USER_ID: 'false',
};

test('deployment check accepts split frontend/backend configuration', () => {
  const report = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'false',
    VITE_PROXY_URL: 'https://api.example.com',
    WORKBENCH_CORS_ORIGIN: 'https://workbench.example.com',
    WORKBENCH_PUBLIC_BASE_URL: 'https://api.example.com',
    WORKBENCH_COOKIE_SAMESITE: 'None',
    WORKBENCH_COOKIE_SECURE: 'true',
    WORKBENCH_COOKIE_DOMAIN: '.example.com',
  });

  assert.equal(report.ok, true);
  assert.equal(report.splitDeployment, true);
  assert.deepEqual(report.errors, []);
});

test('deployment check rejects missing split deployment API settings', () => {
  const report = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'false',
    VITE_PROXY_URL: '/',
    WORKBENCH_CORS_ORIGIN: '',
  });

  assert.equal(report.ok, false);
  assert.equal(report.errors.some((error) => error.includes('VITE_PROXY_URL=/')), true);
  assert.equal(report.errors.some((error) => error.includes('WORKBENCH_CORS_ORIGIN')), true);
});

test('deployment check rejects using the backend API origin as CORS origin', () => {
  const report = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'false',
    VITE_PROXY_URL: 'https://api.example.com',
    WORKBENCH_CORS_ORIGIN: 'https://api.example.com',
    WORKBENCH_PUBLIC_BASE_URL: 'https://api.example.com',
    WORKBENCH_COOKIE_SAMESITE: 'None',
    WORKBENCH_COOKIE_SECURE: 'true',
  });

  assert.equal(report.ok, false);
  assert.equal(report.errors.some((error) => error.includes('frontend origin')), true);
});

test('deployment check rejects split deployment URLs that include paths', () => {
  const report = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'false',
    VITE_PROXY_URL: 'https://api.example.com/api',
    WORKBENCH_CORS_ORIGIN: 'https://workbench.example.com',
    WORKBENCH_PUBLIC_BASE_URL: 'https://api.example.com/assets',
    WORKBENCH_COOKIE_SAMESITE: 'None',
    WORKBENCH_COOKIE_SECURE: 'true',
  });

  assert.equal(report.ok, false);
  assert.equal(report.errors.some((error) => error.includes('VITE_PROXY_URL must be the backend API origin only')), true);
  assert.equal(report.errors.some((error) => error.includes('WORKBENCH_PUBLIC_BASE_URL must be the backend API origin only')), true);
});

test('deployment check rejects CORS origins with trailing slashes or paths', () => {
  const report = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'false',
    VITE_PROXY_URL: 'https://api.example.com',
    WORKBENCH_CORS_ORIGIN: 'https://workbench.example.com/,https://preview.example.com/app',
    WORKBENCH_PUBLIC_BASE_URL: 'https://api.example.com',
    WORKBENCH_COOKIE_SAMESITE: 'None',
    WORKBENCH_COOKIE_SECURE: 'true',
  });

  assert.equal(report.ok, false);
  assert.equal(report.errors.filter((error) => error.includes('WORKBENCH_CORS_ORIGIN must contain frontend origins only')).length, 2);
});

test('deployment check rejects insecure SameSite=None cookies', () => {
  const report = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'false',
    VITE_PROXY_URL: 'https://api.example.com',
    WORKBENCH_CORS_ORIGIN: 'https://workbench.example.com',
    WORKBENCH_COOKIE_SAMESITE: 'None',
    WORKBENCH_COOKIE_SECURE: 'false',
  });

  assert.equal(report.ok, false);
  assert.equal(report.errors.some((error) => error.includes('WORKBENCH_COOKIE_SECURE=true')), true);
});

test('deployment check rejects static frontend serving in server mode', () => {
  const report = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'true',
    VITE_PROXY_URL: '/',
    WORKBENCH_CORS_ORIGIN: '',
    WORKBENCH_COOKIE_SAMESITE: 'Lax',
  });

  assert.equal(report.ok, false);
  assert.equal(report.splitDeployment, false);
  assert.equal(report.errors.some((error) => error.includes('WORKBENCH_SERVE_STATIC must be false')), true);
});

test('deployment check warns when public mode disables login intentionally', () => {
  const report = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'false',
    VITE_PROXY_URL: 'https://api.example.com',
    WORKBENCH_CORS_ORIGIN: 'https://workbench.example.com',
    WORKBENCH_COOKIE_SAMESITE: 'None',
    WORKBENCH_COOKIE_SECURE: 'true',
    WORKBENCH_REQUIRE_LOGIN: 'false',
    WORKBENCH_ALLOW_PUBLIC_SERVER: 'true',
  });

  assert.equal(report.ok, true);
  assert.equal(report.warnings.some((warning) => warning.includes('Login is disabled')), true);
});

test('deployment check requires SMTP when registration entry is enabled', () => {
  const report = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'false',
    VITE_PROXY_URL: 'https://api.example.com',
    WORKBENCH_CORS_ORIGIN: 'https://workbench.example.com',
    WORKBENCH_COOKIE_SAMESITE: 'None',
    WORKBENCH_COOKIE_SECURE: 'true',
    WORKBENCH_REQUIRE_INVITATION_CODE: 'true',
    WORKBENCH_SMTP_HOST: '',
  });

  assert.equal(report.ok, false);
  assert.equal(report.errors.some((error) => error.includes('WORKBENCH_SMTP_HOST')), true);
});

test('deployment check accepts invitation signup when SMTP is configured', () => {
  const report = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'false',
    VITE_PROXY_URL: 'https://api.example.com',
    WORKBENCH_CORS_ORIGIN: 'https://workbench.example.com',
    WORKBENCH_COOKIE_SAMESITE: 'None',
    WORKBENCH_COOKIE_SECURE: 'true',
    WORKBENCH_REQUIRE_INVITATION_CODE: 'true',
    WORKBENCH_SMTP_HOST: 'smtp.example.com',
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
});


test('deployment check rejects server email development mode', () => {
  const report = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'false',
    VITE_PROXY_URL: 'https://api.example.com',
    WORKBENCH_CORS_ORIGIN: 'https://workbench.example.com',
    WORKBENCH_COOKIE_SAMESITE: 'None',
    WORKBENCH_COOKIE_SECURE: 'true',
    WORKBENCH_EMAIL_DEV_MODE: 'true',
  });

  assert.equal(report.ok, false);
  assert.equal(report.errors.some((error) => error.includes('Email development mode')), true);
});

test('deployment check rejects direct API keys in server mode', () => {
  const report = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'false',
    VITE_PROXY_URL: 'https://api.example.com',
    WORKBENCH_CORS_ORIGIN: 'https://workbench.example.com',
    WORKBENCH_COOKIE_SAMESITE: 'None',
    WORKBENCH_COOKIE_SECURE: 'true',
    WORKBENCH_ALLOW_DIRECT_API_KEYS: 'true',
  });

  assert.equal(report.ok, false);
  assert.equal(report.errors.some((error) => error.includes('WORKBENCH_ALLOW_DIRECT_API_KEYS')), true);
});

test('deployment check rejects example bootstrap admin password', () => {
  const report = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'false',
    VITE_PROXY_URL: 'https://api.example.com',
    WORKBENCH_CORS_ORIGIN: 'https://workbench.example.com',
    WORKBENCH_COOKIE_SAMESITE: 'None',
    WORKBENCH_COOKIE_SECURE: 'true',
    WORKBENCH_ADMIN_EMAIL: 'admin@example.com',
    WORKBENCH_ADMIN_PASSWORD: 'change-me-before-server-use',
  });

  assert.equal(report.ok, false);
  assert.equal(report.errors.some((error) => error.includes('example password')), true);
});

test('deployment check warns when no admin entry path is configured', () => {
  const report = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'false',
    VITE_PROXY_URL: 'https://api.example.com',
    WORKBENCH_CORS_ORIGIN: 'https://workbench.example.com',
    WORKBENCH_COOKIE_SAMESITE: 'None',
    WORKBENCH_COOKIE_SECURE: 'true',
  });

  assert.equal(report.ok, true);
  assert.equal(report.warnings.some((warning) => warning.includes('No bootstrap admin')), true);
});

test('deployment check accepts explicit admin access paths without lockout warning', () => {
  const withToken = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'false',
    VITE_PROXY_URL: 'https://api.example.com',
    WORKBENCH_CORS_ORIGIN: 'https://workbench.example.com',
    WORKBENCH_COOKIE_SAMESITE: 'None',
    WORKBENCH_COOKIE_SECURE: 'true',
    WORKBENCH_ADMIN_TOKEN: 'admin-token',
  });
  const withBootstrapAdmin = checkDeploymentConfig({
    ...baseServerEnv,
    WORKBENCH_SERVE_STATIC: 'false',
    VITE_PROXY_URL: 'https://api.example.com',
    WORKBENCH_CORS_ORIGIN: 'https://workbench.example.com',
    WORKBENCH_COOKIE_SAMESITE: 'None',
    WORKBENCH_COOKIE_SECURE: 'true',
    WORKBENCH_ADMIN_EMAIL: 'admin@example.com',
    WORKBENCH_ADMIN_PASSWORD: 'long-enough-admin-password',
  });

  assert.equal(withToken.warnings.some((warning) => warning.includes('No bootstrap admin')), false);
  assert.equal(withBootstrapAdmin.warnings.some((warning) => warning.includes('No bootstrap admin')), false);
});
