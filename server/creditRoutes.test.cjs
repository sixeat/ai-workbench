const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-workbench-credit-routes-test-'));
process.env.WORKBENCH_DATA_DIR = tempDir;
process.env.WORKBENCH_DB_PATH = path.join(tempDir, 'test.sqlite');

const { createUser, db } = require('./db.cjs');
const { registerCreditRoutes } = require('./routes/creditRoutes.cjs');

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return {
    data,
    status: response.status,
  };
}

function createApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.authUser = user;
    next();
  });
  registerCreditRoutes(app, {
    getRequestUserId: (req) => req.authUser.id,
    requireAdmin: (req, res) => {
      if (req.headers['x-admin'] === '1') return true;
      res.status(403).json({ error: 'Admin privileges are required.' });
      return false;
    },
  });
  return app;
}

test('credit routes expose own balance and protect admin adjustment', async () => {
  const user = createUser({
    email: 'credit-route-user@example.com',
    name: 'Credit Route User',
    passwordHash: 'test',
    username: 'credit-route-user@example.com',
  });
  const app = createApp(user);
  const { baseUrl, server } = await listen(app);

  try {
    const me = await fetchJson(`${baseUrl}/api/credits/me`);
    assert.equal(me.status, 200);
    assert.equal(me.data.account.userId, user.id);
    assert.equal(me.data.account.balance, 0);

    const forbidden = await fetchJson(`${baseUrl}/api/admin/credits/adjust`, {
      body: JSON.stringify({ amount: 10, userId: user.id }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    assert.equal(forbidden.status, 403);

    const adjusted = await fetchJson(`${baseUrl}/api/admin/credits/adjust`, {
      body: JSON.stringify({ amount: 10, userId: user.id }),
      headers: {
        'Content-Type': 'application/json',
        'x-admin': '1',
      },
      method: 'POST',
    });
    assert.equal(adjusted.status, 200);
    assert.equal(adjusted.data.account.balance, 10);

    const transactions = await fetchJson(`${baseUrl}/api/admin/credits/transactions`, {
      headers: { 'x-admin': '1' },
    });
    assert.equal(transactions.status, 200);
    assert.equal(transactions.data.transactions.length, 1);
    assert.equal(transactions.data.transactions[0].type, 'admin_adjustment');
  } finally {
    await closeServer(server);
  }
});
