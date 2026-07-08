const { randomUUID } = require('crypto');
const { getModelCapabilities } = require('../modelCapabilities.cjs');
const { safeTaskError, safeUpstreamErrorData, safeUpstreamTaskError } = require('../httpErrors.cjs');
const { taskRepository: defaultTaskRepository } = require('../repositories/taskRepository.cjs');
const {
  addCredentialFallbackLog,
  credentialAttemptLogData,
  credentialAttempts,
  shouldFallbackAfterUpstreamResult,
} = require('./credentialFallbackService.cjs');
const { credentialUsageError } = require('./credentialService.cjs');
const { getTextProviderAdapter } = require('./textProviderAdapters.cjs');

const GENERATION_FETCH_TIMEOUT_MS = Number(process.env.WORKBENCH_GENERATION_FETCH_TIMEOUT_MS || 0);

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

function taskWasCancelled(taskId, taskRepository = defaultTaskRepository) {
  return taskRepository.getTask(taskId)?.status === 'cancelled';
}

function createTextTask(userId, body, status = 'queued', taskRepository = defaultTaskRepository) {
  const requestKind = body.requestKind === 'claude' ? 'claude' : 'chat';
  const safeBody = stripSecretFields(body);
  return taskRepository.createTask({
    id: randomUUID(),
    userId,
    nodeType: 'text',
    providerId: safeBody.providerId || (requestKind === 'claude' ? 'anthropic' : 'openai-compatible'),
    model: inferTextModel(safeBody),
    status,
    creditCost: safeBody.creditCost || 0,
    creditKeyScope: safeBody.creditKeyScope || '',
    creditStatus: safeBody.creditStatus || 'none',
    retryOf: safeBody.retryOf || null,
    input: {
      ...safeBody,
      requestKind,
      baseUrl: safeBody.apiKeyId || safeBody.platformModelId ? '' : safeBody.baseUrl || '',
      apiKeyId: safeBody.apiKeyId || '',
      platformModelId: safeBody.platformModelId || '',
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
  taskRepository = defaultTaskRepository,
}) {
  async function resolveRequestCredentials({ userId, body, secrets }) {
    if (body.apiKeyId || body.platformModelId) {
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
    const activeTask = task || createTextTask(userId, body, 'running', taskRepository);
    const taskBody = {
      ...(activeTask.input || {}),
      ...body,
    };

    try {
      if (taskWasCancelled(activeTask.id, taskRepository)) {
        taskRepository.addTaskLog(activeTask.id, {
          level: 'warn',
          event: 'cancelled_before_start',
          message: 'Task was cancelled before the text worker started.',
        });
        return { status: 409, data: { error: 'Task was cancelled.' } };
      }

      const resolvedCredentials = await resolveRequestCredentials({
        userId,
        body: taskBody,
        secrets,
      });
      const attempts = credentialAttempts(resolvedCredentials);
      const requestKind = taskBody.requestKind === 'claude' ? 'claude' : 'chat';

      for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
        const credentials = attempts[attemptIndex];
        const isLastAttempt = attemptIndex === attempts.length - 1;
        const { baseUrl, apiKey, providerId: credentialProviderId } = credentials;

        if (!baseUrl) {
          if (!isLastAttempt) continue;
          taskRepository.updateTask(activeTask.id, {
            status: 'failed',
            error: { message: 'Base URL is required' },
            durationMs: Date.now() - startedAt,
          });
          return { status: 400, data: { error: 'Base URL is required' } };
        }

        if (!apiKey) {
          if (!isLastAttempt) continue;
          taskRepository.updateTask(activeTask.id, {
            status: 'failed',
            error: { message: 'API key is required' },
            durationMs: Date.now() - startedAt,
          });
          return { status: 400, data: { error: 'API key is required' } };
        }

        const providerId = credentialProviderId || taskBody.providerId || (requestKind === 'claude' ? 'anthropic' : 'openai-compatible');
        const effectiveBody = {
          ...taskBody,
          model: credentials.model || taskBody.model || '',
          providerId,
        };
        const credentialPolicyError = credentialUsageError(credentials, 'chat', effectiveBody.model || '');
        if (credentialPolicyError) {
          if (!isLastAttempt) continue;
          taskRepository.updateTask(activeTask.id, {
            status: 'failed',
            error: { message: credentialPolicyError },
            durationMs: Date.now() - startedAt,
          });
          return { status: 403, data: { error: credentialPolicyError } };
        }
        const modelCapabilities = getModelCapabilities(providerId, effectiveBody.model || '');
        if (!modelCapabilities.chat) {
          const capabilityError = 'The selected model is not marked as supporting text generation.';
          if (!isLastAttempt) continue;
          taskRepository.updateTask(activeTask.id, {
            status: 'failed',
            error: { message: capabilityError },
            durationMs: Date.now() - startedAt,
          });
          return { status: 400, data: { error: capabilityError } };
        }
        const adapter = getTextProviderAdapter(providerId, requestKind === 'claude' ? 'anthropic' : undefined);
        const request = adapter.buildRequest({ apiKey, body: effectiveBody, providerId });
        taskRepository.addTaskLog(activeTask.id, {
          event: 'upstream_text_submitted',
          message: 'Text request submitted to upstream provider.',
          data: {
            ...credentialAttemptLogData(credentials, attemptIndex),
            providerId,
            model: effectiveBody.model || '',
          },
        });
        const result = await proxyRequest(joinUrl(baseUrl, adapter.endpoint(providerId)), {
          method: 'POST',
          headers: request.headers,
          body: request.body,
          timeoutMs: GENERATION_FETCH_TIMEOUT_MS,
        });

        taskRepository.addTaskLog(activeTask.id, {
          event: 'upstream_text_response',
          message: `Text upstream responded with HTTP ${result.status}.`,
          data: {
            ...credentialAttemptLogData(credentials, attemptIndex),
            upstreamStatus: result.status,
            providerId,
            model: effectiveBody.model || '',
          },
        });

        if (taskWasCancelled(activeTask.id, taskRepository)) {
          taskRepository.addTaskLog(activeTask.id, {
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
          if (!isLastAttempt && shouldFallbackAfterUpstreamResult(result)) {
            addCredentialFallbackLog(taskRepository, activeTask.id, credentials, result, attemptIndex);
            continue;
          }
          taskRepository.updateTask(activeTask.id, {
            status: 'failed',
            error: safeUpstreamTaskError(result, 'Text generation upstream request failed.'),
            durationMs: Date.now() - startedAt,
          });
          return { status: result.status, data: safeUpstreamErrorData(result, 'Text generation upstream request failed.') };
        }

        taskRepository.updateTask(activeTask.id, {
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
      }

      taskRepository.updateTask(activeTask.id, {
        status: 'failed',
        error: { message: 'No usable credentials found' },
        durationMs: Date.now() - startedAt,
      });
      return { status: 400, data: { error: 'No usable credentials found' } };
    } catch (error) {
      console.error('/api/text task error:', error);
      if (!taskWasCancelled(activeTask.id, taskRepository)) {
        taskRepository.updateTask(activeTask.id, {
          status: 'failed',
          error: safeTaskError(error, 'Text generation failed.'),
          durationMs: Date.now() - startedAt,
        });
      }
      return { status: error.status || 500, data: { error: 'Text generation failed.' } };
    }
  }

  return {
    createTextTask: (userId, body, status = 'queued') =>
      createTextTask(userId, body, status, taskRepository),
    runTextTask,
  };
}

module.exports = {
  createTextGenerationService,
  createTextTask,
  stripSecretFields,
};
