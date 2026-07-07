const { sendSafeError } = require('../httpErrors.cjs');
const { createCreditService } = require('../services/creditService.cjs');

function registerCreditRoutes(app, context = {}) {
  const {
    creditService = createCreditService(),
    getRequestUserId = (req) => req.authUser?.id || 'local-user',
    requireAdmin,
  } = context;

  app.get('/api/credits/me', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      res.json({ account: creditService.ensureUserAccount(userId) });
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to load credit account.' });
    }
  });

  app.get('/api/credits/transactions', (req, res) => {
    try {
      const userId = getRequestUserId(req);
      res.json(creditService.listMyTransactions(userId, req.query || {}));
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to load credit transactions.' });
    }
  });

  app.get('/api/admin/credits/users', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      res.json(creditService.listAdminUsers(req.query || {}));
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to load credit users.' });
    }
  });

  app.post('/api/admin/credits/adjust', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      res.json(creditService.adjustCredits(req, req.body || {}));
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to adjust credits.' });
    }
  });

  app.get('/api/admin/credits/transactions', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      res.json(creditService.listAdminTransactions(req.query || {}));
    } catch (error) {
      sendSafeError(res, error, { message: 'Unable to load credit transactions.' });
    }
  });
}

module.exports = {
  registerCreditRoutes,
};
