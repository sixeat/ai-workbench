function resolveInternalServiceToken(env = process.env) {
  return String(env.WORKBENCH_INTERNAL_SERVICE_TOKEN || '').trim();
}

function normalizeProtectedPrefix(prefix) {
  return String(prefix || '').split('?')[0].replace(/\/+$/, '') || '/';
}

function pathMatchesProtectedPrefix(pathname = '', prefixes = []) {
  const normalized = normalizeProtectedPrefix(pathname);
  return prefixes.some((prefix) => {
    const protectedPrefix = normalizeProtectedPrefix(prefix);
    return normalized === protectedPrefix || normalized.startsWith(`${protectedPrefix}/`);
  });
}

function internalUserId(req) {
  return String(req.headers['x-workbench-user-id'] || '').trim();
}

function internalUserRole(req) {
  const role = String(req.headers['x-workbench-user-role'] || '').trim();
  return ['admin', 'local', 'user'].includes(role) ? role : 'user';
}

function createInternalServiceIdentityMiddleware(options = {}) {
  const {
    defaultUserId = 'local-user',
    deployment = 'server',
    protectedPrefixes = [],
    publicPaths = ['/api/health'],
    token = '',
  } = options;

  return (req, res, next) => {
    const path = String(req.path || '');
    if (!path.startsWith('/api')) return next();
    if (publicPaths.includes(path)) return next();
    if (!pathMatchesProtectedPrefix(path, protectedPrefixes)) return next();

    if (token && String(req.headers['x-workbench-internal-token'] || '') !== token) {
      return res.status(403).json({ error: 'Internal service token is required.' });
    }

    if (req.authUser?.id) return next();

    const userId = internalUserId(req);
    if (userId) {
      req.authUser = {
        id: userId,
        role: internalUserRole(req),
      };
      return next();
    }

    if (deployment === 'server') {
      return res.status(401).json({ error: 'Gateway user context is required.' });
    }

    req.authUser = {
      id: defaultUserId,
      role: 'local',
    };
    return next();
  };
}

module.exports = {
  createInternalServiceIdentityMiddleware,
  internalUserRole,
  pathMatchesProtectedPrefix,
  resolveInternalServiceToken,
};
