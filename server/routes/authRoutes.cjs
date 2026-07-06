const { createHash, randomBytes, randomInt } = require('crypto');
const {
  createAuditLog,
  consumeEmailVerification,
  consumeInvitationCode,
  countAuditLogs,
  countInvitationCodes,
  countUsers,
  createEmailVerification,
  createInvitationCode,
  createSession,
  createUser,
  disableInvitationCode,
  deleteSessionForUser,
  deleteSessionsForUser,
  getInvitationCodeByHash,
  getLatestEmailVerification,
  getUserByEmail,
  getUserByUsername,
  listAuditLogs,
  listInvitationCodes,
  listSessionsForUser,
  listUsers,
  updateUserPassword,
  updateUserStatus,
} = require('../db.cjs');
const {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  parseCookies,
  sessionCookie,
  verifyPassword,
} = require('../auth.cjs');
const { sendSafeError } = require('../httpErrors.cjs');
const { sendVerificationEmail } = require('../mailer.cjs');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function validatePassword(value) {
  const password = String(value || '');
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 256) return 'Password is too long.';
  return '';
}

function createVerificationCode() {
  return String(randomInt(100000, 1000000));
}

function hashVerificationCode(email, code) {
  const pepper = process.env.WORKBENCH_VERIFICATION_CODE_PEPPER || process.env.WORKBENCH_KEY_ENCRYPTION_SECRET || '';
  return createHash('sha256')
    .update(`${pepper}:${normalizeEmail(email)}:${String(code).trim()}`)
    .digest('hex');
}

function normalizeInvitationCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function createRawInvitationCode() {
  return randomBytes(12).toString('base64url').toUpperCase();
}

function hashInvitationCode(code) {
  return createHash('sha256')
    .update(normalizeInvitationCode(code))
    .digest('hex');
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

function publicAdminUser(user) {
  const item = publicUser(user);
  if (!item) return null;
  return {
    ...item,
    isEnabled: Boolean(user.isEnabled),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function publicInvitationCode(invitation) {
  if (!invitation) return null;
  return {
    ...invitation,
    isActive: !invitation.disabledAt &&
      invitation.usedCount < invitation.maxUses &&
      (!invitation.expiresAt || new Date(invitation.expiresAt).getTime() > Date.now()),
  };
}

function requestIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function requestUserAgent(req) {
  return String(req.headers?.['user-agent'] || '').slice(0, 500);
}

function publicSession(session, currentSessionId = '') {
  return {
    id: session.id,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    isCurrent: session.id === currentSessionId,
  };
}

function createEmailCodeRateLimit({ windowMs = 60 * 60 * 1000, maxPerEmail = 3, maxPerIp = 20 } = {}) {
  const buckets = new Map();

  function consume(key, max, now) {
    if (!bucketCanLimit(max)) return null;

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const nextBucket = { count: 1, resetAt: now + windowMs };
      buckets.set(key, nextBucket);
      return { blocked: false, resetAt: nextBucket.resetAt };
    }

    bucket.count += 1;
    return {
      blocked: bucket.count > max,
      resetAt: bucket.resetAt,
    };
  }

  function cleanup(now) {
    if (buckets.size <= 10_000) return;
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return function emailCodeRateLimit(purpose) {
    return (req, res, next) => {
      const now = Date.now();
      cleanup(now);

      const email = normalizeEmail(req.body?.email) || 'blank';
      const ip = requestIp(req) || 'unknown';
      const emailResult = consume(`${purpose}:email:${email}`, maxPerEmail, now);
      const ipResult = consume(`${purpose}:ip:${ip}`, maxPerIp, now);
      const blocked = [emailResult, ipResult].filter((item) => item?.blocked);

      if (blocked.length > 0) {
        const retryAt = Math.max(...blocked.map((item) => item.resetAt));
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((retryAt - now) / 1000))));
        return res.status(429).json({ error: 'Too many verification code requests. Please try again later.' });
      }

      return next();
    };
  };
}

function bucketCanLimit(max) {
  return Number.isFinite(Number(max)) && Number(max) > 0;
}

function auditLog(req, action, targetType, targetId, metadata = {}) {
  return createAuditLog({
    actorUserId: req.authUser?.id || null,
    action,
    targetType,
    targetId,
    ipAddress: requestIp(req),
    userAgent: requestUserAgent(req),
    metadata,
  });
}

