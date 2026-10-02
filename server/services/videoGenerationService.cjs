const { randomUUID } = require('crypto');
const {
  filterVideoBodyByCapabilities,
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
const { getVideoProviderAdapter } = require('./videoProviderAdapters.cjs');
const { getPublicBaseUrl } = require('./mediaUrlService.cjs');
const { assetRepository: defaultAssetRepository } = require('../repositories/assetRepository.cjs');
const { taskRepository: defaultTaskRepository } = require('../repositories/taskRepository.cjs');

const GENERATION_FETCH_TIMEOUT_MS = Number(process.env.WORKBENCH_GENERATION_FETCH_TIMEOUT_MS || 0);

function createVideoTask(userId, body, status = 'queued', taskRepository = defaultTaskRepository) {
  return taskRepository.createTask({
    id: randomUUID(),
    userId,
    nodeType: 'video',
    providerId: body.providerId || 'seedance',
    model: body.model,
    status,
    creditCost: body.creditCost || 0,
    creditKeyScope: body.creditKeyScope || '',
    creditStatus: body.creditStatus || 'none',
    retryOf: body.retryOf || null,
    input: {
      providerId: body.providerId || 'seedance',
      apiKeyId: body.apiKeyId || '',
      apiKeyModelId: body.apiKeyModelId || '',
      platformModelId: body.platformModelId || '',
      baseUrl: body.apiKeyId || body.apiKeyModelId || body.platformModelId ? '' : body.baseUrl || '',
      publicBaseUrl: body.publicBaseUrl || '',
      model: body.model,
      mode: body.mode,
      text: body.text,
      content: Array.isArray(body.content) ? body.content : undefined,
      prompt: body.prompt,
      ratio: body.ratio,
      resolution: body.resolution,
      duration: body.duration,
      images: body.images,
      referenceImages: body.referenceImages,
      reference_images: body.reference_images,
      referenceVideos: body.referenceVideos,
      reference_videos: body.reference_videos,
      referenceAudios: body.referenceAudios,
      reference_audios: body.reference_audios,
      referenceVideoUrl: body.referenceVideoUrl,
      referenceAudioUrl: body.referenceAudioUrl,
      aspectRatio: body.aspectRatio,
      watermark: body.watermark,
      promptExtend: body.promptExtend,
      prompt_extend: body.prompt_extend,
      seed: body.seed,
      negativePrompt: body.negativePrompt,
      negative_prompt: body.negative_prompt,
      billing: body.billing || null,
      upstreamTaskIds: Array.isArray(body.upstreamTaskIds) ? body.upstreamTaskIds : [],
      imageCount: Array.isArray(body.images) ? body.images.length : 0,
      hasReferenceVideo: Boolean(body.referenceVideoUrl),
      hasReferenceAudio: Boolean(body.referenceAudioUrl),
      generateAudio: Boolean(body.generateAudio ?? body.generate_audio),
      generate_audio: Boolean(body.generateAudio ?? body.generate_audio),
    },
  });
}

function taskWasCancelled(taskId, taskRepository = defaultTaskRepository) {
  return taskRepository.getTask(taskId)?.status === 'cancelled';
}

function elapsedSinceCreated(task) {
  const createdAt = new Date(task?.createdAt || Date.now()).getTime();
  return Math.max(0, Date.now() - createdAt);
}

async function saveGeneratedVideo({
  assetRepository,
  assetStorage,
  userId,
  taskId,
  videoUrl,
  prompt,
  model,
  providerId,
  taskRepository,
  uploadLimits = {},
}) {
  if (!assetStorage || !videoUrl) return null;
  const existing = taskRepository.listTaskAssets(taskId).find((asset) => asset.type === 'video');
  if (existing) return existing;

  const response = await fetchPublicUrl(videoUrl);
  if (!response.ok) {
    throw new Error(`Could not download generated video: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const limitError = assertAssetStorageQuota({ userId, sizeBytes: buffer.length, uploadLimits, assetRepository });
  if (limitError) throw toExposedQuotaError(limitError);

  const stored = await assetStorage.save(buffer, {
    type: 'video',
    mime: response.headers.get('content-type') || 'video/mp4',
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

function createVideoGenerationService({
  assetStorage,
  joinUrl,
  publicAsset,
  proxyRequest,
  resolveApiCredentials,
  assetRepository = defaultAssetRepository,
  taskRepository = defaultTaskRepository,
  uploadLimits = {},
}) {
  async function runVideoTask({ req, userId, body = {}, secrets, task }) {
    const startedAt = Date.now();
    const { activeTask, taskBody, workerReq } = prepareGenerationTask({
      req,
      body,
      task,
      createTask: (nextBody, status, repository) =>
        createVideoTask(userId, nextBody, status, repository),
      taskRepository,
    });

    try {
      const cancelledGuard = guardCancelledBeforeStart({ activeTask, taskRepository });
      if (cancelledGuard) return cancelledGuard;

      const requestedProviderId = taskBody.providerId || 'seedance';
      const adapter = getVideoProviderAdapter(requestedProviderId);
      const resolvedCredentials = await resolveApiCredentials({
        userId,
        body: {
          ...taskBody,
          providerId: requestedProviderId,
          baseUrl: taskBody.baseUrl || adapter.defaultBaseUrl(secrets),
        },
        secrets: {
          ...secrets,
          baseUrl: adapter.defaultBaseUrl(secrets),
        },
      });
      const attempts = credentialAttempts(resolvedCredentials);

      for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
        const credentials = attempts[attemptIndex];
        const isLastAttempt = attemptIndex === attempts.length - 1;
        const { baseUrl, apiKey, providerId: credentialProviderId } = credentials;
        const providerId = credentialProviderId || requestedProviderId;

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

        const resolvedAdapter = getVideoProviderAdapter(providerId, credentials.adapterId);
        const effectiveTaskBody = {
          ...taskBody,
          model: credentials.model || taskBody.model,
          providerId,
        };
        const arkBody = resolvedAdapter.buildCapabilityBody({ body: effectiveTaskBody, req: workerReq });

        if (!arkBody.model) {
          if (!isLastAttempt) continue;
          taskRepository.updateTask(activeTask.id, {
            status: 'failed',
            error: { message: 'model is required' },
            durationMs: Date.now() - startedAt,
          });
          return { status: 400, data: { error: 'model is required' } };
        }
        const credentialPolicyError = credentialUsageError(credentials, 'videoGeneration', arkBody.model);
        if (credentialPolicyError) {
          if (!isLastAttempt) continue;
          taskRepository.updateTask(activeTask.id, {
            status: 'failed',
            error: { message: credentialPolicyError },
            durationMs: Date.now() - startedAt,
          });
          return { status: 403, data: { error: credentialPolicyError } };
        }
        if (!arkBody.content.length) {
          if (!isLastAttempt) continue;
          taskRepository.updateTask(activeTask.id, {
            status: 'failed',
            error: { message: 'content is required' },
            durationMs: Date.now() - startedAt,
          });
          return { status: 400, data: { error: 'content is required' } };
        }

        const capabilities = credentials.modelCapabilities && Object.keys(credentials.modelCapabilities).length > 0
          ? credentials.modelCapabilities
          : getModelCapabilities(providerId, arkBody.model);
        const capabilityResult = filterVideoBodyByCapabilities(arkBody, capabilities);

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

        const request = resolvedAdapter.buildCreateRequest({
          originalBody: effectiveTaskBody,
          body: capabilityResult.body,
          req: workerReq,
          apiKey,
        });
        taskRepository.addTaskLog(activeTask.id, {
          event: 'upstream_video_request_submitted',
          message: 'Video request submitted to upstream provider.',
          data: {
            ...credentialAttemptLogData(credentials, attemptIndex),
            providerId,
            model: arkBody.model,
          },
        });
        const result = await proxyRequest(joinUrl(baseUrl, request.endpoint), {
          method: 'POST',
          headers: request.headers,
          body: request.body,
          timeoutMs: GENERATION_FETCH_TIMEOUT_MS,
        });
        taskRepository.addTaskLog(activeTask.id, {
          event: 'upstream_video_response',
          message: `Video upstream responded with HTTP ${result.status}.`,
          data: {
            ...credentialAttemptLogData(credentials, attemptIndex),
            upstreamStatus: result.status,
            upstreamStatusText: result.statusText || '',
            providerId,
            model: arkBody.model,
          },
        });

        if (result.status >= 400) {
          if (!isLastAttempt && shouldFallbackAfterUpstreamResult(result)) {
            addCredentialFallbackLog(taskRepository, activeTask.id, credentials, result, attemptIndex);
            continue;
          }
          const upstreamError = safeUpstreamTaskError(result, 'Video generation upstream request failed.');
          console.error('/api/videos upstream error:', {
            status: result.status,
            statusText: result.statusText,
            error: upstreamError,
          });
          taskRepository.updateTask(activeTask.id, {
            status: 'failed',
            error: upstreamError,
            durationMs: Date.now() - startedAt,
          });
          return { status: result.status, data: safeUpstreamErrorData(result, 'Video generation upstream request failed.') };
        }

        const output = {
          providerId,
          credential: {
            // adapterId 必须存下来：查询阶段没有凭据解析结果可用，
            // 只靠 providerId 推不出适配器（adapters 里没有 aliyun-bailian 键，
            // 会兜底到 seedance，于是拿火山方舟的路径去问百炼，永远查不到）。
            adapterId: credentials.adapterId || '',
            apiKeyId: credentials.apiKeyId || taskBody.apiKeyId || '',
            platformModelId: credentials.platformModelId || taskBody.platformModelId || '',
            platformRouteId: credentials.platformRouteId || '',
          },
          request: {
            model: arkBody.model,
            mode: taskBody.mode || '',
            ratio: arkBody.ratio,
            resolution: capabilityResult.body.resolution,
            duration: arkBody.duration,
            generateAudio: capabilityResult.body.generate_audio,
            watermark: arkBody.watermark,
            contentCount: arkBody.content.length,
          },
          upstream: resolvedAdapter.summarizeUpstream(result.data),
        };

        taskRepository.addTaskLog(activeTask.id, {
          event: 'upstream_video_submitted',
          message: 'Video task submitted to upstream provider.',
          data: {
            upstreamTaskId: output.upstream?.taskId || '',
            upstreamStatus: output.upstream?.status || '',
            providerId,
            model: arkBody.model,
            platformModelId: credentials.platformModelId || '',
            platformRouteId: credentials.platformRouteId || '',
          },
        });

        const cancelledAfterUpstream = guardCancelledAfterUpstream({
          activeTask,
          taskRepository,
          nodeType: 'Video',
          output,
          providerId,
          model: arkBody.model,
        });
        if (cancelledAfterUpstream) return cancelledAfterUpstream;

        taskRepository.updateTask(activeTask.id, {
          status: 'running',
          output,
          error: capabilityResult.warnings.length > 0 ? { warnings: capabilityResult.warnings } : null,
          durationMs: Date.now() - startedAt,
        });

        return {
          status: 202,
          data: {
            taskId: activeTask.id,
            task: taskRepository.getTask(activeTask.id),
            data: result.data,
            request: output.request,
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
      console.error('/api/videos task error:', error);
      if (activeTask && !taskWasCancelled(activeTask.id, taskRepository)) {
        taskRepository.updateTask(activeTask.id, {
          status: 'failed',
          error: safeTaskError(error, 'Video generation failed.'),
          durationMs: Date.now() - startedAt,
        });
      }
      return {
        status: error.status || 500,
        data: { error: publicErrorMessage(error, 'Video generation failed.') },
      };
    }
  }

  async function generateVideo({ req, userId, body, secrets }) {
    return runVideoTask({
      req,
      userId,
      body,
      secrets,
      task: createVideoTask(userId, {
        ...body,
        publicBaseUrl: getPublicBaseUrl(req),
      }, 'running', taskRepository),
    });
  }

  /**
   * 查询视频任务并落定。
   *
   * 两条调用路径共用同一个入参名：
   * - HTTP 路由传 req，此时从中取 userId
   * - 服务端编排传 runNode，用它作为任务属主（此时没有 HTTP 请求可依赖）
   */
  async function getVideoTask({ taskId, userId, query = {}, secrets, runNode }) {
    const resolvedUserId = userId ?? runNode?.userId;
    const localTask = taskRepository.getTaskForUser(taskId, resolvedUserId);
    const localOutput = localTask?.output || {};
    const upstreamTaskId = localTask?.nodeType === 'video'
      ? localOutput?.upstream?.taskId || query.upstreamTaskId || taskId
      : taskId;
    const providerId = query.providerId || localTask?.providerId || localOutput?.providerId || 'seedance';
    const storedCredential = localOutput?.credential || {};
    // 必须带上存下来的 adapterId：提交和查询要用同一个适配器，
    // 只按 providerId 重新推断可能走到另一套协议（真实踩过：拿火山方舟的
    // /api/v3/... 路径去问百炼，任务永远查不到）。
    const adapter = getVideoProviderAdapter(providerId, storedCredential.adapterId || '');
    const body = storedCredential.platformModelId ? {
      platformModelId: storedCredential.platformModelId,
      platformRouteId: storedCredential.platformRouteId,
      providerId,
      baseUrl: adapter.defaultBaseUrl(secrets),
    } : {
      apiKeyId: localTask ? storedCredential.apiKeyId : query.apiKeyId,
      baseUrl: adapter.defaultBaseUrl(secrets),
      providerId,
    };
    const { baseUrl, apiKey } = await resolveApiCredentials({
      userId: resolvedUserId,
      body,
      secrets: {
        ...secrets,
        baseUrl: body.baseUrl,
      },
    });
    if (!apiKey) return { status: 400, data: { error: 'API key is required' } };

    const request = adapter.buildQueryRequest({
      taskId: upstreamTaskId,
      apiKey,
    });
    const result = await proxyRequest(joinUrl(baseUrl, request.endpoint), {
      method: 'GET',
      headers: request.headers,
    });

    if (result.status >= 400) {
      if (localTask?.nodeType === 'video') {
        const durationMs = elapsedSinceCreated(localTask);
        const taskError = safeUpstreamTaskError(result, 'Video task lookup upstream request failed.');
        taskRepository.updateTask(localTask.id, {
          status: 'failed',
          output: localTask.output || {},
          error: taskError,
          durationMs,
        });
        if (localTask.status !== 'failed') {
          taskRepository.addTaskLog(localTask.id, {
            level: 'error',
            event: 'upstream_video_lookup_failed',
            message: taskError.message || 'Video task lookup upstream request failed.',
            data: {
              durationMs,
              upstreamTaskId,
              upstreamStatus: result.status,
              providerId,
              model: localTask.model,
              error: taskError,
            },
          });
        }
      }
      return { status: result.status, data: safeUpstreamErrorData(result, 'Video task lookup upstream request failed.') };
    }

    if (!localTask || localTask.nodeType !== 'video') {
      return { status: result.status, data: result.data };
    }

    const upstream = adapter.summarizeUpstream(result.data);
    const normalizedStatus = adapter.normalizeStatus(result.data);
    const nextOutput = {
      ...(localTask.output || {}),
      upstream: {
        ...(localTask.output?.upstream || {}),
        ...upstream,
        rawStatus: upstream.status || '',
      },
    };

    if (normalizedStatus === 'succeeded') {
      const videoUrl = adapter.extractVideoUrl(result.data);
      if (!videoUrl) {
        const durationMs = elapsedSinceCreated(localTask);
        const error = { message: 'Video task succeeded upstream, but no video URL was found.' };
        const updated = taskRepository.updateTask(localTask.id, {
          status: 'failed',
          output: nextOutput,
          error,
          durationMs,
        });
        if (localTask.status !== 'failed') {
          taskRepository.addTaskLog(localTask.id, {
            level: 'error',
            event: 'upstream_video_missing_url',
            message: error.message,
            data: {
              durationMs,
              upstreamTaskId,
              upstreamStatus: upstream.status || '',
              providerId,
              model: localTask.model,
              error,
            },
          });
        }
        return { status: 502, data: { task: updated, data: result.data, error: updated.error } };
      }

      let asset;
      try {
        asset = await saveGeneratedVideo({
          assetStorage,
          userId,
          taskId: localTask.id,
          videoUrl,
          prompt: localTask.input?.prompt || '',
          model: localTask.model,
          providerId,
          assetRepository,
          taskRepository,
          uploadLimits,
        });
      } catch (error) {
        const durationMs = elapsedSinceCreated(localTask);
        const taskError = safeTaskError(error, 'Video asset save failed.');
        const updated = taskRepository.updateTask(localTask.id, {
          status: 'failed',
          output: nextOutput,
          error: taskError,
          durationMs,
        });
        if (localTask.status !== 'failed') {
          taskRepository.addTaskLog(localTask.id, {
            level: 'error',
            event: 'upstream_video_asset_save_failed',
            message: taskError.message,
            data: {
              durationMs,
              upstreamTaskId,
              upstreamStatus: upstream.status || '',
              providerId,
              model: localTask.model,
              error: taskError,
            },
          });
        }
        return {
          status: error.status || 500,
          data: {
            task: updated,
            data: result.data,
            error: updated.error,
          },
        };
      }
      const output = {
        ...nextOutput,
        video: asset ? publicAsset(asset) : null,
      };
      const updated = taskRepository.updateTask(localTask.id, {
        status: 'succeeded',
        output,
        error: null,
        durationMs: elapsedSinceCreated(localTask),
      });
      if (localTask.status !== 'succeeded') {
        taskRepository.addTaskLog(localTask.id, {
          event: 'upstream_video_succeeded',
          message: 'Video task completed upstream and the asset was saved.',
          data: {
            durationMs: updated.durationMs,
            upstreamTaskId,
            upstreamStatus: upstream.status || '',
            providerId,
            model: localTask.model,
            assetId: asset?.id || null,
          },
        });
      }
      return { status: result.status, data: { task: updated, data: result.data, asset: output.video } };
    }

    if (normalizedStatus === 'failed' || normalizedStatus === 'cancelled') {
      const durationMs = elapsedSinceCreated(localTask);
      const error = normalizedStatus === 'failed'
        ? {
            ...safeUpstreamTaskError({
              data: result.data,
              headers: result.headers,
              status: null,
              statusText: '',
            }, 'Video task failed upstream.'),
            upstreamTaskStatus: upstream.status || '',
          }
        : { message: 'Video task cancelled upstream.', upstreamTaskStatus: upstream.status || '' };
      const updated = taskRepository.updateTask(localTask.id, {
        status: normalizedStatus,
        output: nextOutput,
        error,
        durationMs,
      });
      if (localTask.status !== normalizedStatus) {
        taskRepository.addTaskLog(localTask.id, {
          level: normalizedStatus === 'failed' ? 'error' : 'warn',
          event: normalizedStatus === 'failed' ? 'upstream_video_failed' : 'upstream_video_cancelled',
          message: error.message,
          data: {
            durationMs,
            upstreamTaskId,
            upstreamStatus: upstream.status || '',
            providerId,
            model: localTask.model,
            error,
          },
        });
      }
      return { status: result.status, data: { task: updated, data: result.data } };
    }

    const updated = taskRepository.updateTask(localTask.id, {
      status: 'running',
      output: nextOutput,
    });
    return { status: result.status, data: { task: updated, data: result.data } };
  }

  return {
    createVideoTask: (userId, body, status = 'queued') =>
      createVideoTask(userId, body, status, taskRepository),
    generateVideo,
    getVideoTask,
    runVideoTask,
  };
}

module.exports = {
  createVideoGenerationService,
};
