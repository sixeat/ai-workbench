const assert = require('node:assert/strict');
const test = require('node:test');

const { hashPassword, verifyPassword } = require('./auth.cjs');
const {
  createAuthEmailFlowService,
  hashInvitationCode,
  hashVerificationCode,
} = require('./services/authEmailFlowService.cjs');

function createAuthRepository() {
  const users = new Map();
  const verifications = [];
  const invitations = new Map();

  return {
    invitations,
    users,
    verifications,
    consumeEmailVerification(id) {
      const verification = verifications.find((item) => item.id === id);
      if (!verification || verification.consumedAt) return false;
      verification.consumedAt = '2026-07-06T00:00:00.000Z';
      return true;
    },
    consumeInvitationCode(id) {
      const invitation = Array.from(invitations.values()).find((item) => item.id === id);
      if (!invitation || invitation.disabledAt || invitation.usedCount >= invitation.maxUses) return false;
      invitation.usedCount += 1;
      return true;
    },
    createEmailVerification(input) {
      const verification = {
        ...input,
        attemptCount: 0,
        consumedAt: null,
        id: `verification-${verifications.length + 1}`,
      };
      verifications.push(verification);
      return verification;
    },
    createUser(input) {
      const user = {
        ...input,
        id: `user-${users.size + 1}`,
        isEnabled: input.isEnabled ?? true,
      };
      users.set(user.email, user);
      return user;
    },
    getInvitationCodeByHash(codeHash) {
      return invitations.get(codeHash) || null;
    },
    getLatestEmailVerification(email, purpose) {
      return verifications
        .filter((item) => item.email === email && item.purpose === purpose && !item.consumedAt)
        .at(-1) || null;
    },
    getUserByEmail(email) {
      return users.get(String(email || '').trim().toLowerCase()) || null;
    },
    incrementEmailVerificationAttempts(id) {
      const verification = verifications.find((item) => item.id === id);
      if (!verification) return null;
      verification.attemptCount += 1;
      return verification;
    },
    updateUserPassword(userId, passwordHash) {
      const user = Array.from(users.values()).find((item) => item.id === userId);
      if (!user) return null;
      user.passwordHash = passwordHash;
      return user;
    },
  };
}

function createMailer(deliveries) {
  return async (message, options) => {
    const delivery = {
      devCode: message.code,
      options,
      purpose: message.purpose,
      to: message.to,
    };
    deliveries.push(delivery);
    return delivery;
  };
}

test('auth email flow service requests and verifies invitation registration', async () => {
  const previousPepper = process.env.WORKBENCH_VERIFICATION_CODE_PEPPER;
  process.env.WORKBENCH_VERIFICATION_CODE_PEPPER = 'email-flow-test-pepper';
  const authRepository = createAuthRepository();
  const deliveries = [];
  const rawInvitationCode = 'REGISTER-ADMIN-1';
  authRepository.invitations.set(hashInvitationCode(rawInvitationCode), {
    disabledAt: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    id: 'invitation-1',
    label: 'Admin invite',
    maxUses: 1,
    role: 'admin',
    usedCount: 0,
  });

  try {
    const service = createAuthEmailFlowService({
      allowPublicRegistration: false,
      authRepository,
      deploymentMode: 'server',
      emailCodeTtlMinutes: 10,
      requireInvitationCode: true,
      sendVerificationEmail: createMailer(deliveries),
    });

    const request = await service.requestRegistration({
      email: ' NewAdmin@Example.com ',
      invitationCode: rawInvitationCode,
      name: 'New Admin',
      password: 'register-password-123',
    });

    assert.equal(request.email, 'newadmin@example.com');
    assert.equal(request.delivery.devCode, deliveries[0].devCode);
    assert.match(request.delivery.devCode, /^\d{6}$/);

    const verification = authRepository.getLatestEmailVerification('newadmin@example.com', 'register');
    assert.ok(verification);
    assert.equal(verification.codeHash, hashVerificationCode('newadmin@example.com', request.delivery.devCode));
    assert.equal(verification.payload.invitationId, 'invitation-1');
    assert.equal(verification.payload.invitationRole, 'admin');
    assert.equal(verification.payload.passwordHash.includes('register-password-123'), false);

    const user = service.verifyRegistration({
      code: request.delivery.devCode,
      email: 'newadmin@example.com',
    });

    assert.equal(user.email, 'newadmin@example.com');
    assert.equal(user.role, 'admin');
    assert.equal(verifyPassword('register-password-123', user.passwordHash), true);
    assert.equal(authRepository.invitations.get(hashInvitationCode(rawInvitationCode)).usedCount, 1);
    assert.equal(authRepository.getLatestEmailVerification('newadmin@example.com', 'register'), null);
  } finally {
    if (previousPepper === undefined) delete process.env.WORKBENCH_VERIFICATION_CODE_PEPPER;
    else process.env.WORKBENCH_VERIFICATION_CODE_PEPPER = previousPepper;
  }
});

