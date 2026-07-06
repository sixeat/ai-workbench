const {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  hashSessionToken,
  parseCookies,
} = require('../auth.cjs');
const { authRepository: defaultAuthRepository } = require('../repositories/authRepository.cjs');

function isSecureRequest(req) {
  return Boolean(req.secure || req.headers?.['x-forwarded-proto'] === 'https');
}

function isSessionUsable(session, nowMs = Date.now()) {
  return Boolean(
    session &&
    new Date(session.expiresAt).getTime() > nowMs &&
    session.user?.isEnabled
  );
}

function createClearCookie(req, sessionCookieOptions, clearCookie = clearSessionCookie) {
  return clearCookie({
    ...sessionCookieOptions,
    secure: sessionCookieOptions.secure ?? isSecureRequest(req),
  });
}

function createSessionMiddleware(options = {}) {
  const {
    clearCookie = clearSessionCookie,
    authRepository = defaultAuthRepository,
    deleteExpired = authRepository.deleteExpiredSessions,
    deleteSession = authRepository.deleteSessionByTokenHash,
    getSession = authRepository.getSessionByTokenHash,
    hashToken = hashSessionToken,
    now = () => Date.now(),
    parseCookieHeader = parseCookies,
    sessionCookieName = SESSION_COOKIE_NAME,
    sessionCookieOptions = {},
  } = options;

  return (req, res, next) => {
    deleteExpired();
    const cookies = parseCookieHeader(req.headers?.cookie || '');
    const token = cookies[sessionCookieName];
    if (!token) return next();

    const session = getSession(hashToken(token));
    if (!isSessionUsable(session, now())) {
      if (session) deleteSession(session.tokenHash);
      res.setHeader('Set-Cookie', createClearCookie(req, sessionCookieOptions, clearCookie));
      return next();
    }

    req.authUser = session.user;
    req.authSession = session;
    return next();
  };
}

module.exports = {
  createClearCookie,
  createSessionMiddleware,
  isSecureRequest,
  isSessionUsable,
};
