const { isApiRequestAuthorized } = require('../security.cjs');

function shouldSkipApiAuth(pathname = '') {
  return pathname === '/health' || pathname.startsWith('/auth/');
}

function createApiAuthMiddleware(options = {}) {
  const {
    accessToken = '',
    isAuthorized = isApiRequestAuthorized,
    requireLogin = true,
  } = options;

  return (req, res, next) => {
    if (shouldSkipApiAuth(req.path || '')) return next();
    if (requireLogin && req.authUser) return next();
    if (requireLogin) return res.status(401).json({ error: 'Login is required.' });
    if (isAuthorized(req, accessToken)) return next();
    return res.status(401).json({ error: 'Access token is required.' });
  };
}

module.exports = {
  createApiAuthMiddleware,
  shouldSkipApiAuth,
};