test('auth email flow service allows public registration without an invitation and honors an optional invitation', async () => {
  const authRepository = createAuthRepository();
  const deliveries = [];
  const rawInvitationCode = 'OPTIONAL-ADMIN-1';
  authRepository.invitations.set(hashInvitationCode(rawInvitationCode), {
    disabledAt: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    id: 'optional-invitation-1',
    label: 'Optional admin invite',
    maxUses: 1,
    role: 'admin',
    usedCount: 0,
  });

  const service = createAuthEmailFlowService({
    allowPublicRegistration: true,
    authRepository,
    deploymentMode: 'local',
    emailCodeTtlMinutes: 10,
    requireInvitationCode: false,
    sendVerificationEmail: createMailer(deliveries),
  });

  const publicRequest = await service.requestRegistration({
    email: 'public@example.com',
    name: 'Public User',
    password: 'register-password-123',
  });
  const publicUser = service.verifyRegistration({
    code: publicRequest.delivery.devCode,
    email: publicRequest.email,
  });
  assert.equal(publicUser.role, 'user');

  const invitedRequest = await service.requestRegistration({
    email: 'optional-admin@example.com',
    invitationCode: rawInvitationCode,
    name: 'Optional Admin',
    password: 'register-password-456',
  });
  const invitedUser = service.verifyRegistration({
    code: invitedRequest.delivery.devCode,
    email: invitedRequest.email,
  });
  assert.equal(invitedUser.role, 'admin');
  assert.equal(authRepository.invitations.get(hashInvitationCode(rawInvitationCode)).usedCount, 1);
});

test('auth email flow service hides unknown password reset accounts and resets enabled users', async () => {
  const authRepository = createAuthRepository();
  const deliveries = [];
  const user = authRepository.createUser({
    email: 'reset-service@example.com',
    name: 'Reset Service',
    passwordHash: hashPassword('old-password-123'),
    role: 'user',
    username: 'reset-service@example.com',
  });
  const service = createAuthEmailFlowService({
    authRepository,
    emailCodeTtlMinutes: 10,
    sendVerificationEmail: createMailer(deliveries),
  });

  const unknown = await service.requestPasswordReset({ email: 'missing-service@example.com' });
  assert.equal(unknown.ok, true);
  assert.equal(unknown.delivery, undefined);
  assert.equal(authRepository.getLatestEmailVerification('missing-service@example.com', 'password-reset'), null);

  const request = await service.requestPasswordReset({ email: user.email });
  assert.equal(request.ok, true);
  assert.match(request.delivery.devCode, /^\d{6}$/);

  const updatedUser = service.verifyPasswordReset({
    code: request.delivery.devCode,
    email: user.email,
    password: 'new-password-456',
  });

  assert.equal(updatedUser.id, user.id);
  assert.equal(verifyPassword('old-password-123', updatedUser.passwordHash), false);
  assert.equal(verifyPassword('new-password-456', updatedUser.passwordHash), true);
  assert.equal(authRepository.getLatestEmailVerification(user.email, 'password-reset'), null);
});
