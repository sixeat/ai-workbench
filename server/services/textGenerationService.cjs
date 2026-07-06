const { randomUUID } = require('crypto');
const {
  addTaskLog,
  createTask,
  getTask,
  updateTask,
} = require('../db.cjs');
const { safeTaskError, safeUpstreamErrorData, safeUpstreamTaskError } = require('../httpErrors.cjs');
const { getTextProviderAdapter } = require('./textProviderAdapters.cjs');

function stripSecretFields(body = {}) {
  const {
    apiKey: _apiKey,
    userId: _userId,
    ...safeBody
  } = body || {};
  return safeBody;
}

function inferTextModel(body = {}) {
  return String(body.model || body.messages?.[0]?.model || '').trim();
}

function taskWasCancelled(taskId) {
  return getTask(taskId)?.status === 'cancelled';
}

function createTextTask(userId, body, status = 'queued') {
  const requestKind = body.requestKind === 'claude' ? 'claude' : 'chat';
  const safeBody = stripSecretFields(body);
  return createTask({
    id: randomUUID(),
    userId,
    nodeType: 'text',
    providerId: safeBody.providerId || (requestKind === 'claude' ? 'anthropic' : 'openai-compatible'),
    model: inferTextModel(safeBody),
    status,
    retryOf: safeBody.retryOf || null,
    input: {
      ...safeBody,
      requestKind,
      baseUrl: safeBody.apiKeyId ? '' : safeBody.baseUrl || '',
      apiKeyId: safeBody.apiKeyId || '',
      messageCount: Array.isArray(safeBody.messages) ? safeBody.messages.length : 0,
      hasSystem: Boolean(safeBody.system),
      upstreamTaskIds: Array.isArray(safeBody.upstreamTaskIds) ? safeBody.upstreamTaskIds : [],
    },
  });
}

function createTextGenerationService({
  joinUrl,
  proxyRequest,
  resolveApiCredentials,
  resolveDirectCredentials,
}) {
  async function resolveRequestCredentials({ userId, body, secrets }) {
    if (body.apiKeyId) {
      return resolveApiCredentials({ userId, body, secrets });
    }
    const direct = resolveDirectCredentials(body, secrets);
    return {
      ...direct,
      providerId: body.providerId || (body.requestKind === 'claude' ? 'anthropic' : 'openai-compatible'),
    };
  }

  async function runTextTask({ userId, body = {}, secrets, task }) {
    const startedAt = Date.now();
    const activeTask = task || createTextTask(userId, body, 'running');
    const taskBody = {
      ...(activeTask.input || {}),
      ...body,
    };

    try {
      if (taskWasCancelled(activeTask.id)) {
        addTaskLog(activeTask.id, {
          level: 'warn',
          event: 'cancelled_before_start',
          message: 'Task was cancelled before the text worker started.',
        });
        return { status: 409, data: { error: 'Task was cancelled.' } };
      }

      const { baseUrl, apiKey, providerId: credentialProviderId } = await resolveRequestCredentials({
        userId,
        body: taskBody,
        secrets,
      });

      if (!baseUrl) {
        updateTask(activeTask.id, {
          status: 'failed',
          error: { message: 'Base URL is required' },
          durationMs: Date.now() - startedAt,
        });
        return { status: 400, data: { error: 'Base URL is required' } };
      }

      if (!apiKey) {
        updateTask(activeTask.id, {
          status: 'failed',
          error: { message: 'API key is required' },
          durationMs: Date.now() - startedAt,
        });
        return { status: 400, data: { error: 'API key is required' } };
      }

      const requestKind = taskBody.requestKind === 'claude' ? 'claude' : 'chat';
      const providerId = credentialProviderId || taskBody.providerId || (requestKind === 'claude' ? 'anthropic' : 'openai-compatible');
      const adapter = getTextProviderAdapter(providerId, requestKind === 'claude' ? 'anthropic' : undefined);
      const request = adapter.buildRequest({ apiKey, body: taskBody, providerId });
      const result = await proxyRequest(joinUrl(baseUrl, adapter.endpoint(providerId)), {
        method: 'POST',
        headers: request.headers,
        body: request.body,
      });

      addTaskLog(activeTask.id, {
        event: 'upstream_text_response',
        message: `Text upstream responded with HTTP ${result.status}.`,
        data: {
          upstreamStatus: result.status,
          providerId,
          model: taskBody.model || '',
        },
      });

      if (taskWasCancelled(activeTask.id)) {
        addTaskLog(activeTask.id, {
          level: 'warn',
          event: 'cancelled_after_upstream',
          message: 'Text upstream request finished after cancellation; output was not written.',
          data: {
            upstreamStatus: result.status,
            providerId,
            model: taskBody.model || '',
          },
        });
        return { status: 409, data: { error: 'Task was cancelled.' } };
      }

      if (result.status >= 400) {
        updateTask(activeTask.id, {
          status: 'failed',
          error: safeUpstreamTaskError(result, 'Text generation upstream request failed.'),
          durationMs: Date.now() - startedAt,
        });
        return { status: result.status, data: safeUpstreamErrorData(result, 'Text generation upstream request failed.') };
      }

      updateTask(activeTask.id, {
        status: 'succeeded',
        output: result.data,
        error: null,
        durationMs: Date.now() - startedAt,
      });

      return {
        status: result.status,
        data: {
          ...result.data,
          taskId: activeTask.id,
        },
      };
    } catch (error) {
      console.error('/api/text task error:', error);
      if (!taskWasCancelled(activeTask.id)) {
        updateTask(activeTask.id, {
          status: 'failed',
          error: safeTaskError(error, 'Text generation failed.'),
          durationMs: Date.now() - startedAt,
        });
      }
      return { status: error.status || 500, data: { error: 'Text generation failed.' } };
    }
  }

  return {
    createTextTask,
    runTextTask,
  };
}

module.exports = {
  createTextGenerationService,
  createTextTask,
  stripSecretFields,
};