function createSessionCookieForRequest(req, token, sessionTtlDays, sessionCookieOptions = {}) {
  return sessionCookie(token, {
    ...sessionCookieOptions,
    maxAgeSeconds: sessionTtlDays * 24 * 60 * 60,
    secure: sessionCookieOptions.secure ?? (req.secure || req.headers['x-forwarded-proto'] === 'https'),
  });
}

function signInUser(req, res, user, sessionTtlDays, sessionCookieOptions = {}) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000).toISOString();
  createSession({
    userId: user.id,
    tokenHash: hashSessionToken(token),
    expiresAt,
    ipAddress: requestIp(req),
    userAgent: requestUserAgent(req),
  });

  res.setHeader('Set-Cookie', createSessionCookieForRequest(req, token, sessionTtlDays, sessionCookieOptions));
  res.json({ user: publicUser(user) });
}

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
    windowMs,
  } = context;

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

    const user = getUserByEmail(email, true) || getUserByUsername(email, true);
    if (!user?.isEnabled || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    signInUser(req, res, user, sessionTtlDays, sessionCookieOptions);
  });

  app.post('/api/auth/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) context.deleteSessionByTokenHash(hashSessionToken(token));
    res.setHeader('Set-Cookie', clearSessionCookie({
      ...sessionCookieOptions,
      secure: sessionCookieOptions.secure ?? (req.secure || req.headers['x-forwarded-proto'] === 'https'),
    }));
    res.json({ ok: true });
  });

  app.get('/api/auth/sessions', (req, res) => {
    if (!req.authUser?.id) return res.status(401).json({ error: 'Login is required.' });
    const sessions = listSessionsForUser(req.authUser.id)
      .map((session) => publicSession(session, req.authSession?.id || ''));
    res.json({ sessions, count: sessions.length });
  });

  app.post('/api/auth/sessions/logout-all', (req, res) => {
    if (!req.authUser?.id) return res.status(401).json({ error: 'Login is required.' });
    const deleted = deleteSessionsForUser(req.authUser.id);
    auditLog(req, 'session.logout_all', 'user', req.authUser.id, { deleted });
    res.setHeader('Set-Cookie', clearSessionCookie({
      ...sessionCookieOptions,
      secure: sessionCookieOptions.secure ?? (req.secure || req.headers['x-forwarded-proto'] === 'https'),
    }));
    res.json({ ok: true, deleted });
  });

  app.delete('/api/auth/sessions/:sessionId', (req, res) => {
    if (!req.authUser?.id) return res.status(401).json({ error: 'Login is required.' });
    const sessionId = String(req.params.sessionId || '');
    const isCurrent = Boolean(sessionId && req.authSession?.id === sessionId);
    const deleted = sessionId ? deleteSessionForUser(sessionId, req.authUser.id) : false;
    if (!deleted) return res.status(404).json({ error: 'Session not found.' });

    auditLog(req, 'session.logout_one', 'session', sessionId, { current: isCurrent });
    if (isCurrent) {
      res.setHeader('Set-Cookie', clearSessionCookie({
        ...sessionCookieOptions,
        secure: sessionCookieOptions.secure ?? (req.secure || req.headers['x-forwarded-proto'] === 'https'),
      }));
    }
    res.json({ ok: true, deleted: 1, current: isCurrent });
  });

  app.post('/api/auth/register/request', rateLimit({
    windowMs,
    max: deploymentMode === 'server' ? 5 : 50,
    label: 'register',
  }), emailCodeRateLimit('register'), async (req, res) => {
    try {
      const body = req.body || {};
      const email = normalizeEmail(body.email);
      const name = String(body.name || email).trim().slice(0, 120);
      const password = String(body.password || '');
      const invitationCode = normalizeInvitationCode(body.invitationCode);
      const passwordError = validatePassword(password);

      if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email is required.' });
      if (passwordError) return res.status(400).json({ error: passwordError });
      if (getUserByEmail(email)) return res.status(409).json({ error: 'This email is already registered.' });

      let invitation = null;
      if (requireInvitationCode && !allowPublicRegistration) {
        if (!invitationCode) return res.status(400).json({ error: 'Invitation code is required.' });
        invitation = getInvitationCodeByHash(hashInvitationCode(invitationCode));
        if (!publicInvitationCode(invitation)?.isActive) {
          return res.status(400).json({ error: 'Invitation code is invalid or expired.' });
        }
      }

      const code = createVerificationCode();
      const expiresAt = new Date(Date.now() + emailCodeTtlMinutes * 60 * 1000).toISOString();
      createEmailVerification({
        email,
        purpose: 'register',
        codeHash: hashVerificationCode(email, code),
        payload: {
          email,
          name,
          passwordHash: hashPassword(password),
          invitationId: invitation?.id || null,
          invitationRole: invitation?.role || 'user',
        },
        expiresAt,
      });

      const delivery = await sendVerificationEmail({ to: email, code, purpose: 'register' }, { deploymentMode });
      res.json({ ok: true, email, expiresAt, delivery });
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
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const code = String(body.code || '').trim();

    if (!isValidEmail(email) || !code) return res.status(400).json({ error: 'Email and verification code are required.' });

    const verification = getLatestEmailVerification(email, 'register');
    if (!verification || new Date(verification.expiresAt).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Verification code is expired or invalid.' });
    }

    if (verification.codeHash !== hashVerificationCode(email, code)) {
      return res.status(400).json({ error: 'Verification code is expired or invalid.' });
    }

    if (getUserByEmail(email)) {
      consumeEmailVerification(verification.id);
      return res.status(409).json({ error: 'This email is already registered.' });
    }

    if (requireInvitationCode && !allowPublicRegistration && !verification.payload?.invitationId) {
      consumeEmailVerification(verification.id);
      return res.status(400).json({ error: 'Invitation code is invalid or expired.' });
    }

    if (verification.payload?.invitationId && !consumeInvitationCode(verification.payload.invitationId)) {
      consumeEmailVerification(verification.id);
      return res.status(400).json({ error: 'Invitation code is invalid or expired.' });
    }

    const user = createUser({
      email,
      username: email,
      name: verification.payload?.name || email,
      role: verification.payload?.invitationRole === 'admin' ? 'admin' : 'user',
      passwordHash: verification.payload?.passwordHash,
    });
    consumeEmailVerification(verification.id);
    signInUser(req, res, user, sessionTtlDays, sessionCookieOptions);
  });

  app.post('/api/auth/password-reset/request', rateLimit({
    windowMs,
    max: deploymentMode === 'server' ? 5 : 50,
    label: 'password-reset',
  }), emailCodeRateLimit('password-reset'), async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email is required.' });

      const expiresAt = new Date(Date.now() + emailCodeTtlMinutes * 60 * 1000).toISOString();
      const user = getUserByEmail(email);
      if (!user?.isEnabled) return res.json({ ok: true, email, expiresAt });

      const code = createVerificationCode();
      createEmailVerification({
        email,
        purpose: 'password-reset',
        codeHash: hashVerificationCode(email, code),
        payload: { userId: user.id },
        expiresAt,
      });

      const delivery = await sendVerificationEmail({ to: email, code, purpose: 'password reset' }, { deploymentMode });
      res.json({ ok: true, email, expiresAt, delivery });
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
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    const password = String(req.body?.password || '');
    const passwordError = validatePassword(password);

    if (!isValidEmail(email) || !code) return res.status(400).json({ error: 'Email and verification code are required.' });
    if (passwordError) return res.status(400).json({ error: passwordError });

    const verification = getLatestEmailVerification(email, 'password-reset');
    if (!verification || new Date(verification.expiresAt).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Verification code is expired or invalid.' });
    }

    if (verification.codeHash !== hashVerificationCode(email, code)) {
      return res.status(400).json({ error: 'Verification code is expired or invalid.' });
    }

    const user = getUserByEmail(email);
    if (!user?.isEnabled || verification.payload?.userId !== user.id) {
      consumeEmailVerification(verification.id);
      return res.status(400).json({ error: 'Verification code is expired or invalid.' });
    }

    const updatedUser = updateUserPassword(user.id, hashPassword(password));
    consumeEmailVerification(verification.id);
    signInUser(req, res, updatedUser, sessionTtlDays, sessionCookieOptions);
  });

  app.get('/api/admin/users', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100) || 100));
    const offset = Math.max(0, Number(req.query.offset || 0) || 0);
    const query = {
      limit,
      offset,
      search: req.query.search || req.query.q,
      role: req.query.role,
      status: req.query.status,
    };
    const users = listUsers(query).map(publicAdminUser);
    res.json({
      users,
      count: users.length,
      total: countUsers(query),
      limit,
      offset,
    });
  });

  app.post('/api/admin/users', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const role = body.role === 'admin' ? 'admin' : 'user';
    const name = String(body.name || email).trim().slice(0, 120);
    const passwordError = validatePassword(password);

    if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email is required.' });
    if (passwordError) return res.status(400).json({ error: passwordError });
    if (getUserByEmail(email)) return res.status(409).json({ error: 'This email is already registered.' });

    const user = createUser({
      email,
      username: email,
      name,
      role,
      passwordHash: hashPassword(password),
    });
    auditLog(req, 'admin.user.create', 'user', user.id, { email: user.email, role: user.role });
    res.status(201).json({ user: publicAdminUser(user) });
  });

  app.patch('/api/admin/users/:userId/password', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const password = String(req.body?.password || '');
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const user = updateUserPassword(req.params.userId, hashPassword(password));
    if (!user) return res.status(404).json({ error: 'User not found.' });
    auditLog(req, 'admin.user.password_update', 'user', user.id, { email: user.email });
    res.json({ user: publicAdminUser(user) });
  });

  app.patch('/api/admin/users/:userId/status', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const isEnabled = Boolean(req.body?.isEnabled);
    if (req.params.userId === req.authUser?.id && !isEnabled) {
      return res.status(400).json({ error: 'You cannot disable your own account.' });
    }

    const user = updateUserStatus(req.params.userId, isEnabled);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    auditLog(req, 'admin.user.status_update', 'user', user.id, { email: user.email, isEnabled });
    res.json({ user: publicAdminUser(user) });
  });

  app.get('/api/admin/audit-logs', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const queryParams = req.query || {};
    const query = {
      limit: queryParams.limit,
      offset: queryParams.offset,
      action: queryParams.action,
      targetType: queryParams.targetType,
      targetId: queryParams.targetId,
      actorUserId: queryParams.actorUserId,
      search: queryParams.search || queryParams.q,
    };
    const logs = listAuditLogs(query);
    res.json({
      logs,
      count: logs.length,
      total: countAuditLogs(query),
      limit: Math.max(1, Math.min(500, Number(queryParams.limit || 100) || 100)),
      offset: Math.max(0, Number(queryParams.offset || 0) || 0),
    });
  });

  app.get('/api/admin/invitations', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100) || 100));
    const offset = Math.max(0, Number(req.query.offset || 0) || 0);
    const query = {
      limit,
      offset,
      search: req.query.search || req.query.q,
      role: req.query.role,
      status: req.query.status,
    };
    const invitations = listInvitationCodes(query).map(publicInvitationCode);
    res.json({
      invitations,
      count: invitations.length,
      total: countInvitationCodes(query),
      limit,
      offset,
    });
  });

  app.post('/api/admin/invitations', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = req.body || {};
    const maxUses = Math.max(1, Math.min(500, Number(body.maxUses || 1)));
    const expiresInDays = body.expiresInDays ? Math.max(1, Math.min(365, Number(body.expiresInDays))) : 30;
    const expiresAt = body.expiresAt
      ? new Date(body.expiresAt).toISOString()
      : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    const role = body.role === 'admin' ? 'admin' : 'user';
    const rawCode = createRawInvitationCode();
    const invitation = createInvitationCode({
      codeHash: hashInvitationCode(rawCode),
      label: String(body.label || '').trim().slice(0, 120),
      role,
      maxUses,
      expiresAt,
      createdBy: req.authUser?.id || getRequestUserId(req),
    });
    auditLog(req, 'admin.invitation.create', 'invitation', invitation.id, {
      role,
      maxUses,
      expiresAt,
      label: invitation.label || '',
    });

    res.status(201).json({
      invitation: {
        ...publicInvitationCode(invitation),
        code: rawCode,
      },
    });
  });

  app.delete('/api/admin/invitations/:invitationId', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const invitation = disableInvitationCode(req.params.invitationId);
    if (!invitation) return res.status(404).json({ error: 'Invitation not found.' });
    auditLog(req, 'admin.invitation.disable', 'invitation', invitation.id, { label: invitation.label || '' });
    res.json({ invitation: publicInvitationCode(invitation) });
  });
}

module.exports = {
  createEmailCodeRateLimit,
  publicUser,
  registerAuthRoutes,
};
