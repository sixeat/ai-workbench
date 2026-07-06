const {
  getRequestUserId: resolveRequestUserId,
  isAdminRequestAuthorized,
} = require('../security.cjs');

function createRequireAdmin(options = {}) {
  const {
    adminToken = '',
    deploymentMode = 'server',
    isAdminAuthorized = isAdminRequestAuthorized,
  } = options;

  return function requireAdmin(req, res) {
    if (req.authUser?.role === 'admin') return true;
    if (isAdminAuthorized(req, adminToken, deploymentMode)) return true;
    res.status(403).json({ error: 'Admin token is required.' });
    return false;
  };
}

function createRequestUserIdResolver(options = {}) {
  const {
    defaultUserId,
    resolveUserId = resolveRequestUserId,
    trustClientUserId = false,
  } = options;

  return function getRequestUserId(req) {
    if (req.authUser?.id) return req.authUser.id;
    return resolveUserId(req, defaultUserId, { trustClientUserId });
  };
}

module.exports = {
  createRequestUserIdResolver,
  createRequireAdmin,
};
