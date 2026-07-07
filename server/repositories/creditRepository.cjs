const { randomUUID } = require('node:crypto');
const { db: defaultDb } = require('../db.cjs');

function nowIso() {
  return new Date().toISOString();
}

function rowToAccount(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    balance: Number(row.balance || 0),
    reservedBalance: Number(row.reserved_balance || 0),
    totalGranted: Number(row.total_granted || 0),
    totalUsed: Number(row.total_used || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id || '',
    type: row.type,
    amount: Number(row.amount || 0),
    balanceAfter: Number(row.balance_after || 0),
    reservedAfter: Number(row.reserved_after || 0),
    actorUserId: row.actor_user_id || '',
    description: row.description || '',
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
    createdAt: row.created_at,
  };
}

function jsonStringify(value) {
  return value == null ? null : JSON.stringify(value);
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function listOptions(options = {}) {
  return {
    limit: clampNumber(options.limit, 100, 1, 500),
    offset: clampNumber(options.offset, 0, 0, 100_000),
    userId: String(options.userId || '').trim(),
    taskId: String(options.taskId || '').trim(),
    type: String(options.type || '').trim(),
  };
}

function createInsufficientCreditsError(required, available) {
  return Object.assign(new Error('Insufficient credits.'), {
    code: 'INSUFFICIENT_CREDITS',
    expose: true,
    required,
    available,
    status: 402,
  });
}

function createCreditRepository(overrides = {}) {
  const database = overrides.db || defaultDb;

  function ensureAccount(userId) {
    const id = String(userId || '').trim();
    if (!id) throw Object.assign(new Error('User id is required.'), { status: 400, expose: true });
    const now = nowIso();
    database.prepare(`
      INSERT OR IGNORE INTO credit_accounts (
        user_id, balance, reserved_balance, total_granted, total_used, created_at, updated_at
      )
      VALUES (?, 0, 0, 0, 0, ?, ?)
    `).run(id, now, now);
    return getAccount(id);
  }

  function ensureAccountsForAllUsers() {
    const now = nowIso();
    database.prepare(`
      INSERT OR IGNORE INTO credit_accounts (
        user_id, balance, reserved_balance, total_granted, total_used, created_at, updated_at
      )
      SELECT id, 0, 0, 0, 0, ?, ?
      FROM users
    `).run(now, now);
  }

  function getAccount(userId) {
    return rowToAccount(database.prepare('SELECT * FROM credit_accounts WHERE user_id = ?').get(userId));
  }

  function getOrCreateAccount(userId) {
    return getAccount(userId) || ensureAccount(userId);
  }

  function insertTransaction({
    actorUserId = '',
    amount,
    balanceAfter,
    description = '',
    metadata = {},
    reservedAfter = 0,
    taskId = '',
    type,
    userId,
  }) {
    const id = randomUUID();
    database.prepare(`
      INSERT INTO credit_transactions (
        id, user_id, task_id, type, amount, balance_after, reserved_after,
        actor_user_id, description, metadata_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      taskId || null,
      type,
      Number(amount || 0),
      Number(balanceAfter || 0),
      Number(reservedAfter || 0),
      actorUserId || null,
      description || null,
      jsonStringify(metadata || {}),
      nowIso()
    );
    return getTransaction(id);
  }

  function getTransaction(id) {
    return rowToTransaction(database.prepare('SELECT * FROM credit_transactions WHERE id = ?').get(id));
  }

  function debitAccount({ amount, description = '', metadata = {}, taskId = '', userId }) {
    const normalizedAmount = Math.max(0, Math.floor(Number(amount || 0)));
    if (normalizedAmount <= 0) return { account: getOrCreateAccount(userId), transaction: null };

    ensureAccount(userId);
    const updatedAt = nowIso();
    const result = database.prepare(`
      UPDATE credit_accounts
      SET balance = balance - @amount,
          total_used = total_used + @amount,
          updated_at = @updatedAt
      WHERE user_id = @userId
        AND balance >= @amount
    `).run({
      amount: normalizedAmount,
      updatedAt,
      userId,
    });

    if (result.changes === 0) {
      const account = getOrCreateAccount(userId);
      throw createInsufficientCreditsError(normalizedAmount, account.balance);
    }

    const account = getAccount(userId);
    return {
      account,
      transaction: insertTransaction({
        amount: -normalizedAmount,
        balanceAfter: account.balance,
        description,
        metadata,
        reservedAfter: account.reservedBalance,
        taskId,
        type: 'debit',
        userId,
      }),
    };
  }

  function runWithOptionalDebit({ amount, createTask, description = '', metadata = {}, userId }) {
    ensureAccount(userId);
    return database.transaction(() => {
      const task = createTask();
      const charge = debitAccount({
        amount,
        description,
        metadata,
        taskId: task.id,
        userId,
      });
      return { charge, task };
    })();
  }

  function refundTask(taskId, options = {}) {
    return database.transaction(() => {
      const task = database.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      if (!task) return { account: null, refunded: false, reason: 'task_not_found' };

      const amount = Math.max(0, Math.floor(Number(task.credit_cost || 0)));
      if (amount <= 0) {
        return { account: getOrCreateAccount(task.user_id), refunded: false, reason: 'not_billable' };
      }
      if (task.credit_status === 'refunded') {
        return { account: getOrCreateAccount(task.user_id), refunded: false, reason: 'already_refunded' };
      }
      if (task.credit_status !== 'charged') {
        return { account: getOrCreateAccount(task.user_id), refunded: false, reason: 'not_charged' };
      }

      const existingRefund = database.prepare(`
        SELECT id FROM credit_transactions
        WHERE task_id = ?
          AND type = 'refund'
        LIMIT 1
      `).get(taskId);
      if (existingRefund) {
        database.prepare(`
          UPDATE tasks
          SET credit_status = 'refunded',
              updated_at = ?
          WHERE id = ?
        `).run(nowIso(), taskId);
        return { account: getOrCreateAccount(task.user_id), refunded: false, reason: 'already_refunded' };
      }

      const updatedAt = nowIso();
      database.prepare(`
        UPDATE credit_accounts
        SET balance = balance + @amount,
            total_used = CASE
              WHEN total_used >= @amount THEN total_used - @amount
              ELSE 0
            END,
            updated_at = @updatedAt
        WHERE user_id = @userId
      `).run({
        amount,
        updatedAt,
        userId: task.user_id,
      });
      database.prepare(`
        UPDATE tasks
        SET credit_status = 'refunded',
            updated_at = ?
        WHERE id = ?
      `).run(updatedAt, taskId);

      const account = getOrCreateAccount(task.user_id);
      return {
        account,
        refunded: true,
        transaction: insertTransaction({
          amount,
          balanceAfter: account.balance,
          description: options.description || 'Task credits refunded.',
          metadata: options.metadata || {},
          reservedAfter: account.reservedBalance,
          taskId,
          type: 'refund',
          userId: task.user_id,
        }),
      };
    })();
  }

  function adjustAccount({
    actorUserId = '',
    amount,
    description = '',
    metadata = {},
    userId,
  }) {
    const normalizedAmount = Math.trunc(Number(amount || 0));
    if (!Number.isFinite(normalizedAmount) || normalizedAmount === 0) {
      throw Object.assign(new Error('Adjustment amount must be a non-zero integer.'), { status: 400, expose: true });
    }

    return database.transaction(() => {
      ensureAccount(userId);
      const account = getAccount(userId);
      const nextBalance = account.balance + normalizedAmount;
      if (nextBalance < 0) {
        throw createInsufficientCreditsError(Math.abs(normalizedAmount), account.balance);
      }

      const updatedAt = nowIso();
      database.prepare(`
        UPDATE credit_accounts
        SET balance = @balance,
            total_granted = total_granted + @granted,
            updated_at = @updatedAt
        WHERE user_id = @userId
      `).run({
        balance: nextBalance,
        granted: normalizedAmount > 0 ? normalizedAmount : 0,
        updatedAt,
        userId,
      });

      const updated = getAccount(userId);
      return {
        account: updated,
        transaction: insertTransaction({
          actorUserId,
          amount: normalizedAmount,
          balanceAfter: updated.balance,
          description: description || 'Admin credit adjustment.',
          metadata,
          reservedAfter: updated.reservedBalance,
          type: 'admin_adjustment',
          userId,
        }),
      };
    })();
  }

  function transactionWhere(options = {}) {
    const query = listOptions(options);
    const clauses = [];
    const params = {};
    if (query.userId) {
      clauses.push('user_id = @userId');
      params.userId = query.userId;
    }
    if (query.taskId) {
      clauses.push('task_id = @taskId');
      params.taskId = query.taskId;
    }
    if (query.type) {
      clauses.push('type = @type');
      params.type = query.type;
    }
    return {
      clause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
      params,
      query,
    };
  }

  function listTransactions(options = {}) {
    const { clause, params, query } = transactionWhere(options);
    return database.prepare(`
      SELECT * FROM credit_transactions
      ${clause}
      ORDER BY created_at DESC, id DESC
      LIMIT @limit OFFSET @offset
    `).all({
      ...params,
      limit: query.limit,
      offset: query.offset,
    }).map(rowToTransaction);
  }

  function countTransactions(options = {}) {
    const { clause, params } = transactionWhere(options);
    return Number(database.prepare(`
      SELECT COUNT(*) AS count
      FROM credit_transactions
      ${clause}
    `).get(params).count || 0);
  }

  function listAccountsWithUsers(options = {}) {
    ensureAccountsForAllUsers();
    const query = {
      limit: clampNumber(options.limit, 100, 1, 500),
      offset: clampNumber(options.offset, 0, 0, 100_000),
      role: String(options.role || '').trim(),
      search: String(options.search || options.q || '').trim().toLowerCase(),
      status: String(options.status || '').trim(),
    };
    const where = [];
    const params = {
      limit: query.limit,
      offset: query.offset,
    };
    if (query.search) {
      where.push(`(
        lower(coalesce(users.id, '')) LIKE @search
        OR lower(coalesce(users.email, '')) LIKE @search
        OR lower(coalesce(users.username, '')) LIKE @search
        OR lower(coalesce(users.name, '')) LIKE @search
      )`);
      params.search = `%${query.search}%`;
    }
    if (query.role) {
      where.push('users.role = @role');
      params.role = query.role;
    }
    if (query.status === 'enabled') {
      where.push('users.is_enabled = 1');
    } else if (query.status === 'disabled') {
      where.push('users.is_enabled = 0');
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    return database.prepare(`
      SELECT
        users.id AS user_id,
        users.username,
        users.email,
        users.name,
        users.role,
        users.is_enabled,
        credit_accounts.balance,
        credit_accounts.reserved_balance,
        credit_accounts.total_granted,
        credit_accounts.total_used,
        credit_accounts.created_at,
        credit_accounts.updated_at
      FROM users
      JOIN credit_accounts ON credit_accounts.user_id = users.id
      ${clause}
      ORDER BY users.created_at DESC, users.id DESC
      LIMIT @limit OFFSET @offset
    `).all(params).map((row) => ({
      account: rowToAccount(row),
      user: {
        id: row.user_id,
        username: row.username,
        email: row.email,
        name: row.name,
        role: row.role,
        isEnabled: Boolean(row.is_enabled),
      },
    }));
  }

  function countAccountsWithUsers(options = {}) {
    ensureAccountsForAllUsers();
    const query = {
      role: String(options.role || '').trim(),
      search: String(options.search || options.q || '').trim().toLowerCase(),
      status: String(options.status || '').trim(),
    };
    const where = [];
    const params = {};
    if (query.search) {
      where.push(`(
        lower(coalesce(users.id, '')) LIKE @search
        OR lower(coalesce(users.email, '')) LIKE @search
        OR lower(coalesce(users.username, '')) LIKE @search
        OR lower(coalesce(users.name, '')) LIKE @search
      )`);
      params.search = `%${query.search}%`;
    }
    if (query.role) {
      where.push('users.role = @role');
      params.role = query.role;
    }
    if (query.status === 'enabled') {
      where.push('users.is_enabled = 1');
    } else if (query.status === 'disabled') {
      where.push('users.is_enabled = 0');
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    return Number(database.prepare(`
      SELECT COUNT(*) AS count
      FROM users
      JOIN credit_accounts ON credit_accounts.user_id = users.id
      ${clause}
    `).get(params).count || 0);
  }

  return {
    adjustAccount,
    countAccountsWithUsers,
    countTransactions,
    debitAccount,
    ensureAccount,
    getAccount,
    getOrCreateAccount,
    listAccountsWithUsers,
    listTransactions,
    refundTask,
    runWithOptionalDebit,
  };
}

const creditRepository = createCreditRepository();

module.exports = {
  createCreditRepository,
  createInsufficientCreditsError,
  creditRepository,
};
