const { randomBytes } = require('crypto');
const { authRepository: defaultAuthRepository } = require('../repositories/authRepository.cjs');
const {
  hashInvitationCode,
  publicInvitationCode,
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

function createRawInvitationCode() {
  return randomBytes(12).toString('base64url').toUpperCase();
}

function parseExpiresAt(body = {}) {
  if (body.expiresAt) {
    const date = new Date(body.expiresAt);
    if (Number.isNaN(date.getTime())) throw routeError(400, 'Invitation expiration date is invalid.');
    return date.toISOString();
  }

  const expiresInDays = body.expiresInDays ? Math.max(1, Math.min(365, Number(body.expiresInDays))) : 30;
  return new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
}

function createAuthInvitationService(options = {}) {
  const {
    authRepository = defaultAuthRepository,
    getRequestUserId = (req) => req.authUser?.id || 'local-user',
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

  function listInvitations(queryParams = {}) {
    const { limit, offset } = pagination(queryParams);
    const query = {
      limit,
      offset,
      role: queryParams.role,
      search: queryParams.search || queryParams.q,
      status: queryParams.status,
    };
    const invitations = authRepository.listInvitationCodes(query).map(publicInvitationCode);
    return {
      count: invitations.length,
      invitations,
      limit,
      offset,
      total: authRepository.countInvitationCodes(query),
    };
  }

  function createInvitation(req, body = {}) {
    const maxUses = Math.max(1, Math.min(500, Number(body.maxUses || 1)));
    const expiresAt = parseExpiresAt(body);
    const role = body.role === 'admin' ? 'admin' : 'user';
    const rawCode = createRawInvitationCode();
    const invitation = authRepository.createInvitationCode({
      codeHash: hashInvitationCode(rawCode),
      createdBy: req.authUser?.id || getRequestUserId(req),
      expiresAt,
      label: String(body.label || '').trim().slice(0, 120),
      maxUses,
      role,
    });
    auditLog(req, 'admin.invitation.create', 'invitation', invitation.id, {
      expiresAt,
      label: invitation.label || '',
      maxUses,
      role,
    });

    return {
      ...publicInvitationCode(invitation),
      code: rawCode,
    };
  }

  function disableInvitation(req, invitationId) {
    const invitation = authRepository.disableInvitationCode(invitationId);
    if (!invitation) throw routeError(404, 'Invitation not found.');
    auditLog(req, 'admin.invitation.disable', 'invitation', invitation.id, { label: invitation.label || '' });
    return publicInvitationCode(invitation);
  }

  return {
    createInvitation,
    disableInvitation,
    listInvitations,
  };
}

module.exports = {
  createAuthInvitationService,
  createRawInvitationCode,
};
