const net = require('node:net');

function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function isLoopbackHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return normalized.startsWith('127.');
  if (ipVersion === 6) return normalized === '::1' || normalized === '0:0:0:0:0:0:0:1';
  return false;
}

function isWildcardBindHost(hostname) {
  const normalized = normalizeHostname(hostname);
  return normalized === '0.0.0.0' || normalized === '::' || normalized === '*';
}

function assertInternalServiceHostAllowed({
  env = process.env,
  envName = 'WORKBENCH_INTERNAL_SERVICE_HOST',
  host = '',
  mode = 'server',
} = {}) {
  if (mode !== 'server') return;

  if (isWildcardBindHost(host)) {
    throw new Error(`${envName} must not bind to ${host} in server mode. Internal services must stay behind the gateway.`);
  }

  if (!isLoopbackHostname(host) && !String(env.WORKBENCH_INTERNAL_SERVICE_TOKEN || '').trim()) {
    throw new Error(`${envName} is not loopback, so WORKBENCH_INTERNAL_SERVICE_TOKEN is required.`);
  }
}

module.exports = {
  assertInternalServiceHostAllowed,
  isLoopbackHostname,
  isWildcardBindHost,
  normalizeHostname,
};
