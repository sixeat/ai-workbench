const { randomUUID } = require('crypto');
const {
  addTaskLog,
  createTask,
  getTask,
  insertAsset,
  linkTaskAsset,
  updateTask,
} = require('../db.cjs');
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
const { fetchPublicUrl } = require('./networkGuard.cjs');
const { getImageProviderAdapter } = require('./imageProviderAdapters.cjs');
const { getPublicBaseUrl } = require('./mediaUrlService.cjs');

function createImageTask(userId, body, status = 'queued') {
  return createTask({
    id: randomUUID(),
    userId,
    nodeType: 'image',
    providerId: body.providerId || 'openai-compatible',
    model: body.model,
    status,
    retryOf: body.retryOf || null,
    input: {
      providerId: body.providerId || 'openai-compatible',
      apiKeyId: body.apiKeyId || '',
      baseUrl: body.apiKeyId ? '' : body.baseUrl || '',
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
      upstreamTaskIds: Array.isArray(body.upstreamTaskIds) ? body.upstreamTaskIds : [],
      hasNegativePrompt: Boolean(body.negative_prompt),
      hasReferenceImage: Boolean(body.reference_image),
      hasReferenceImages: Boolean(body.reference_images),
    },
  });
}

function taskWasCancelled(taskId) {
  return getTask(taskId)?.status === 'cancelled';
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

async function saveGeneratedImage({ assetStorage, userId, taskId, payload, prompt, model, providerId }) {
  const stored = await assetStorage.save(payload.buffer, {
    index: payload.index,
    type: 'image',
    mime: payload.mime,
    prompt,
    model,
    providerId,
  });

  const asset = insertAsset({
    ...stored,
    userId,
  });
  linkTaskAsset(taskId, asset.id);
  return asset;
}

function createImageGenerationService({
  assetStorage,
  joinUrl,
  proxyRequest,
  publicAsset,
  resolveApiCredentials,
  uploadLimits = {},
}) {
  async function runImageTask({ req, userId, body = {}, secrets, task }) {
    const startedAt = Date.now();
    const activeTask = task || createImageTask(userId, {
      ...body,
      publicBaseUrl: body.publicBaseUrl || getPublicBaseUrl(req),
    }, 'running');
    const taskBody = {
      ...(activeTask.input || {}),
      ...body,
      publicBaseUrl: body.publicBaseUrl || activeTask.input?.publicBaseUrl || getPublicBaseUrl(req),
    };
    const workerReq = req || { headers: {}, publicBaseUrl: taskBody.publicBaseUrl };

    try {
      if (taskWasCancelled(activeTask.id)) {
        addTaskLog(activeTask.id, {
          level: 'warn',
          event: 'cancelled_before_start',
          message: 'Task was cancelled before the image worker started.',
        });
        return { status: 409, data: { error: 'Task was cancelled.' } };
      }

      const { baseUrl, apiKey, providerId } = await resolveApiCredentials({ userId, body: taskBody, secrets });

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

      const {
        baseUrl: _baseUrl,
        apiKey: _apiKey,
        apiKeyId: _apiKeyId,
        publicBaseUrl: _publicBaseUrl,
        userId: _userId,
        providerId: _providerId,
        upstreamTaskIds: _upstreamTaskIds,
        ...imageBody
      } = taskBody;

      const normalizedImageBody = normalizeImageBodyAliases(imageBody);
      const capabilities = getModelCapabilities(providerId, normalizedImageBody.model);
      const capabilityResult = filterImageBodyByCapabilities(normalizedImageBody, capabilities);

      if (!capabilityResult.ok) {
        updateTask(activeTask.id, {
          status: 'failed',
          error: { message: capabilityResult.error, warnings: capabilityResult.warnings },
          durationMs: Date.now() - startedAt,
        });
        return {
          status: 400,
          data: { error: capabilityResult.error, warnings: capabilityResult.warnings },
        };
      }

      const adapter = getImageProviderAdapter(providerId);
      const request = adapter.buildRequest({
        apiKey,
        body: capabilityResult.body,
        req: workerReq,
      });
      const result = await proxyRequest(joinUrl(baseUrl, adapter.endpoint), {
        method: 'POST',
        headers: request.headers,
        body: request.body,
      });

      if (result.status >= 400) {
        const upstreamError = safeUpstreamTaskError(result, 'Image generation upstream request failed.');
        console.error('/api/images upstream error:', {
          status: result.status,
          statusText: result.statusText,
          error: upstreamError,
        });
        updateTask(activeTask.id, {
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
        if (taskWasCancelled(activeTask.id)) {
          addTaskLog(activeTask.id, {
            level: 'warn',
            event: 'cancelled_after_upstream',
            message: 'Image upstream request finished after cancellation; output was not written.',
          });
          return { status: 409, data: { error: 'Task was cancelled.' } };
        }

        const payload = await resolveGeneratedImagePayload(items[i], i);
        if (payload) payloads.push(payload);
      }

      if (payloads.length === 0) {
        updateTask(activeTask.id, {
          status: 'failed',
          error: { message: 'No downloadable image payload found' },
          durationMs: Date.now() - startedAt,
        });
        return { status: 502, data: { error: 'No downloadable image payload found' } };
      }

      const totalSizeBytes = payloads.reduce((sum, payload) => sum + payload.buffer.length, 0);
      const limitError = assertAssetStorageQuota({ userId, sizeBytes: totalSizeBytes, uploadLimits });
      if (limitError) throw toExposedQuotaError(limitError);

      for (const payload of payloads) {
        if (taskWasCancelled(activeTask.id)) {
          addTaskLog(activeTask.id, {
            level: 'warn',
            event: 'cancelled_after_upstream',
            message: 'Image upstream request finished after cancellation; output was not written.',
          });
          return { status: 409, data: { error: 'Task was cancelled.' } };
        }

        const asset = await saveGeneratedImage({
          assetStorage,
          userId,
          taskId: activeTask.id,
          payload,
          prompt: capabilityResult.body.prompt,
          model: capabilityResult.body.model,
          providerId,
        });
        if (asset) saved.push(asset);
      }

      const output = saved.map(publicAsset);
      if (taskWasCancelled(activeTask.id)) {
        return { status: 409, data: { error: 'Task was cancelled.' } };
      }

      updateTask(activeTask.id, {
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
    } catch (error) {
      console.error('/api/images task error:', error);
      if (activeTask && !taskWasCancelled(activeTask.id)) {
        updateTask(activeTask.id, {
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
      }, 'running'),
    });
  }

  return {
    createImageTask,
    generateImage,
    runImageTask,
  };
}

module.exports = {
  createImageGenerationService,
  normalizeImageBodyAliases,
};
