const fs = require('fs').promises;

function createSecretService({ deploymentMode, env, secretsPath }) {
  async function readSecrets() {
    if (deploymentMode === 'server') {
      return {
        baseUrl: env.WORKBENCH_SERVER_BASE_URL || '',
        apiKey: env.WORKBENCH_SERVER_API_KEY || '',
      };
    }

    try {
      const text = await fs.readFile(secretsPath, 'utf8');
      const secrets = JSON.parse(text);
      return {
        ...secrets,
        baseUrl: env.WORKBENCH_SERVER_BASE_URL || secrets.baseUrl,
        apiKey: env.WORKBENCH_SERVER_API_KEY || secrets.apiKey,
      };
    } catch {
      return {
        baseUrl: env.WORKBENCH_SERVER_BASE_URL || '',
        apiKey: env.WORKBENCH_SERVER_API_KEY || '',
      };
    }
  }

  return {
    readSecrets,
  };
}

module.exports = {
  createSecretService,
};
