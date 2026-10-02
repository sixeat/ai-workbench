const { randomUUID } = require('crypto');
const {
  filterImageBodyByCapabilities,
  getModelCapabilities,
} = require('../modelCapabilities.cjs');
const {
  publicErrorMessage,
  safeTaskError,
  safeUpstreamErrorData,
  safeUpstreamTaskError,
} = require('../httpErrors.cjs');
const {
  assertAssetStorageQuota,
  toExposedQuotaError,
} = require('./assetQuotaService.cjs');
const {
  addCredentialFallbackLog,
  credentialAttemptLogData,
  credentialAttempts,
  shouldFallbackAfterUpstreamResult,
} = require('./credentialFallbackService.cjs');
const { credentialUsageError } = require('./credentialService.cjs');
const {
  guardCancelledAfterUpstream,
  guardCancelledBeforeStart,
  prepareGenerationTask,
} = require('./generationTaskSkeleton.cjs');
const { fetchPublicUrl } = require('./networkGuard.cjs');
const { getImageProviderAdapter } = require('./imageProviderAdapters.cjs');
const { getPublicBaseUrl } = require('./mediaUrlService.cjs');
const { assetRepository: defaultAssetRepository } = require('../repositories/assetRepository.cjs');
const { taskRepository: defaultTaskRepository } = require('../repositories/taskRepository.cjs');

const GENERATION_FETCH_TIMEOUT_MS = Number(process.env.WORKBENCH_GENERATION_FETCH_TIMEOUT_MS || 0);

function createImageTask(userId, body, status = 'queued', taskRepository = defaultTaskRepository) {
  return taskRepository.createTask({
    id: randomUUID(),
    userId,
    nodeType: 'image',
    providerId: body.providerId || 'openai-compatible',
    model: body.model,
    status,
    creditCost: body.creditCost || 0,
    creditKeyScope: body.creditKeyScope || '',
    creditStatus: body.creditStatus || 'none',
    retryOf: body.retryOf || null,
    input: {
      providerId: body.providerId || 'openai-compatible',
      apiKeyId: body.apiKeyId || '',
      apiKeyModelId: body.apiKeyModelId || '',
      platformModelId: body.platformModelId || '',
      baseUrl: body.apiKeyId || body.apiKeyModelId || body.platformModelId ? '' : body.baseUrl || '',
      publicBaseUrl: body.publicBaseUrl || '',
      model: body.model,
      prompt: body.prompt,
      size: body.size,
      quality: body.quality,
      n: body.n,
      response_format: body.response_format,
      negative_prompt: body.negative_prompt,
      reference_image: body.reference_image,
      reference_images: body.reference_images,
      reference_strength: body.reference_strength,
      seed: body.seed,
      watermark: body.watermark,
      promptExtend: body.promptExtend,
      prompt_extend: body.prompt_extend,
      enableSequential: body.enableSequential,
      enable_sequential: body.enable_sequential,
      thinkingMode: body.thinkingMode,
      thinking_mode: body.thinking_mode,
      billing: body.billing || null,
      upstreamTaskIds: Array.isArray(body.upstreamTaskIds) ? body.upstreamTaskIds : [],
      hasNegativePrompt: Boolean(body.negative_prompt),
      hasReferenceImage: Boolean(body.reference_image),
      hasReferenceImages: Boolean(body.reference_images),
    },
  });
}

function taskWasCancelled(taskId, taskRepository = defaultTaskRepository) {
  return taskRepository.getTask(taskId)?.status === 'cancelled';
}

function normalizeImageBodyAliases(body) {
  const normalized = { ...body };

  if (normalized.promptExtend != null && normalized.prompt_extend == null) {
    normalized.prompt_extend = Boolean(normalized.promptExtend);
  }
  if (normalized.enableSequential != null && normalized.enable_sequential == null) {
    normalized.enable_sequential = Boolean(normalized.enableSequential);
  }
  if (normalized.thinkingMode != null && normalized.thinking_mode == null) {
    normalized.thinking_mode = Boolean(normalized.thinkingMode);
  }

  delete normalized.promptExtend;
  delete normalized.enableSequential;
  delete normalized.thinkingMode;

  return normalized;
}

async function resolveGeneratedImagePayload(item, index) {
  let buffer;
  let mime = 'image/png';

  if (item?.b64_json) {
    buffer = Buffer.from(item.b64_json, 'base64');
  } else if (item?.url) {
    const imageResponse = await fetchPublicUrl(item.url);
    if (!imageResponse.ok) {
      throw new Error(`Could not download generated image: ${imageResponse.status}`);
    }
    buffer = Buffer.from(await imageResponse.arrayBuffer());
    mime = imageResponse.headers.get('content-type') || 'image/png';
  } else {
    return null;
  }

  return { buffer, index, mime };
}

