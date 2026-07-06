const { hashPassword } = require('../auth.cjs');
const { authRepository: defaultAuthRepository } = require('../repositories/authRepository.cjs');
const { publicUser } = require('./authSessionService.cjs');
const {
  isValidEmail,
  normalizeEmail,
  validatePassword,
} = require('./authEmailFlowService.cjs');

function routeError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function requestIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function requestUserAgent(req) {
  return String(req.headers?.['user-agent'] || '').slice(0, 500);
}

function pagination(query = {}, defaultLimit = 100, maxLimit = 500) {
  return {
    limit: Math.max(1, Math.min(maxLimit, Number(query.limit || defaultLimit) || defaultLimit)),
    offset: Math.max(0, Number(query.offset || 0) || 0),
  };
}

function publicAdminUser(user) {
  const item = publicUser(user);
  if (!item) return null;
  return {
    ...item,
    createdAt: user.createdAt,
    isEnabled: Boolean(user.isEnabled),
    updatedAt: user.updatedAt,
  };
}

function createAuthAdminUserService(options = {}) {
  const {
    authRepository = defaultAuthRepository,
  } = options;

  function auditLog(req, action, targetType, targetId, metadata = {}) {
    return authRepository.createAuditLog({
      action,
      actorUserId: req.authUser?.id || null,
      ipAddress: requestIp(req),
      metadata,
      targetId,
      targetType,
      userAgent: requestUserAgent(req),
    });
  }

  function listUsers(queryParams = {}) {
    const { limit, offset } = pagination(queryParams);
    const query = {
      limit,
      offset,
      role: queryParams.role,
      search: queryParams.search || queryParams.q,
      status: queryParams.status,
    };
    const users = authRepository.listUsers(query).map(publicAdminUser);
    return {
      count: users.length,
      limit,
      offset,
      total: authRepository.countUsers(query),
      users,
    };
  }

  function createUser(req, body = {}) {
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const role = body.role === 'admin' ? 'admin' : 'user';
    const name = String(body.name || email).trim().slice(0, 120);
    const passwordError = validatePassword(password);

    if (!isValidEmail(email)) throw routeError(400, 'A valid email is required.');
    if (passwordError) throw routeError(400, passwordError);
    if (authRepository.getUserByEmail(email)) throw routeError(409, 'This email is already registered.');

    const user = authRepository.createUser({
      email,
      name,
      passwordHash: hashPassword(password),
      role,
      username: email,
    });
    auditLog(req, 'admin.user.create', 'user', user.id, { email: user.email, role: user.role });
    return publicAdminUser(user);
  }

  function updateUserPassword(req, userId, password) {
    const passwordError = validatePassword(password);
    if (passwordError) throw routeError(400, passwordError);

    const user = authRepository.updateUserPassword(userId, hashPassword(password));
    if (!user) throw routeError(404, 'User not found.');
    auditLog(req, 'admin.user.password_update', 'user', user.id, { email: user.email });
    return publicAdminUser(user);
  }

  function updateUserStatus(req, userId, isEnabled) {
    const nextIsEnabled = Boolean(isEnabled);
    if (userId === req.authUser?.id && !nextIsEnabled) {
      throw routeError(400, 'You cannot disable your own account.');
    }

    const previousUser = authRepository.getUser(userId);
    const previousIsEnabled = previousUser ? Boolean(previousUser.isEnabled) : undefined;
    const user = authRepository.updateUserStatus(userId, nextIsEnabled);
    if (!user) throw routeError(404, 'User not found.');
    auditLog(req, 'admin.user.status_update', 'user', user.id, {
      email: user.email,
      isEnabled: nextIsEnabled,
      previousIsEnabled,
    });
    return publicAdminUser(user);
  }

  function listAuditLogs(queryParams = {}) {
    const { limit, offset } = pagination(queryParams);
    const query = {
      action: queryParams.action,
      actorUserId: queryParams.actorUserId,
      limit,
      offset,
      search: queryParams.search || queryParams.q,
      targetId: queryParams.targetId,
      targetType: queryParams.targetType,
    };
    const logs = authRepository.listAuditLogs(query);
    return {
      count: logs.length,
      limit,
      logs,
      offset,
      total: authRepository.countAuditLogs(query),
    };
  }

  return {
    createUser,
    listAuditLogs,
    listUsers,
    updateUserPassword,
    updateUserStatus,
  };
}

module.exports = {
  createAuthAdminUserService,
  publicAdminUser,
};
