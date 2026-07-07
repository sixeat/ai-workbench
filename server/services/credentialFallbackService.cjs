function credentialAttempts(credentials = {}) {
  const { fallbackCredentials: _fallbackCredentials, ...primary } = credentials || {};
  const fallbackCredentials = Array.isArray(credentials.fallbackCredentials)
    ? credentials.fallbackCredentials
    : [];
  return [primary, ...fallbackCredentials].filter((item) => item && typeof item === 'object');
}

function shouldFallbackAfterUpstreamResult(result = {}) {
  const status = Number(result.status || 0);
  return status === 401
    || status === 403
    || status === 408
    || status === 409
    || status === 425
    || status === 429
    || status >= 500;
}

function credentialAttemptLogData(credentials = {}, attemptIndex = 0) {
  return {
    attempt: attemptIndex + 1,
    apiKeyId: credentials.apiKeyId || '',
    platformModelId: credentials.platformModelId || '',
    platformRouteId: credentials.platformRouteId || '',
    providerId: credentials.providerId || '',
    model: credentials.model || '',
  };
}

function addCredentialFallbackLog(taskRepository, taskId, credentials, result, attemptIndex) {
  taskRepository.addTaskLog(taskId, {
    level: 'warn',
    event: 'platform_model_route_fallback',
    message: 'Platform model route failed. Trying the next enabled route.',
    data: {
      ...credentialAttemptLogData(credentials, attemptIndex),
      upstreamStatus: result?.status || 0,
      upstreamStatusText: result?.statusText || '',
    },
  });
}

module.exports = {
  addCredentialFallbackLog,
  credentialAttemptLogData,
  credentialAttempts,
  shouldFallbackAfterUpstreamResult,
};
