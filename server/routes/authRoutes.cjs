const {
  createAuthSessionService,
  publicUser,
} = require('../services/authSessionService.cjs');
const { createAuthAdminUserService } = require('../services/authAdminUserService.cjs');
const { createAuthInvitationService } = require('../services/authInvitationService.cjs');
const {
  createAuthEmailFlowService,
  createEmailCodeRateLimit,
  hashVerificationCode,
  normalizeEmail,
} = require('../services/authEmailFlowService.cjs');
const { sendSafeError } = require('../httpErrors.cjs');

function registerAuthRoutes(app, context) {
  const {
    allowPublicRegistration,
    deploymentMode,
    emailCodeRateLimit = createEmailCodeRateLimit(),
    emailCodeTtlMinutes,
    getRequestUserId,
    rateLimit,
    requireAdmin,
    requireInvitationCode,
    requireLogin,
    sessionCookieOptions = {},
    sessionTtlDays,
    maxEmailCodeVerifyAttempts = 5,
    windowMs,
    authRepository,
  } = context;
  const authSessionService = createAuthSessionService({
    authRepository,
    sessionCookieOptions,
    sessionTtlDays,
  });
  const authEmailFlowService = createAuthEmailFlowService({
    allowPublicRegistration,
    authRepository,
    deploymentMode,
    emailCodeTtlMinutes,
    maxEmailCodeVerifyAttempts,
    requireInvitationCode,
  });
  const authAdminUserService = createAuthAdminUserService({ authRepository });
  const authInvitationService = createAuthInvitationService({
    authRepository,
    getRequestUserId,
  });

  function respondWithSession(res, result) {
    res.setHeader('Set-Cookie', result.cookie);
    return res.json({ user: result.user });
  }

  app.get('/api/auth/me', (req, res) => {
    res.json({
      authenticated: Boolean(req.authUser),
      user: publicUser(req.authUser || null),
      deploymentMode,
      requireLogin,
      registration: {
        allowPublicRegistration,
        requireInvitationCode,
      },
    });
  });

  app.post('/api/auth/login', rateLimit({
    windowMs,
    max: deploymentMode === 'server' ? 10 : 100,
    label: 'login',
  }), (req, res) => {
    const body = req.body || {};
    const email = normalizeEmail(body.email || body.username);
    const password = String(body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const result = authSessionService.signInWithPassword(req, email, password);
    if (!result) return res.status(401).json({ error: 'Invalid email or password.' });

    return respondWithSession(res, result);
  });

  app.post('/api/auth/logout', (req, res) => {
    const result = authSessionService.logoutByRequest(req);
    res.setHeader('Set-Cookie', result.cookie);
    res.json({ ok: true });
  });

  app.get('/api/auth/sessions', (req, res) => {
    if (!req.authUser?.id) return res.status(401).json({ error: 'Login is required.' });
    res.json(authSessionService.listSessionsForRequest(req));
  });

  app.post('/api/auth/sessions/logout-all', (req, res) => {
    if (!req.authUser?.id) return res.status(401).json({ error: 'Login is required.' });
    const result = authSessionService.logoutAllSessions(req);
    res.setHeader('Set-Cookie', result.cookie);
    res.json({ ok: true, deleted: result.deleted });
  });

  app.delete('/api/auth/sessions/:sessionId', (req, res) => {
    if (!req.authUser?.id) return res.status(401).json({ error: 'Login is required.' });
    const sessionId = String(req.params.sessionId || '');
    const result = authSessionService.logoutSession(req, sessionId);
    if (!result) return res.status(404).json({ error: 'Session not found.' });

    if (result.cookie) res.setHeader('Set-Cookie', result.cookie);
    res.json({ ok: true, deleted: result.deleted, current: result.current });
  });

  app.post('/api/auth/register/request', rateLimit({
    windowMs,
    max: deploymentMode === 'server' ? 5 : 50,
    label: 'register',
  }), emailCodeRateLimit('register'), async (req, res) => {
    try {
      res.json(await authEmailFlowService.requestRegistration(req.body || {}));
    } catch (error) {
      console.error('/api/auth/register/request error:', error.message);
      sendSafeError(res, error, { message: 'Unable to send verification email.' });
    }
  });

  app.post('/api/auth/register/verify', rateLimit({
    windowMs,
    max: deploymentMode === 'server' ? 10 : 100,
    label: 'register-verify',
  }), (req, res) => {
    try {
      const user = authEmailFlowService.verifyRegistration(req.body || {});
      respondWithSession(res, authSessionService.signInUser(req, user));
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to verify registration.' });
    }
  });

  app.post('/api/auth/password-reset/request', rateLimit({
    windowMs,
    max: deploymentMode === 'server' ? 5 : 50,
    label: 'password-reset',
  }), emailCodeRateLimit('password-reset'), async (req, res) => {
    try {
      res.json(await authEmailFlowService.requestPasswordReset(req.body || {}));
    } catch (error) {
      console.error('/api/auth/password-reset/request error:', error.message);
      sendSafeError(res, error, { message: 'Unable to send verification email.' });
    }
  });

  app.post('/api/auth/password-reset/verify', rateLimit({
    windowMs,
    max: deploymentMode === 'server' ? 10 : 100,
    label: 'password-reset-verify',
  }), (req, res) => {
    try {
      const user = authEmailFlowService.verifyPasswordReset(req.body || {});
      respondWithSession(res, authSessionService.signInUser(req, user));
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to reset password.' });
    }
  });

  app.get('/api/admin/users', (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json(authAdminUserService.listUsers(req.query || {}));
  });

  app.post('/api/admin/users', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      res.status(201).json({ user: authAdminUserService.createUser(req, req.body || {}) });
    } catch (error) {
      sendSafeError(res, error);
    }
  });

  app.patch('/api/admin/users/:userId/password', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      res.json({ user: authAdminUserService.updateUserPassword(req, req.params.userId, String(req.body?.password || '')) });
    } catch (error) {
      sendSafeError(res, error);
    }
  });

  app.patch('/api/admin/users/:userId/status', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      res.json({ user: authAdminUserService.updateUserStatus(req, req.params.userId, req.body?.isEnabled) });
    } catch (error) {
      sendSafeError(res, error);
    }
  });

  app.get('/api/admin/audit-logs', (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json(authAdminUserService.listAuditLogs(req.query || {}));
  });

  app.get('/api/admin/invitations', (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json(authInvitationService.listInvitations(req.query || {}));
  });

  app.post('/api/admin/invitations', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      res.status(201).json({ invitation: authInvitationService.createInvitation(req, req.body || {}) });
    } catch (error) {
      sendSafeError(res, error);
    }
  });

  app.delete('/api/admin/invitations/:invitationId', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      res.json({ invitation: authInvitationService.disableInvitation(req, req.params.invitationId) });
    } catch (error) {
      sendSafeError(res, error);
    }
  });
}

module.exports = {
  createEmailCodeRateLimit,
  hashVerificationCode,
  publicUser,
  registerAuthRoutes,
};
