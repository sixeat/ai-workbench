const {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  createSessionToken,
  hashSessionToken,
  parseCookies,
  sessionCookie,
  verifyPassword,
} = require('../auth.cjs');
const { authRepository: defaultAuthRepository } = require('../repositories/authRepository.cjs');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function requestIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function requestUserAgent(req) {
  return String(req.headers?.['user-agent'] || '').slice(0, 500);
}

function isSecureRequest(req) {
  return Boolean(req.secure || req.headers?.['x-forwarded-proto'] === 'https');
}

function publicUser(user) {
  if (!user) return null;
  return {
    email: user.email,
    id: user.id,
    name: user.name,
    role: user.role,
    username: user.username,
  };
}

function publicSession(session, currentSessionId = '') {
  return {
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    id: session.id,
    ipAddress: session.ipAddress,
    isCurrent: session.id === currentSessionId,
    updatedAt: session.updatedAt,
    userAgent: session.userAgent,
  };
}

function createSessionCookieForRequest(req, token, sessionTtlDays, sessionCookieOptions = {}) {
  return sessionCookie(token, {
    ...sessionCookieOptions,
    maxAgeSeconds: sessionTtlDays * 24 * 60 * 60,
    secure: sessionCookieOptions.secure ?? isSecureRequest(req),
  });
}

function createClearSessionCookieForRequest(req, sessionCookieOptions = {}) {
  return clearSessionCookie({
    ...sessionCookieOptions,
    secure: sessionCookieOptions.secure ?? isSecureRequest(req),
  });
}

function createAuthSessionService(options = {}) {
  const {
    authRepository = defaultAuthRepository,
    sessionCookieOptions = {},
    sessionTtlDays = 14,
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

  function signInUser(req, user) {
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000).toISOString();
    authRepository.createSession({
      expiresAt,
      ipAddress: requestIp(req),
      tokenHash: hashSessionToken(token),
      userAgent: requestUserAgent(req),
      userId: user.id,
    });

    return {
      cookie: createSessionCookieForRequest(req, token, sessionTtlDays, sessionCookieOptions),
      user: publicUser(user),
    };
  }

  function signInWithPassword(req, identifier, password) {
    const email = normalizeEmail(identifier);
    const user = authRepository.getUserByEmail(email, true) ||
      authRepository.getUserByUsername(email, true);
    if (!user?.isEnabled || !verifyPassword(password, user.passwordHash)) return null;
    return signInUser(req, user);
  }

  function logoutByRequest(req) {
    const cookies = parseCookies(req.headers?.cookie || '');
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) authRepository.deleteSessionByTokenHash(hashSessionToken(token));
    return {
      cookie: createClearSessionCookieForRequest(req, sessionCookieOptions),
      ok: true,
    };
  }

  function listSessionsForRequest(req) {
    const sessions = authRepository.listSessionsForUser(req.authUser.id)
      .map((session) => publicSession(session, req.authSession?.id || ''));
    return {
      count: sessions.length,
      sessions,
    };
  }

  function logoutAllSessions(req) {
    const deleted = authRepository.deleteSessionsForUser(req.authUser.id);
    auditLog(req, 'session.logout_all', 'user', req.authUser.id, { deleted });
    return {
      cookie: createClearSessionCookieForRequest(req, sessionCookieOptions),
      deleted,
      ok: true,
    };
  }

  function logoutSession(req, sessionId) {
    const isCurrent = Boolean(sessionId && req.authSession?.id === sessionId);
    const deleted = sessionId ? authRepository.deleteSessionForUser(sessionId, req.authUser.id) : false;
    if (!deleted) return null;

    auditLog(req, 'session.logout_one', 'session', sessionId, { current: isCurrent });
    return {
      cookie: isCurrent ? createClearSessionCookieForRequest(req, sessionCookieOptions) : '',
      current: isCurrent,
      deleted: 1,
      ok: true,
    };
  }

  return {
    listSessionsForRequest,
    logoutAllSessions,
    logoutByRequest,
    logoutSession,
    signInUser,
    signInWithPassword,
  };
}

module.exports = {
  createAuthSessionService,
  createClearSessionCookieForRequest,
  createSessionCookieForRequest,
  publicSession,
  publicUser,
};
