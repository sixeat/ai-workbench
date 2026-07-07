const assert = require('node:assert/strict');
const test = require('node:test');

const { stripProxyRequestHeaders } = require('./services/proxyService.cjs');

test('proxy service strips browser and platform credential headers before outbound requests', () => {
  const headers = stripProxyRequestHeaders({
    Authorization: 'Bearer user-secret',
    Cookie: 'ai_workbench_session=session-secret',
    Host: 'api.example.com',
    Referer: 'https://workbench.example.com',
    'Content-Type': 'application/json',
    'X-Api-Key': 'provider-secret',
    'X-User-Id': 'user-1',
    'X-Workbench-Admin-Token': 'admin-secret',
    'X-Workbench-Token': 'access-secret',
    'X-Demo': 'safe',
  });

  assert.deepEqual(headers, {
    'Content-Type': 'application/json',
    'X-Demo': 'safe',
  });
});
