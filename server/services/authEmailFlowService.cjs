const { createHash, randomInt } = require('crypto');
const { hashPassword } = require('../auth.cjs');
const { sendVerificationEmail: defaultSendVerificationEmail } = require('../mailer.cjs');
const { authRepository: defaultAuthRepository } = require('../repositories/authRepository.cjs');

function routeError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

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
  const pepper = process.env.WORKBENCH_VERIFICATION_CODE_PEPPER ||
    process.env.WORKBENCH_KEY_SECRET ||
    process.env.WORKBENCH_KEY_ENCRYPTION_SECRET ||
    '';
  return createHash('sha256')
    .update(`${pepper}:${normalizeEmail(email)}:${String(code).trim()}`)
    .digest('hex');
}

function normalizeInvitationCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function hashInvitationCode(code) {
  return createHash('sha256')
    .update(normalizeInvitationCode(code))
    .digest('hex');
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

function createEmailCodeRateLimit({ windowMs = 60 * 60 * 1000, maxPerEmail = 3, maxPerIp = 20 } = {}) {
  const buckets = new Map();

  function bucketCanLimit(max) {
    return Number.isFinite(Number(max)) && Number(max) > 0;
  }

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

function rejectInvalidEmailVerification(authRepository, verification, maxAttempts = 5) {
  const updatedVerification = verification?.id ? authRepository.incrementEmailVerificationAttempts(verification.id) : null;
  const attempts = updatedVerification?.attemptCount ?? verification?.attemptCount ?? 0;
  if (verification?.id && attempts >= Math.max(1, Number(maxAttempts) || 5)) {
    authRepository.consumeEmailVerification(verification.id);
  }
  throw routeError(400, 'Verification code is expired or invalid.');
}

function createAuthEmailFlowService(options = {}) {
  const {
    allowPublicRegistration = false,
    authRepository = defaultAuthRepository,
    deploymentMode = 'local',
    emailCodeTtlMinutes = 10,
    maxEmailCodeVerifyAttempts = 5,
    requireInvitationCode = false,
    sendVerificationEmail = defaultSendVerificationEmail,
  } = options;

  function verificationExpiresAt() {
    return new Date(Date.now() + Number(emailCodeTtlMinutes || 10) * 60 * 1000).toISOString();
  }

  async function requestRegistration(body = {}) {
    const email = normalizeEmail(body.email);
    const name = String(body.name || email).trim().slice(0, 120);
    const password = String(body.password || '');
    const invitationCode = normalizeInvitationCode(body.invitationCode);
    const passwordError = validatePassword(password);

    if (!isValidEmail(email)) throw routeError(400, 'A valid email is required.');
    if (passwordError) throw routeError(400, passwordError);
    if (authRepository.getUserByEmail(email)) throw routeError(409, 'This email is already registered.');

    let invitation = null;
    if (invitationCode) {
      invitation = authRepository.getInvitationCodeByHash(hashInvitationCode(invitationCode));
      if (!publicInvitationCode(invitation)?.isActive) {
        throw routeError(400, 'Invitation code is invalid or expired.');
      }
    } else if (requireInvitationCode && !allowPublicRegistration) {
      throw routeError(400, 'Invitation code is required.');
    }

    const code = createVerificationCode();
    const expiresAt = verificationExpiresAt();
    authRepository.createEmailVerification({
      codeHash: hashVerificationCode(email, code),
      email,
      expiresAt,
      payload: {
        email,
        invitationId: invitation?.id || null,
        invitationRole: invitation?.role || 'user',
        name,
        passwordHash: hashPassword(password),
      },
      purpose: 'register',
    });

    const delivery = await sendVerificationEmail({ to: email, code, purpose: 'register' }, { deploymentMode });
    return { ok: true, email, expiresAt, delivery };
  }

  function verifyRegistration(body = {}) {
    const email = normalizeEmail(body.email);
    const code = String(body.code || '').trim();

    if (!isValidEmail(email) || !code) throw routeError(400, 'Email and verification code are required.');

    const verification = authRepository.getLatestEmailVerification(email, 'register');
    if (!verification || new Date(verification.expiresAt).getTime() <= Date.now()) {
      throw routeError(400, 'Verification code is expired or invalid.');
    }

    if (verification.codeHash !== hashVerificationCode(email, code)) {
      rejectInvalidEmailVerification(authRepository, verification, maxEmailCodeVerifyAttempts);
    }

    if (authRepository.getUserByEmail(email)) {
      authRepository.consumeEmailVerification(verification.id);
      throw routeError(409, 'This email is already registered.');
    }

    if (requireInvitationCode && !allowPublicRegistration && !verification.payload?.invitationId) {
      authRepository.consumeEmailVerification(verification.id);
      throw routeError(400, 'Invitation code is invalid or expired.');
    }

    if (verification.payload?.invitationId && !authRepository.consumeInvitationCode(verification.payload.invitationId)) {
      authRepository.consumeEmailVerification(verification.id);
      throw routeError(400, 'Invitation code is invalid or expired.');
    }

    const user = authRepository.createUser({
      email,
      name: verification.payload?.name || email,
      passwordHash: verification.payload?.passwordHash,
      role: verification.payload?.invitationRole === 'admin' ? 'admin' : 'user',
      username: email,
    });
    authRepository.consumeEmailVerification(verification.id);
    return user;
  }

  async function requestPasswordReset(body = {}) {
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) throw routeError(400, 'A valid email is required.');

    const expiresAt = verificationExpiresAt();
    const user = authRepository.getUserByEmail(email);
    if (!user?.isEnabled) return { ok: true, email, expiresAt };

    const code = createVerificationCode();
    authRepository.createEmailVerification({
      codeHash: hashVerificationCode(email, code),
      email,
      expiresAt,
      payload: { userId: user.id },
      purpose: 'password-reset',
    });

    const delivery = await sendVerificationEmail({ to: email, code, purpose: 'password reset' }, { deploymentMode });
    return { ok: true, email, expiresAt, delivery };
  }

  function verifyPasswordReset(body = {}) {
    const email = normalizeEmail(body.email);
    const code = String(body.code || '').trim();
    const password = String(body.password || '');
    const passwordError = validatePassword(password);

    if (!isValidEmail(email) || !code) throw routeError(400, 'Email and verification code are required.');
    if (passwordError) throw routeError(400, passwordError);

    const verification = authRepository.getLatestEmailVerification(email, 'password-reset');
    if (!verification || new Date(verification.expiresAt).getTime() <= Date.now()) {
      throw routeError(400, 'Verification code is expired or invalid.');
    }

    if (verification.codeHash !== hashVerificationCode(email, code)) {
      rejectInvalidEmailVerification(authRepository, verification, maxEmailCodeVerifyAttempts);
    }

    const user = authRepository.getUserByEmail(email);
    if (!user?.isEnabled || verification.payload?.userId !== user.id) {
      authRepository.consumeEmailVerification(verification.id);
      throw routeError(400, 'Verification code is expired or invalid.');
    }

    const updatedUser = authRepository.updateUserPassword(user.id, hashPassword(password));
    authRepository.consumeEmailVerification(verification.id);
    return updatedUser;
  }

  return {
    requestPasswordReset,
    requestRegistration,
    verifyPasswordReset,
    verifyRegistration,
  };
}

module.exports = {
  createAuthEmailFlowService,
  createEmailCodeRateLimit,
  hashInvitationCode,
  hashVerificationCode,
  isValidEmail,
  normalizeEmail,
  normalizeInvitationCode,
  publicInvitationCode,
  validatePassword,
};