async function saveGeneratedImage({
  assetRepository,
  assetStorage,
  userId,
  taskId,
  payload,
  prompt,
  model,
  providerId,
  taskRepository,
}) {
  const stored = await assetStorage.save(payload.buffer, {
    index: payload.index,
    type: 'image',
    mime: payload.mime,
    prompt,
    model,
    providerId,
  });

  const asset = assetRepository.insertAsset({
    ...stored,
    userId,
  });
  taskRepository.linkTaskAsset(taskId, asset.id);
  return asset;
}

function createImageGenerationService({
  assetStorage,
  joinUrl,
  proxyRequest,
  publicAsset,
  resolveApiCredentials,
  assetRepository = defaultAssetRepository,
  taskRepository = defaultTaskRepository,
  uploadLimits = {},
}) {
  async function runImageTask({ req, userId, body = {}, secrets, task }) {
    const startedAt = Date.now();
    const { activeTask, taskBody, workerReq } = prepareGenerationTask({
      req,
      body,
      task,
      createTask: (nextBody, status, repository) =>
        createImageTask(userId, nextBody, status, repository),
      taskRepository,
    });

    try {
      const cancelledGuard = guardCancelledBeforeStart({ activeTask, taskRepository });
      if (cancelledGuard) return cancelledGuard;

      const resolvedCredentials = await resolveApiCredentials({ userId, body: taskBody, secrets });
      const attempts = credentialAttempts(resolvedCredentials);

      for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
        const credentials = attempts[attemptIndex];
        const isLastAttempt = attemptIndex === attempts.length - 1;
        const { baseUrl, apiKey, providerId } = credentials;

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

        const {
          baseUrl: _baseUrl,
          apiKey: _apiKey,
          apiKeyId: _apiKeyId,
          apiKeyModelId: _apiKeyModelId,
          platformModelId: _platformModelId,
          publicBaseUrl: _publicBaseUrl,
          userId: _userId,
          providerId: _providerId,
          upstreamTaskIds: _upstreamTaskIds,
          billing: _billing,
          creditCost: _creditCost,
          creditKeyScope: _creditKeyScope,
          creditStatus: _creditStatus,
          hasNegativePrompt: _hasNegativePrompt,
          hasReferenceImage: _hasReferenceImage,
          hasReferenceImages: _hasReferenceImages,
          ...imageBody
        } = taskBody;

        const normalizedImageBody = normalizeImageBodyAliases({
          ...imageBody,
          model: credentials.model || imageBody.model,
        });
        const credentialPolicyError = credentialUsageError(credentials, 'imageGeneration', normalizedImageBody.model);
        if (credentialPolicyError) {
          if (!isLastAttempt) continue;
          taskRepository.updateTask(activeTask.id, {
            status: 'failed',
            error: { message: credentialPolicyError },
            durationMs: Date.now() - startedAt,
          });
          return { status: 403, data: { error: credentialPolicyError } };
        }
        const capabilities = credentials.modelCapabilities && Object.keys(credentials.modelCapabilities).length > 0
          ? credentials.modelCapabilities
          : getModelCapabilities(providerId, normalizedImageBody.model);
        const capabilityResult = filterImageBodyByCapabilities(normalizedImageBody, capabilities);

        if (!capabilityResult.ok) {
          if (!isLastAttempt) continue;
          taskRepository.updateTask(activeTask.id, {
            status: 'failed',
            error: { message: capabilityResult.error, warnings: capabilityResult.warnings },
            durationMs: Date.now() - startedAt,
          });
          return {
            status: 400,
            data: { error: capabilityResult.error, warnings: capabilityResult.warnings },
          };
        }

        const adapter = getImageProviderAdapter(providerId, credentials.adapterId);
        const request = adapter.buildRequest({
          apiKey,
          body: capabilityResult.body,
          req: workerReq,
        });
        taskRepository.addTaskLog(activeTask.id, {
          event: 'upstream_image_submitted',
          message: 'Image request submitted to upstream provider.',
          data: {
            ...credentialAttemptLogData(credentials, attemptIndex),
            providerId,
            model: capabilityResult.body.model || '',
          },
        });
        const result = await proxyRequest(joinUrl(baseUrl, adapter.endpoint), {
          method: 'POST',
          headers: request.headers,
          body: request.body,
          timeoutMs: GENERATION_FETCH_TIMEOUT_MS,
        });
        taskRepository.addTaskLog(activeTask.id, {
          event: 'upstream_image_response',
          message: `Image upstream responded with HTTP ${result.status}.`,
          data: {
            ...credentialAttemptLogData(credentials, attemptIndex),
            upstreamStatus: result.status,
            upstreamStatusText: result.statusText || '',
            providerId,
            model: capabilityResult.body.model || '',
          },
        });

        if (result.status >= 400) {
          if (!isLastAttempt && shouldFallbackAfterUpstreamResult(result)) {
            addCredentialFallbackLog(taskRepository, activeTask.id, credentials, result, attemptIndex);
            continue;
          }
          const upstreamError = safeUpstreamTaskError(result, 'Image generation upstream request failed.');
          console.error('/api/images upstream error:', {
            status: result.status,
            statusText: result.statusText,
            error: upstreamError,
          });
          taskRepository.updateTask(activeTask.id, {
            status: 'failed',
            error: upstreamError,
            durationMs: Date.now() - startedAt,
          });
          return { status: result.status, data: safeUpstreamErrorData(result, 'Image generation upstream request failed.') };
        }

        const items = adapter.extractItems(result.data);
        const payloads = [];
        const saved = [];

        for (let i = 0; i < items.length; i += 1) {
          const cancelledWhileDownloading = guardCancelledAfterUpstream({
            activeTask,
            taskRepository,
            nodeType: 'Image',
            output: null,
            providerId,
            model: normalizedImageBody.model,
          });
          if (cancelledWhileDownloading) return cancelledWhileDownloading;

          const payload = await resolveGeneratedImagePayload(items[i], i);
          if (payload) payloads.push(payload);
        }

        if (payloads.length === 0) {
          taskRepository.updateTask(activeTask.id, {
            status: 'failed',
            error: { message: 'No downloadable image payload found' },
            durationMs: Date.now() - startedAt,
          });
          return { status: 502, data: { error: 'No downloadable image payload found' } };
        }

        const totalSizeBytes = payloads.reduce((sum, payload) => sum + payload.buffer.length, 0);
        const limitError = assertAssetStorageQuota({ userId, sizeBytes: totalSizeBytes, uploadLimits, assetRepository });
        if (limitError) throw toExposedQuotaError(limitError);

        for (const payload of payloads) {
          const cancelledWhileSaving = guardCancelledAfterUpstream({
            activeTask,
            taskRepository,
            nodeType: 'Image',
            output: null,
            providerId,
            model: capabilityResult.body.model,
          });
          if (cancelledWhileSaving) return cancelledWhileSaving;

          const asset = await saveGeneratedImage({
            assetRepository,
            assetStorage,
            userId,
            taskId: activeTask.id,
            payload,
            prompt: capabilityResult.body.prompt,
            model: capabilityResult.body.model,
            providerId,
            taskRepository,
          });
          if (asset) saved.push(asset);
        }

        const output = saved.map(publicAsset);
        if (taskWasCancelled(activeTask.id, taskRepository)) {
          return { status: 409, data: { error: 'Task was cancelled.' } };
        }

        taskRepository.updateTask(activeTask.id, {
          status: 'succeeded',
          output,
          error: capabilityResult.warnings.length > 0 ? { warnings: capabilityResult.warnings } : null,
          durationMs: Date.now() - startedAt,
        });

        return {
          status: 200,
          data: {
            ...result.data,
            data: output,
            taskId: activeTask.id,
            warnings: capabilityResult.warnings,
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
      console.error('/api/images task error:', error);
      if (activeTask && !taskWasCancelled(activeTask.id, taskRepository)) {
        taskRepository.updateTask(activeTask.id, {
          status: 'failed',
          error: safeTaskError(error, 'Image generation failed.'),
          durationMs: Date.now() - startedAt,
        });
      }
      return {
        status: error.status || 500,
        data: { error: publicErrorMessage(error, 'Image generation failed.') },
      };
    }
  }

  async function generateImage({ req, userId, body, secrets }) {
    return runImageTask({
      req,
      userId,
      body,
      secrets,
      task: createImageTask(userId, {
        ...body,
        publicBaseUrl: getPublicBaseUrl(req),
      }, 'running', taskRepository),
    });
  }

  return {
    createImageTask: (userId, body, status = 'queued') =>
      createImageTask(userId, body, status, taskRepository),
    generateImage,
    runImageTask,
  };
}

module.exports = {
  createImageGenerationService,
  normalizeImageBodyAliases,
};
