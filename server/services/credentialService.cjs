const { createCipheriv, createDecipheriv, scryptSync, randomBytes } = require('crypto');
const { apiKeyRepository: defaultApiKeyRepository } = require('../repositories/apiKeyRepository.cjs');

function createCredentialService({
  keyEncryptionSecret,
  deploymentMode = 'local',
  allowDirectCredentials = false,
  apiKeyRepository = defaultApiKeyRepository,
}) {
  function directCredentialsAllowed() {
    return deploymentMode !== 'server' || allowDirectCredentials;
  }

  function assertDirectCredentialsAllowed() {
    if (directCredentialsAllowed()) return;
    throw Object.assign(
      new Error('Direct API credentials are disabled in server mode. Save the key first and call with apiKeyId.'),
      { status: 400, expose: true }
    );
  }

  function encryptionKey() {
    return scryptSync(keyEncryptionSecret, 'ai-workbench-key-encryption-v1', 32);
  }

  function encryptSecret(value) {
    if (!value) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  function decryptSecret(value) {
    if (!value) return '';
    const [version, ivText, tagText, encryptedText] = String(value).split(':');
    if (version !== 'v1') return '';
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  function keyBelongsToUser(apiKey, userId) {
    return apiKey && (apiKey.ownerUserId === userId || apiKey.keyScope === 'server');
  }

  function keyCanBeUsedByUser(apiKey, userId) {
    return keyBelongsToUser(apiKey, userId) && apiKey.isEnabled;
  }

  async function resolveApiCredentials({ userId, body, secrets }) {
    if (body.apiKeyId) {
      const stored = apiKeyRepository.getApiKeyForUser(body.apiKeyId, userId, true);
      if (!keyCanBeUsedByUser(stored, userId)) {
        throw Object.assign(new Error('API key is not available for this user.'), { status: 403 });
      }
      return {
        baseUrl: stored.baseUrl || secrets.baseUrl || '',
        apiKey: decryptSecret(stored.encryptedKey),
        providerId: body.providerId || stored.providerId || 'openai-compatible',
        keyScope: stored.keyScope,
      };
    }

    if (body.apiKey) {
      assertDirectCredentialsAllowed();
      return {
        baseUrl: body.baseUrl || '',
        apiKey: body.apiKey,
        providerId: body.providerId || 'openai-compatible',
        keyScope: 'user',
      };
    }

    return {
      baseUrl: secrets.baseUrl || '',
      apiKey: secrets.apiKey || '',
      providerId: body.providerId || 'openai-compatible',
      keyScope: 'server',
    };
  }

  function resolveDirectCredentials(body, secrets) {
    if (body.apiKey) {
      assertDirectCredentialsAllowed();
      return {
        baseUrl: body.baseUrl || '',
        apiKey: body.apiKey,
      };
    }

    if (body.baseUrl && body.baseUrl !== secrets.baseUrl) {
      assertDirectCredentialsAllowed();
      return {
        baseUrl: body.baseUrl,
        apiKey: '',
      };
    }

    return {
      baseUrl: secrets.baseUrl || '',
      apiKey: secrets.apiKey || '',
    };
  }

  return {
    decryptSecret,
    encryptSecret,
    keyBelongsToUser,
    resolveApiCredentials,
    resolveDirectCredentials,
  };
}

module.exports = {
  createCredentialService,
};
