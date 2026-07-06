const { createHash, randomBytes, scryptSync, timingSafeEqual } = require('crypto');

const SESSION_COOKIE_NAME = 'ai_workbench_session';

function hashPassword(password, salt = randomBytes(16).toString('base64')) {
  const hash = scryptSync(String(password), salt, 64).toString('base64');
  return `scrypt:v1:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [algorithm, version, salt, hash] = String(storedHash || '').split(':');
  if (algorithm !== 'scrypt' || version !== 'v1' || !salt || !hash) return false;

  const candidate = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'base64');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

function hashSessionToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rawValue.join('=') || '');
  }
  return cookies;
}

function normalizeSameSite(value) {
  const normalized = String(value || 'Lax').trim().toLowerCase();
  if (normalized === 'none') return 'None';
  if (normalized === 'strict') return 'Strict';
  return 'Lax';
}

function sessionCookie(token, options = {}) {
  const sameSite = normalizeSameSite(options.sameSite);
  const secure = Boolean(options.secure || sameSite === 'None');
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds || 0))}`,
  ];
  if (options.domain) parts.push(`Domain=${String(options.domain).trim()}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie(options = {}) {
  return sessionCookie('', { ...options, maxAgeSeconds: 0 });
}

module.exports = {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeSameSite,
  parseCookies,
  sessionCookie,
  verifyPassword,
};
