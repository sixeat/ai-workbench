import { callClaude } from '../apiClients/claudeClient';
import { callOpenAIChat } from '../apiClients/openaiClient';
import { getInstanceRuntimeConfig } from '../../stores/apiStore';
import { getProviderDefaultModels, getProviderTemplate } from '../../data/providerRegistry';
import { useApiStore } from '../../stores/apiStore';
import type { ExecutionContext, TextModelContext } from '../executionTypes';
import type { NodeConfig } from '../../types/nodes';

export interface TextGenerationOptions {
  instanceId?: string;
  apiKeyModelId?: string;
  platformModelId?: string;
  model?: string;
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  upstreamTaskIds?: string[];
}

export interface TextGenerationResult {
  text: string;
  task?: unknown;
  response?: unknown;
}

export type ModelSource = 'inherit' | 'globalDefault' | 'manual' | 'platform' | 'localOnly';

export interface ResolvedTextGenerationOptions extends TextGenerationOptions {
  source: Exclude<ModelSource, 'localOnly'>;
}

function getGlobalDefaultModelContext(): TextModelContext | null {
  const instances = useApiStore.getState().getEnabledInstances();
  const instance = instances.find((item) => {
    const provider = getProviderTemplate(item.providerId);
    return Boolean(provider?.supportedNodes.some((nodeType) =>
      ['textModel', 'script', 'shotSplit', 'promptOptimize'].includes(nodeType)
    ));
  });

  if (!instance) return null;
  const model = instance.models[0] || getProviderDefaultModels(instance.providerId)[0] || 'gpt-4o';
  return {
    instanceId: instance.id,
    model,
    providerId: instance.providerId,
    sourceNodeType: 'globalDefault',
    sourceNodeLabel: '全局默认文本模型',
  };
}

export function makeModelContext(
  config: { instanceId?: string; apiKeyModelId?: string; model?: string; platformModelId?: string },
  meta: Partial<TextModelContext> = {}
): TextModelContext | null {
  if (!config.instanceId && !config.apiKeyModelId && !config.platformModelId) return null;
  return {
    instanceId: config.instanceId ? String(config.instanceId) : undefined,
    apiKeyModelId: config.apiKeyModelId ? String(config.apiKeyModelId) : undefined,
    platformModelId: config.platformModelId ? String(config.platformModelId) : undefined,
    model: String(config.model || 'gpt-4o'),
    ...meta,
  };
}

export function resolveTextGenerationOptions(
  config: NodeConfig,
  context: ExecutionContext,
  defaults: Partial<TextGenerationOptions> = {}
): ResolvedTextGenerationOptions | null {
  const configuredSource = String(config.modelSource || (config.instanceId || config.apiKeyModelId ? 'manual' : 'inherit'));
  const modelSource = (configuredSource === 'custom' ? 'manual' : configuredSource) as ModelSource;
  if (modelSource === 'localOnly') return null;

  const base = {
    temperature: config.temperature !== undefined ? Number(config.temperature) : defaults.temperature,
    maxTokens: config.maxTokens !== undefined ? Number(config.maxTokens) : defaults.maxTokens,
    upstreamTaskIds: context.upstreamTaskIds || defaults.upstreamTaskIds || [],
  };

  if (modelSource === 'manual') {
    if (!config.instanceId && !config.apiKeyModelId) return null;
    return {
      ...defaults,
      ...base,
      instanceId: config.instanceId ? String(config.instanceId) : undefined,
      apiKeyModelId: config.apiKeyModelId ? String(config.apiKeyModelId) : undefined,
      model: String(config.model || defaults.model || 'gpt-4o'),
      prompt: defaults.prompt || '',
      source: 'manual',
    };
  }

  if (modelSource === 'platform') {
    if (!config.platformModelId) return null;
    return {
      ...defaults,
      ...base,
      platformModelId: String(config.platformModelId),
      model: String(config.model || defaults.model || ''),
      prompt: defaults.prompt || '',
      source: 'platform',
    };
  }

  if (modelSource === 'inherit') {
    const upstream = context.modelContext;
    if (upstream?.instanceId || upstream?.apiKeyModelId || upstream?.platformModelId) {
      return {
        ...defaults,
        ...base,
        instanceId: upstream.instanceId,
        apiKeyModelId: upstream.apiKeyModelId,
        platformModelId: upstream.platformModelId,
        model: upstream.model || defaults.model || 'gpt-4o',
        prompt: defaults.prompt || '',
        source: 'inherit',
      };
    }

    if (config.instanceId) {
      return {
        ...defaults,
        ...base,
        instanceId: String(config.instanceId),
        model: String(config.model || defaults.model || 'gpt-4o'),
        prompt: defaults.prompt || '',
        source: 'manual',
      };
    }
  }

  const globalDefault = getGlobalDefaultModelContext();
  if (!globalDefault) return null;
  return {
    ...defaults,
    ...base,
    instanceId: globalDefault.instanceId,
    model: globalDefault.model || defaults.model || 'gpt-4o',
    prompt: defaults.prompt || '',
    source: 'globalDefault',
  };
}

