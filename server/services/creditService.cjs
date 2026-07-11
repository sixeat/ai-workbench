const { apiKeyRepository: defaultApiKeyRepository } = require('../repositories/apiKeyRepository.cjs');
const { apiKeyModelRepository: defaultApiKeyModelRepository } = require('../repositories/apiKeyModelRepository.cjs');
const { authRepository: defaultAuthRepository } = require('../repositories/authRepository.cjs');
const { creditRepository: defaultCreditRepository } = require('../repositories/creditRepository.cjs');
const { platformModelRepository: defaultPlatformModelRepository } = require('../repositories/platformModelRepository.cjs');
const { taskRepository: defaultTaskRepository } = require('../repositories/taskRepository.cjs');
const { filterImageBodyByCapabilities, filterVideoBodyByCapabilities } = require('../modelCapabilities.cjs');
const { createCreditPricingService } = require('./creditPricingService.cjs');
const { createPlatformModelService } = require('./platformModelService.cjs');

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
  apiKeyModelRepository = defaultApiKeyModelRepository,
  authRepository = defaultAuthRepository,
  creditPricingService = createCreditPricingService(),
  creditRepository = defaultCreditRepository,
  platformModelRepository = defaultPlatformModelRepository,
  taskRepository = defaultTaskRepository,
} = {}) {
  const platformModelService = createPlatformModelService({ repository: platformModelRepository });

  function ensureUserAccount(userId) {
    return publicAccount(creditRepository.getOrCreateAccount(userId));
  }

  function resolveTaskKeyScope({ body = {}, userId }) {
    if (body.platformModelId) return 'server';
    if (body.apiKey) return 'user';
    if (body.apiKeyModelId) {
      const model = apiKeyModelRepository.getApiKeyModelForUser(body.apiKeyModelId, userId, false);
      if (!model || !model.isEnabled || model.discoveryStatus !== 'active') {
        throw Object.assign(new Error('API key model is not available for this user.'), {
          expose: true,
          status: 403,
        });
      }
      return 'user';
    }
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

  function selectionCapabilities({ body = {}, userId }) {
    if (body.platformModelId) {
      const model = platformModelService.getPublicPlatformModel(body.platformModelId);
      if (!model) {
        throw Object.assign(new Error('Platform model is not available.'), { expose: true, status: 409 });
      }
      return model.capabilities || {};
    }

    if (body.apiKeyModelId) {
      const model = apiKeyModelRepository.getApiKeyModelForUser(body.apiKeyModelId, userId, false);
      if (!model || !model.isEnabled || model.discoveryStatus !== 'active') {
        throw Object.assign(new Error('API key model is not available for this user.'), {
          expose: true,
          status: 403,
        });
      }
      return model.capabilities || {};
    }

    return null;
  }

  function assertTaskModelCapabilities({ body = {}, nodeType, userId }) {
    const capabilities = selectionCapabilities({ body, userId });
    if (!capabilities) return;

    let validation;
    if (nodeType === 'text') {
      if (capabilities.chat) return;
      validation = { ok: false, error: 'The selected model does not support text generation.' };
    } else if (nodeType === 'image') {
      validation = filterImageBodyByCapabilities(body, capabilities);
    } else if (nodeType === 'video') {
      validation = filterVideoBodyByCapabilities(body, capabilities);
    } else {
      return;
    }

    if (!validation.ok) {
      throw Object.assign(new Error(validation.error || 'Model capability validation failed.'), {
        expose: true,
        status: 400,
      });
    }
  }

  function createBillableTask({ body = {}, createTask, nodeType, requestMeta = {}, userId }) {
    if (typeof createTask !== 'function') {
      throw new Error('createTask callback is required.');
    }
    assertTaskModelCapabilities({ body, nodeType, userId });
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
    assertTaskModelCapabilities,
    resolveTaskKeyScope,
  };
}

module.exports = {
  createCreditService,
  publicAccount,
  publicKeyScope,
  publicTransaction,
};
