const { apiKeyRepository: defaultApiKeyRepository } = require('../repositories/apiKeyRepository.cjs');
const { authRepository: defaultAuthRepository } = require('../repositories/authRepository.cjs');
const { creditRepository: defaultCreditRepository } = require('../repositories/creditRepository.cjs');
const { taskRepository: defaultTaskRepository } = require('../repositories/taskRepository.cjs');
const { createCreditPricingService } = require('./creditPricingService.cjs');

function publicKeyScope(scope) {
  return scope === 'user' ? 'user_key' : 'server_key';
}

function publicAccount(account) {
  if (!account) return null;
  return {
    userId: account.userId,
    balance: account.balance,
    reservedBalance: account.reservedBalance,
    totalGranted: account.totalGranted,
    totalUsed: account.totalUsed,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function publicTransaction(transaction) {
  if (!transaction) return null;
  return {
    id: transaction.id,
    userId: transaction.userId,
    taskId: transaction.taskId,
    type: transaction.type,
    amount: transaction.amount,
    balanceAfter: transaction.balanceAfter,
    reservedAfter: transaction.reservedAfter,
    actorUserId: transaction.actorUserId,
    description: transaction.description,
    metadata: transaction.metadata,
    createdAt: transaction.createdAt,
  };
}

function requestAuditMeta(req) {
  if (!req) return {};
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || '',
    userAgent: req.headers?.['user-agent'] || '',
  };
}

function createCreditService({
  apiKeyRepository = defaultApiKeyRepository,
  authRepository = defaultAuthRepository,
  creditPricingService = createCreditPricingService(),
  creditRepository = defaultCreditRepository,
  taskRepository = defaultTaskRepository,
} = {}) {
  function ensureUserAccount(userId) {
    return publicAccount(creditRepository.getOrCreateAccount(userId));
  }

  function resolveTaskKeyScope({ body = {}, userId }) {
    if (body.platformModelId) return 'server';
    if (body.apiKey) return 'user';
    if (body.apiKeyId) {
      const key = apiKeyRepository.getApiKeyForUser(body.apiKeyId, userId, false);
      if (!key || !key.isEnabled) {
        throw Object.assign(new Error('API key is not available for this user.'), {
          expose: true,
          status: 403,
        });
      }
      return key.keyScope === 'server' ? 'server' : 'user';
    }
    return 'server';
  }

  function billingInput(estimate) {
    return {
      creditCost: estimate.cost,
      creditKeyScope: publicKeyScope(estimate.keyScope),
      creditPolicy: estimate.keyScope === 'user' ? 'user_key_free' : 'server_key_debit',
      quantity: estimate.quantity,
      unit: estimate.unit,
      unitName: estimate.unitName,
    };
  }

  function createBillableTask({ body = {}, createTask, nodeType, requestMeta = {}, userId }) {
    if (typeof createTask !== 'function') {
      throw new Error('createTask callback is required.');
    }
    const keyScope = resolveTaskKeyScope({ body, userId });
    const estimate = creditPricingService.estimate({ body, keyScope, nodeType });
    const billing = billingInput(estimate);
    const taskBody = {
      ...body,
      billing,
      creditCost: estimate.cost,
      creditKeyScope: billing.creditKeyScope,
      creditStatus: estimate.billable ? 'charged' : 'free',
    };

    const { charge, task } = creditRepository.runWithOptionalDebit({
      amount: estimate.cost,
      createTask: () => createTask(taskBody),
      description: `${nodeType} task queued.`,
      metadata: {
        ...billing,
        model: body.model || '',
        nodeType,
        providerId: body.providerId || '',
        requestMeta,
      },
      userId,
    });

    return {
      account: publicAccount(charge.account),
      billing,
      task,
      transaction: publicTransaction(charge.transaction),
    };
  }

  function refundTask(taskOrId, options = {}) {
    const taskId = typeof taskOrId === 'string' ? taskOrId : taskOrId?.id;
    if (!taskId) return { refunded: false, reason: 'task_id_required' };
    const result = creditRepository.refundTask(taskId, {
      description: options.description || 'Task credits refunded.',
      metadata: options.metadata || {},
    });

    if (result.refunded) {
      taskRepository.addTaskLog(taskId, {
        event: 'credit_refunded',
        message: 'Credits were refunded for this task.',
        data: {
          reason: options.reason || 'task_refund',
          transactionId: result.transaction?.id || '',
          amount: result.transaction?.amount || 0,
        },
      });
    }

    return {
      ...result,
      account: publicAccount(result.account),
      transaction: publicTransaction(result.transaction),
    };
  }

  function listMyTransactions(userId, options = {}) {
    return {
      transactions: creditRepository.listTransactions({ ...options, userId }).map(publicTransaction),
      total: creditRepository.countTransactions({ ...options, userId }),
    };
  }

  function listAdminUsers(options = {}) {
    const users = creditRepository.listAccountsWithUsers(options);
    return {
      count: users.length,
      limit: Number(options.limit || 100),
      offset: Number(options.offset || 0),
      total: creditRepository.countAccountsWithUsers(options),
      users: users.map((item) => ({
        ...item.user,
        creditAccount: publicAccount(item.account),
      })),
    };
  }

  function listAdminTransactions(options = {}) {
    return {
      transactions: creditRepository.listTransactions(options).map(publicTransaction),
      total: creditRepository.countTransactions(options),
    };
  }

  function adjustCredits(req, body = {}) {
    const userId = String(body.userId || '').trim();
    if (!userId) {
      throw Object.assign(new Error('User id is required.'), { expose: true, status: 400 });
    }
    const targetUser = authRepository.getUser(userId);
    if (!targetUser) {
      throw Object.assign(new Error('User not found.'), { expose: true, status: 404 });
    }

    const actorUserId = req?.authUser?.id || '';
    const amount = Number(body.amount);
    const description = String(body.description || body.reason || '').trim() || 'Admin credit adjustment.';
    const metadata = {
      reason: String(body.reason || '').trim(),
      ...requestAuditMeta(req),
    };
    const result = creditRepository.adjustAccount({
      actorUserId,
      amount,
      description,
      metadata,
      userId,
    });

    authRepository.createAuditLog({
      actorUserId,
      action: 'credits.adjust',
      ipAddress: metadata.ipAddress,
      metadata: {
        amount,
        description,
        transactionId: result.transaction.id,
      },
      targetId: userId,
      targetType: 'user',
      userAgent: metadata.userAgent,
    });

    return {
      account: publicAccount(result.account),
      transaction: publicTransaction(result.transaction),
    };
  }

  return {
    adjustCredits,
    createBillableTask,
    ensureUserAccount,
    listAdminTransactions,
    listAdminUsers,
    listMyTransactions,
    refundTask,
    resolveTaskKeyScope,
  };
}

module.exports = {
  createCreditService,
  publicAccount,
  publicKeyScope,
  publicTransaction,
};
