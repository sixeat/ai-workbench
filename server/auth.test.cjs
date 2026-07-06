const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeSameSite,
  sessionCookie,
} = require('./auth.cjs');

test('session cookie supports configurable SameSite and domain', () => {
  const cookie = sessionCookie('token', {
    maxAgeSeconds: 60,
    sameSite: 'Strict',
    domain: '.example.com',
    secure: true,
  });

  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Domain=.example.com/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
});

test('SameSite=None session cookies force Secure', () => {
  const cookie = sessionCookie('token', {
    maxAgeSeconds: 60,
    sameSite: 'None',
    secure: false,
  });

  assert.match(cookie, /SameSite=None/);
  assert.match(cookie, /Secure/);
});

test('invalid SameSite values fall back to Lax', () => {
  assert.equal(normalizeSameSite('surprise'), 'Lax');
  assert.equal(normalizeSameSite('none'), 'None');
  assert.equal(normalizeSameSite('strict'), 'Strict');
});