function responseTask(response: unknown): unknown {
  return typeof response === 'object' && response !== null && '__task' in response
    ? (response as { __task?: unknown }).__task
    : undefined;
}

export async function generateTextWithMetadata(options: TextGenerationOptions): Promise<TextGenerationResult> {
  if (!options.instanceId && !options.apiKeyModelId && !options.platformModelId) throw new Error('请选择模型');
  if (!options.prompt.trim()) throw new Error('文本生成需要 prompt 输入');

  if (options.platformModelId) {
    const response = await callOpenAIChat(
      '',
      '',
      {
        model: options.model || '',
        messages: [
          ...(options.system ? [{ role: 'system', content: options.system }] : []),
          { role: 'user', content: options.prompt },
        ],
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2000,
        upstreamTaskIds: options.upstreamTaskIds,
      },
      { platformModelId: options.platformModelId }
    );
    return {
      text: response.choices[0]?.message?.content || '',
      task: responseTask(response),
      response,
    };
  }

  const runtimeConfig = getInstanceRuntimeConfig(options.instanceId || '');
  if (!runtimeConfig) throw new Error('API 实例配置无效');

  const { baseUrl, apiKey, apiKeyId, provider } = runtimeConfig;
  const requestFormat = provider?.requestFormat;
  const model = options.model || 'gpt-4o';
  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 2000;

  if (requestFormat === 'openai' || requestFormat === 'dashscope') {
    const response = await callOpenAIChat(
      apiKey,
      baseUrl,
      {
        model,
        messages: [
          ...(options.system ? [{ role: 'system', content: options.system }] : []),
          { role: 'user', content: options.prompt },
        ],
        temperature,
        max_tokens: maxTokens,
        upstreamTaskIds: options.upstreamTaskIds,
      },
      { apiKeyId, apiKeyModelId: options.apiKeyModelId, providerId: provider?.id }
    );
    return {
      text: response.choices[0]?.message?.content || '',
      task: responseTask(response),
      response,
    };
  }

  if (requestFormat === 'anthropic') {
    const response = await callClaude(
      apiKey,
      baseUrl,
      {
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: options.prompt }],
        ...(options.system ? { system: options.system } : {}),
        temperature,
        upstreamTaskIds: options.upstreamTaskIds,
      },
      { apiKeyId, apiKeyModelId: options.apiKeyModelId, providerId: provider?.id }
    );
    return {
      text: response.content[0]?.text || '',
      task: responseTask(response),
      response,
    };
  }

  throw new Error(`Provider ${provider?.name || 'unknown'} 暂不支持文本生成`);
}

export async function generateText(options: TextGenerationOptions): Promise<string> {
  return (await generateTextWithMetadata(options)).text;
}

export function parseJsonObject<T>(text: string): T | null {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch?.[1]?.trim() || trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}
