const assert = require('node:assert/strict');
const test = require('node:test');

const { hashInvitationCode } = require('./services/authEmailFlowService.cjs');
const { createAuthInvitationService } = require('./services/authInvitationService.cjs');

function createAuthRepository() {
  const auditLogs = [];
  const invitations = new Map();

  function matchInvitation(invitation, query = {}) {
    if (query.role && invitation.role !== query.role) return false;
    if (query.status === 'disabled' && !invitation.disabledAt) return false;
    if (query.status === 'active') {
      const active = !invitation.disabledAt &&
        invitation.usedCount < invitation.maxUses &&
        (!invitation.expiresAt || new Date(invitation.expiresAt).getTime() > Date.now());
      if (!active) return false;
    }
    if (query.search && !String(invitation.label || '').toLowerCase().includes(String(query.search).toLowerCase())) {
      return false;
    }
    return true;
  }

  return {
    auditLogs,
    invitations,
    countInvitationCodes(query = {}) {
      return Array.from(invitations.values()).filter((invitation) => matchInvitation(invitation, query)).length;
    },
    createAuditLog(log) {
      const next = {
        ...log,
        id: `audit-${auditLogs.length + 1}`,
      };
      auditLogs.push(next);
      return next;
    },
    createInvitationCode(input) {
      const invitation = {
        ...input,
        disabledAt: null,
        id: `invitation-${invitations.size + 1}`,
        usedCount: 0,
      };
      invitations.set(invitation.id, invitation);
      return invitation;
    },
    disableInvitationCode(id) {
      const invitation = invitations.get(id);
      if (!invitation) return null;
      invitation.disabledAt = '2026-07-06T00:00:00.000Z';
      return invitation;
    },
    listInvitationCodes(query = {}) {
      const limit = Number(query.limit || 100);
      const offset = Number(query.offset || 0);
      return Array.from(invitations.values())
        .filter((invitation) => matchInvitation(invitation, query))
        .slice(offset, offset + limit);
    },
  };
}

function createRequest(authUser = { id: 'admin-1' }) {
  return {
    authUser,
    headers: { 'user-agent': 'Invitation Browser' },
    socket: { remoteAddress: '198.51.100.71' },
  };
}

test('auth invitation service creates one-time code and audit log without raw code metadata', () => {
  const authRepository = createAuthRepository();
  const service = createAuthInvitationService({
    authRepository,
    getRequestUserId: () => 'fallback-user',
  });

  const invitation = service.createInvitation(createRequest(), {
    expiresInDays: 7,
    label: 'Character team',
    maxUses: 2,
    role: 'admin',
  });

  assert.equal(invitation.role, 'admin');
  assert.equal(invitation.maxUses, 2);
  assert.match(invitation.code, /^[A-Z0-9_-]+$/);
  assert.equal(invitation.isActive, true);

  const stored = Array.from(authRepository.invitations.values())[0];
  assert.equal(stored.codeHash, hashInvitationCode(invitation.code));
  assert.equal(stored.createdBy, 'admin-1');
  assert.equal(authRepository.auditLogs[0].action, 'admin.invitation.create');
  assert.equal(Object.hasOwn(authRepository.auditLogs[0].metadata, 'code'), false);
});

test('auth invitation service lists and disables invitations', () => {
  const authRepository = createAuthRepository();
  const service = createAuthInvitationService({ authRepository });
  const first = service.createInvitation(createRequest(), {
    label: 'Artist invite',
    role: 'user',
  });
  service.createInvitation(createRequest(), {
    label: 'Admin invite',
    role: 'admin',
  });

  const users = service.listInvitations({ role: 'user' });
  assert.equal(users.count, 1);
  assert.equal(users.total, 1);
  assert.equal(users.invitations[0].label, 'Artist invite');

  const disabled = service.disableInvitation(createRequest(), first.id);
  assert.equal(disabled.isActive, false);
  assert.equal(authRepository.auditLogs.at(-1).action, 'admin.invitation.disable');
});

test('auth invitation service rejects invalid expiration and missing invitation', () => {
  const service = createAuthInvitationService({ authRepository: createAuthRepository() });

  assert.throws(
    () => service.createInvitation(createRequest(), { expiresAt: 'not-a-date' }),
    /expiration date is invalid/
  );
  assert.throws(
    () => service.disableInvitation(createRequest(), 'missing'),
    /Invitation not found/
  );
});
