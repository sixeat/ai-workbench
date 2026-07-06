const db = require('../db.cjs');

function createAuthRepository(overrides = {}) {
  return {
    consumeEmailVerification: overrides.consumeEmailVerification || db.consumeEmailVerification,
    consumeInvitationCode: overrides.consumeInvitationCode || db.consumeInvitationCode,
    countAuditLogs: overrides.countAuditLogs || db.countAuditLogs,
    countAllUsers: overrides.countAllUsers || db.countAllUsers,
    countEnabledUsers: overrides.countEnabledUsers || db.countEnabledUsers,
    countInvitationCodes: overrides.countInvitationCodes || db.countInvitationCodes,
    countUsers: overrides.countUsers || db.countUsers,
    createAuditLog: overrides.createAuditLog || db.createAuditLog,
    createEmailVerification: overrides.createEmailVerification || db.createEmailVerification,
    createInvitationCode: overrides.createInvitationCode || db.createInvitationCode,
    createSession: overrides.createSession || db.createSession,
    createUser: overrides.createUser || db.createUser,
    deleteExpiredSessions: overrides.deleteExpiredSessions || db.deleteExpiredSessions,
    deleteSessionByTokenHash: overrides.deleteSessionByTokenHash || db.deleteSessionByTokenHash,
    deleteSessionForUser: overrides.deleteSessionForUser || db.deleteSessionForUser,
    deleteSessionsForUser: overrides.deleteSessionsForUser || db.deleteSessionsForUser,
    disableInvitationCode: overrides.disableInvitationCode || db.disableInvitationCode,
    getInvitationCodeByHash: overrides.getInvitationCodeByHash || db.getInvitationCodeByHash,
    getLatestEmailVerification: overrides.getLatestEmailVerification || db.getLatestEmailVerification,
    getSessionByTokenHash: overrides.getSessionByTokenHash || db.getSessionByTokenHash,
    getUser: overrides.getUser || db.getUser,
    getUserByEmail: overrides.getUserByEmail || db.getUserByEmail,
    getUserByUsername: overrides.getUserByUsername || db.getUserByUsername,
    incrementEmailVerificationAttempts: overrides.incrementEmailVerificationAttempts || db.incrementEmailVerificationAttempts,
    listAuditLogs: overrides.listAuditLogs || db.listAuditLogs,
    listInvitationCodes: overrides.listInvitationCodes || db.listInvitationCodes,
    listSessionsForUser: overrides.listSessionsForUser || db.listSessionsForUser,
    listUsers: overrides.listUsers || db.listUsers,
    updateUserPassword: overrides.updateUserPassword || db.updateUserPassword,
    updateUserStatus: overrides.updateUserStatus || db.updateUserStatus,
    upsertBootstrapUser: overrides.upsertBootstrapUser || db.upsertBootstrapUser,
  };
}

const authRepository = createAuthRepository();

module.exports = {
  authRepository,
  createAuthRepository,
};
