const { listProviderTemplates } = require('../providerRegistry.cjs');

function registerProviderRoutes(app) {
  app.get('/api/providers', (req, res) => {
    const providers = listProviderTemplates();
    res.json({ providers, count: providers.length });
  });
}

module.exports = {
  registerProviderRoutes,
};
