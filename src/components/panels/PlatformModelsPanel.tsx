import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import {
  proxyAdminCreatePlatformModelsFromKey,
  proxyAdminDeletePlatformModel,
  proxyAdminDeletePlatformModelRoute,
  proxyAdminListPlatformModels,
  proxyAdminSavePlatformModel,
  proxyAdminSavePlatformModelRoute,
  proxyListModelCapabilityPresets,
  proxyResolveModelCapabilities,
  proxyListApiKeys,
  proxyListApiKeyModels,
  type ProxyApiKey,
  type ProxyApiKeyModel,
  type ProxyModelCapabilityPreset,
  type ProxyPlatformModel,
  type ProxyPlatformModelCapability,
  type ProxyPlatformModelRoute,
  type ProxyResolvedModelCapabilities,
} from '../../lib/apiProxy';
import { resolveModelCapabilities } from '../../lib/modelCapabilities';
import { cn } from '../../lib/utils';
import type { ModelCapabilities } from '../../types/modelCapabilities';
import { DarkSelect } from '../ui/DarkSelect';
import { PanelButton } from '../ui/PanelButton';

const emptyModelForm = {
  id: '',
  displayName: '',
  description: '',
  capability: 'imageGeneration' as ProxyPlatformModelCapability,
  model: '',
  capabilitiesJson: '{}',
  isEnabled: true,
  sortOrder: 100,
};

const emptyRouteForm = {
  id: '',
  apiKeyId: '',
  apiKeyModelId: '',
  providerId: '',
  upstreamModel: '',
  priority: 100,
  isEnabled: true,
};

const capabilityOptions: Array<{ label: string; value: ProxyPlatformModelCapability }> = [
  { label: '文本', value: 'chat' },
  { label: '图片', value: 'imageGeneration' },
  { label: '视频', value: 'videoGeneration' },
];

const CAPABILITY_SOURCE_LABELS: Record<string, string> = {
  fallback: '兜底能力',
  'matched-rules': '命中能力规则',
  'platform-override': '平台手动覆盖',
  'route-inferred': '路由自动推断',
};

type WorkspaceView = 'details' | 'publish' | 'routes' | 'capabilities';

const workspaceTabs: Array<{ label: string; value: WorkspaceView }> = [
  { label: '模型详情', value: 'details' },
  { label: '路由管理', value: 'routes' },
  { label: '能力限制', value: 'capabilities' },
];

const CLIENT_FALLBACK_PRESETS: ProxyModelCapabilityPreset[] = [
  {
    id: 'client-fallback:openai-compatible:gpt-image-2*',
    label: 'OpenAI GPT Image 2',
    description: '前端兜底预设：用于旧后端未提供解析接口时临时预览。',
    providerId: 'openai-compatible',
    modelPattern: 'gpt-image-2*',
    capabilities: {
      chat: false,
      imageGeneration: true,
      imageReference: true,
      multiImageReference: true,
      negativePrompt: false,
      seed: false,
      quality: true,
      responseFormatB64: true,
      responseFormatUrl: false,
      videoGeneration: false,
      image: {
        sizeAliases: ['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840'],
        minPixels: 655360,
        maxPixels: 8294400,
        minAspectRatio: 1 / 3,
        maxAspectRatio: 3,
        maxImages: 1,
        maxReferenceImages: 16,
        imageFormats: ['png', 'jpg', 'jpeg', 'webp'],
        maxImageFileMb: 50,
        maskMaxFileMb: 4,
        outputFormats: ['png', 'jpeg', 'webp'],
        supportsTransparentBackground: false,
      },
    },
  },
];

function parseCapabilitiesJson(value: string): ModelCapabilities {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ModelCapabilities : {};
  } catch {
    return {};
  }
}

function stringifyCapabilities(value: ModelCapabilities): string {
  return JSON.stringify(value || {}, null, 2);
}

function capabilityFromCapabilities(capabilities: ModelCapabilities): ProxyPlatformModelCapability {
  if (capabilities.videoGeneration) return 'videoGeneration';
  if (capabilities.imageGeneration) return 'imageGeneration';
  return 'chat';
}

function numberInputValue(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function listInputValue(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(', ') : '';
}

function parseListInput(value: string): string[] | undefined {
  const items = value
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parseNumberInput(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanEmptySections(capabilities: ModelCapabilities): ModelCapabilities {
  const next = { ...capabilities };
  if (next.image && Object.keys(next.image).length === 0) delete next.image;
  if (next.video && Object.keys(next.video).length === 0) delete next.video;
  if (next.text && Object.keys(next.text).length === 0) delete next.text;
  return next;
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 'i');
}

function routeNotFoundMessage(message: string): boolean {
  return /route not found/i.test(message);
}

function resolveCapabilitiesFromPresets(
  presets: ProxyModelCapabilityPreset[],
  providerId: string,
  model: string
): ProxyResolvedModelCapabilities {
  const mergedPresets = [...presets, ...CLIENT_FALLBACK_PRESETS]
    .filter((preset, index, all) =>
      all.findIndex((item) => item.providerId === preset.providerId && item.modelPattern === preset.modelPattern) === index
    );
  const records = mergedPresets.map((preset) => ({
    capabilities: preset.capabilities,
    createdAt: '',
    id: preset.id,
    modelPattern: preset.modelPattern,
    providerId: preset.providerId,
    updatedAt: '',
  }));
  const matchedRules = mergedPresets
    .filter((preset) => preset.providerId === providerId)
    .filter((preset) => preset.modelPattern === '*' || wildcardToRegExp(preset.modelPattern).test(model))
    .map((preset) => ({
      id: preset.id,
      providerId: preset.providerId,
      modelPattern: preset.modelPattern,
    }));

  return {
    capabilities: resolveModelCapabilities(records, providerId, model) || {},
    matchedRules,
    source: matchedRules.length > 0 ? 'matched-rules' : 'fallback',
  };
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function modelToForm(model: ProxyPlatformModel) {
  const overrides = model.capabilityOverrides || {};
  return {
    id: model.id,
    displayName: model.displayName,
    description: model.description || '',
    capability: model.capability,
    model: model.model,
    capabilitiesJson: stringifyCapabilities(overrides),
    isEnabled: model.isEnabled,
    sortOrder: model.sortOrder || 100,
  };
}

function routeToForm(route: ProxyPlatformModelRoute) {
  return {
    id: route.id,
    apiKeyId: route.apiKeyId,
    apiKeyModelId: route.apiKeyModelId || '',
    providerId: route.providerId || '',
    upstreamModel: route.upstreamModel || '',
    priority: route.priority || 100,
    isEnabled: route.isEnabled,
  };
}

function primaryRoute(model: ProxyPlatformModel | null): ProxyPlatformModelRoute | null {
  if (!model?.routes?.length) return null;
  return [...model.routes].sort((left, right) => (left.priority || 100) - (right.priority || 100))[0];
}

function routeSummary(model: ProxyPlatformModel): string {
  const route = primaryRoute(model);
  if (!route) return '未绑定上游路由';
  return `${route.apiKey?.name || route.apiKeyId} / ${route.upstreamModel || model.model}`;
}

function modelStatusBadges(model: ProxyPlatformModel): Array<{ label: string; tone: 'green' | 'amber' | 'red' | 'gray' }> {
  if (!model.isEnabled) return [{ label: '已禁用', tone: 'red' }];
  if (!model.routes?.length) return [{ label: '未绑定路由', tone: 'amber' }];
  if (!model.capabilitySource || model.capabilitySource === 'fallback' || model.capabilityWarnings?.length) {
    return [
      { label: '可运行', tone: 'green' },
      { label: '能力未声明', tone: 'amber' },
    ];
  }
  return [{ label: '可运行', tone: 'green' }];
}

function badgeClassName(tone: 'green' | 'amber' | 'red' | 'gray'): string {
  if (tone === 'green') return 'bg-emerald-500/15 text-emerald-300';
  if (tone === 'amber') return 'bg-amber-500/15 text-amber-300';
  if (tone === 'red') return 'bg-red-500/15 text-red-300';
  return 'bg-panel-bg text-gray-400';
}

export function PlatformModelsPanel() {
  const [models, setModels] = useState<ProxyPlatformModel[]>([]);
  const [serverKeys, setServerKeys] = useState<ProxyApiKey[]>([]);
  const [presets, setPresets] = useState<ProxyModelCapabilityPreset[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [activeView, setActiveView] = useState<WorkspaceView>('details');
  const [modelForm, setModelForm] = useState(emptyModelForm);
  const [routeForm, setRouteForm] = useState(emptyRouteForm);
  const [routeKeyModels, setRouteKeyModels] = useState<ProxyApiKeyModel[]>([]);
  const [showAdvancedCapabilities, setShowAdvancedCapabilities] = useState(false);
  const [capabilityPreview, setCapabilityPreview] = useState<ProxyResolvedModelCapabilities | null>(null);
  const [capabilityPreviewError, setCapabilityPreviewError] = useState('');
  const [capabilityPreviewNotice, setCapabilityPreviewNotice] = useState('');
  const [capabilityPreviewLoading, setCapabilityPreviewLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [savingRoute, setSavingRoute] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [modelSaveState, setModelSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [modelSaveMessage, setModelSaveMessage] = useState('');
  const [routeSaveState, setRouteSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [routeSaveMessage, setRouteSaveMessage] = useState('');
  const [bulkKeyId, setBulkKeyId] = useState('');
  const [bulkKeyModels, setBulkKeyModels] = useState<ProxyApiKeyModel[]>([]);
  const [bulkCapability, setBulkCapability] = useState<ProxyPlatformModelCapability>('imageGeneration');
  const [bulkSelectedModels, setBulkSelectedModels] = useState<string[]>([]);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [appliedCapabilityTemplate, setAppliedCapabilityTemplate] = useState('');

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) || null,
    [models, selectedModelId]
  );
  const selectedRouteKey = useMemo(
    () => serverKeys.find((key) => key.id === routeForm.apiKeyId) || null,
    [routeForm.apiKeyId, serverKeys]
  );
  const selectedRouteKeyModels = useMemo(
    () => routeKeyModels.filter((model) => model.isEnabled && model.discoveryStatus === 'active'),
    [routeKeyModels]
  );
  const selectedBulkKey = useMemo(
    () => serverKeys.find((key) => key.id === bulkKeyId) || null,
    [bulkKeyId, serverKeys]
  );
  const selectedBulkKeyModels = useMemo(
    () => bulkKeyModels.filter((model) => (
      model.isEnabled
      && model.discoveryStatus === 'active'
      && model.capabilities?.[bulkCapability] === true
    )),
    [bulkCapability, bulkKeyModels]
  );
  const visibleCapabilitySource = capabilityPreview?.source || selectedModel?.capabilitySource || '';
  const parsedCapabilities = useMemo(
    () => parseCapabilitiesJson(modelForm.capabilitiesJson),
    [modelForm.capabilitiesJson]
  );
  const presetOptions = useMemo(
    () => presets.map((preset) => ({
      label: preset.label || `${preset.providerId} ${preset.modelPattern}`,
      value: preset.id,
    })),
    [presets]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [modelData, keyData] = await Promise.all([
        proxyAdminListPlatformModels({ limit: 500, search: search.trim() }),
        proxyListApiKeys({ keyScope: 'server', limit: 500 }),
      ]);
      const presetData = await proxyListModelCapabilityPresets();
      setModels(modelData.models);
      setServerKeys(keyData.apiKeys.filter((key) => key.keyScope === 'server'));
      setPresets(presetData.presets);
      setSelectedModelId((current) =>
        modelData.models.some((model) => model.id === current) ? current : modelData.models[0]?.id || ''
      );
    } catch (err) {
      setError(toErrorMessage(err, '平台模型加载失败'));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!selectedModel) return;
    const route = primaryRoute(selectedModel);
    setModelForm(modelToForm(selectedModel));
    setAppliedCapabilityTemplate('');
    setRouteForm(route ? routeToForm(route) : {
      ...emptyRouteForm,
      upstreamModel: selectedModel.model,
      apiKeyId: serverKeys[0]?.id || '',
      providerId: serverKeys[0]?.providerId || '',
    });
  }, [selectedModel, serverKeys]);

  useEffect(() => {
    if (bulkKeyId || serverKeys.length === 0) return;
    setBulkKeyId(serverKeys[0].id);
  }, [bulkKeyId, serverKeys]);

  useEffect(() => {
    if (!routeForm.apiKeyId) {
      setRouteKeyModels([]);
      return;
    }
    let cancelled = false;
    proxyListApiKeyModels(routeForm.apiKeyId)
      .then((data) => {
        if (!cancelled) setRouteKeyModels(data.models);
      })
      .catch(() => {
        if (!cancelled) setRouteKeyModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [routeForm.apiKeyId]);

  useEffect(() => {
    if (!bulkKeyId) {
      setBulkKeyModels([]);
      return;
    }
    let cancelled = false;
    proxyListApiKeyModels(bulkKeyId)
      .then((data) => {
        if (!cancelled) setBulkKeyModels(data.models);
      })
      .catch(() => {
        if (!cancelled) setBulkKeyModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [bulkKeyId]);

  useEffect(() => {
    if (routeForm.apiKeyModelId || routeKeyModels.length === 0) return;
    const selected = routeKeyModels.find((model) => model.upstreamModel === routeForm.upstreamModel)
      || routeKeyModels.find((model) => model.isEnabled && model.discoveryStatus === 'active');
    if (!selected) return;
    setRouteForm((current) => ({
      ...current,
      apiKeyModelId: selected.id,
      upstreamModel: selected.upstreamModel,
      providerId: selected.modelProviderId || current.providerId,
    }));
  }, [routeForm.apiKeyModelId, routeForm.upstreamModel, routeKeyModels]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 1800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const providerId = routeForm.providerId || selectedRouteKey?.providerId || '';
    const upstreamModel = routeForm.upstreamModel || selectedModel?.model || '';
    if (!providerId || !upstreamModel) {
      setCapabilityPreview(null);
      setCapabilityPreviewError('');
      setCapabilityPreviewNotice('');
      setCapabilityPreviewLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCapabilityPreviewLoading(true);
      setCapabilityPreviewError('');
      setCapabilityPreviewNotice('');
      proxyResolveModelCapabilities(providerId, upstreamModel)
        .then((preview) => {
          if (!cancelled) setCapabilityPreview(preview);
        })
        .catch((err) => {
          if (!cancelled) {
            const message = toErrorMessage(err, '能力预览加载失败');
            if (routeNotFoundMessage(message)) {
              setCapabilityPreview(resolveCapabilitiesFromPresets(presets, providerId, upstreamModel));
              setCapabilityPreviewNotice('已使用前端预设临时预览。后端更新后会自动使用服务端解析。');
              setCapabilityPreviewError('');
              return;
            }
            setCapabilityPreview(null);
            setCapabilityPreviewError(message);
            setCapabilityPreviewNotice('');
          }
        })
        .finally(() => {
          if (!cancelled) setCapabilityPreviewLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [presets, routeForm.providerId, routeForm.upstreamModel, selectedModel?.model, selectedRouteKey?.providerId]);

  const setCapabilities = (next: ModelCapabilities) => {
    setAppliedCapabilityTemplate('手动编辑');
    setModelForm((current) => ({
      ...current,
      capabilitiesJson: stringifyCapabilities(cleanEmptySections(next)),
    }));
  };

  const applyPreset = (presetId: string) => {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) return;
    setModelForm((current) => ({
      ...current,
      capability: capabilityFromCapabilities(preset.capabilities),
      capabilitiesJson: stringifyCapabilities(preset.capabilities),
      model: current.model || preset.modelPattern.replace(/\*+$/, ''),
    }));
    setAppliedCapabilityTemplate(preset.label || `${preset.providerId} ${preset.modelPattern}`);
    setShowAdvancedCapabilities(true);
    setNotice('已套用能力模板，请按模型文档确认限制并保存');
  };

  const copyRouteCapabilities = () => {
    if (!capabilityPreview) {
      setError('请先选择服务器 Key 和上游模型，等待能力预览加载完成');
      return;
    }
    setModelForm((current) => ({
      ...current,
      capability: capabilityFromCapabilities(capabilityPreview.capabilities),
      capabilitiesJson: stringifyCapabilities(capabilityPreview.capabilities),
    }));
    setAppliedCapabilityTemplate('当前路由推断');
    setShowAdvancedCapabilities(true);
    setNotice('已复制当前路由推断能力，请确认后保存');
  };

  const startNewModel = () => {
    setSelectedModelId('');
    setActiveView('details');
    setModelForm(emptyModelForm);
    setRouteForm(emptyRouteForm);
    setShowAdvancedCapabilities(false);
    setAppliedCapabilityTemplate('');
    setModelSaveState('idle');
    setModelSaveMessage('');
    setRouteSaveState('idle');
    setRouteSaveMessage('');
    setError('');
  };

  const saveModel = async () => {
    if (!modelForm.displayName.trim() || !modelForm.model.trim()) {
      const message = '请填写平台模型名称和默认模型名';
      setError(message);
      setModelSaveState('error');
      setModelSaveMessage(message);
      return;
    }

    let capabilities: ModelCapabilities;
    try {
      capabilities = JSON.parse(modelForm.capabilitiesJson || '{}') as ModelCapabilities;
    } catch {
      const message = '能力 JSON 不是合法 JSON';
      setError(message);
      setModelSaveState('error');
      setModelSaveMessage(message);
      return;
    }

    setSavingModel(true);
    setModelSaveState('saving');
    setModelSaveMessage('正在保存平台模型...');
    setError('');
    try {
      const { model } = await proxyAdminSavePlatformModel({
        id: modelForm.id || undefined,
        displayName: modelForm.displayName.trim(),
        description: modelForm.description.trim(),
        capability: modelForm.capability,
        model: modelForm.model.trim(),
        capabilities,
        isEnabled: modelForm.isEnabled,
        sortOrder: Number(modelForm.sortOrder || 100),
      });
      setNotice('平台模型已保存');
      setModelSaveState('saved');
      setModelSaveMessage('平台模型已保存');
      setAppliedCapabilityTemplate('');
      setSelectedModelId(model.id);
      await loadData();
    } catch (err) {
      const message = toErrorMessage(err, '平台模型保存失败');
      setError(message);
      setModelSaveState('error');
      setModelSaveMessage(message);
    } finally {
      setSavingModel(false);
    }
  };

  const deleteModel = async (model: ProxyPlatformModel) => {
    if (!window.confirm(`确定删除平台模型「${model.displayName}」吗？它下面的路由也会删除。`)) return;
    setError('');
    try {
      await proxyAdminDeletePlatformModel(model.id);
      setNotice('平台模型已删除');
      setSelectedModelId('');
      await loadData();
    } catch (err) {
      setError(toErrorMessage(err, '平台模型删除失败'));
    }
  };

  const saveRoute = async () => {
    if (!selectedModel) {
      const message = '请先保存并选择一个平台模型';
      setError(message);
      setRouteSaveState('error');
      setRouteSaveMessage(message);
      return;
    }
    if (!routeForm.apiKeyId) {
      const message = '请选择服务器 Key';
      setError(message);
      setRouteSaveState('error');
      setRouteSaveMessage(message);
      return;
    }

    setSavingRoute(true);
    setRouteSaveState('saving');
    setRouteSaveMessage('正在保存路由...');
    setError('');
    try {
      await proxyAdminSavePlatformModelRoute(selectedModel.id, {
        id: routeForm.id || undefined,
        apiKeyId: routeForm.apiKeyId,
        apiKeyModelId: routeForm.apiKeyModelId,
        providerId: routeForm.providerId,
        upstreamModel: routeForm.upstreamModel || selectedModel.model,
        priority: Number(routeForm.priority || 100),
        isEnabled: routeForm.isEnabled,
      });
      setNotice('模型路由已保存');
      setRouteSaveState('saved');
      setRouteSaveMessage('模型路由已保存');
      await loadData();
    } catch (err) {
      const message = toErrorMessage(err, '模型路由保存失败');
      setError(message);
      setRouteSaveState('error');
      setRouteSaveMessage(message);
    } finally {
      setSavingRoute(false);
    }
  };

  const deleteRoute = async (route: ProxyPlatformModelRoute) => {
    if (!selectedModel || !window.confirm(`确定删除路由「${route.apiKey?.name || route.apiKeyId}」吗？`)) return;
    setError('');
    try {
      await proxyAdminDeletePlatformModelRoute(selectedModel.id, route.id);
      setNotice('模型路由已删除');
      await loadData();
    } catch (err) {
      setError(toErrorMessage(err, '模型路由删除失败'));
    }
  };

  const selectServerKey = (apiKeyId: string) => {
    const key = serverKeys.find((item) => item.id === apiKeyId);
    const firstModel = key?.models?.find(Boolean) || '';
    setRouteForm((current) => ({
      ...current,
      apiKeyId,
      apiKeyModelId: '',
      providerId: key?.providerId || current.providerId,
      upstreamModel: firstModel || selectedModel?.model || '',
    }));
  };

  const selectBulkServerKey = (apiKeyId: string) => {
    setBulkKeyId(apiKeyId);
    setBulkSelectedModels([]);
  };

  const toggleBulkModel = (model: string) => {
    setBulkSelectedModels((current) =>
      current.includes(model)
        ? current.filter((item) => item !== model)
        : [...current, model]
    );
  };

  const createModelsFromKey = async () => {
    if (!bulkKeyId) {
      setError('请选择服务器 Key');
      return;
    }
    if (bulkSelectedModels.length === 0) {
      setError('请至少勾选一个上游模型');
      return;
    }

    setBulkCreating(true);
    setError('');
    try {
      const result = await proxyAdminCreatePlatformModelsFromKey({
        apiKeyId: bulkKeyId,
        capability: bulkCapability,
        apiKeyModelIds: bulkSelectedModels,
      });
      setNotice(`已创建 ${result.count.created} 个平台模型，跳过 ${result.count.skipped} 个已绑定模型`);
      setBulkSelectedModels([]);
      if (result.created[0]?.model?.id) {
        setSelectedModelId(result.created[0].model.id);
        setActiveView('details');
      }
      await loadData();
    } catch (err) {
      setError(toErrorMessage(err, '从服务器 Key 生成平台模型失败'));
    } finally {
      setBulkCreating(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索平台模型"
            className="w-full rounded-md border border-panel-border bg-panel-bg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
          />
        </div>
        <button
          onClick={() => void loadData()}
          className="inline-flex items-center gap-1.5 rounded-md border border-panel-border px-3 py-2 text-xs text-gray-300 hover:border-accent hover:text-accent"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          刷新
        </button>
        <button
          type="button"
          onClick={startNewModel}
          className="inline-flex items-center gap-1.5 rounded-md border border-panel-border px-3 py-2 text-xs text-gray-300 hover:border-accent hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" />
          新建空模型
        </button>
        <PanelButton
          onClick={() => {
            setActiveView('publish');
            setError('');
          }}
          variant="primary"
          size="md"
        >
          <Plus className="h-3.5 w-3.5" />
          发布服务器模型
        </PanelButton>
      </div>

      {notice && <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{notice}</div>}
      {error && <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <div className="overflow-hidden rounded-lg border border-panel-border bg-canvas-bg/40">
          <div className="border-b border-panel-border px-3 py-2">
            <div className="text-xs font-medium text-gray-200">平台模型</div>
            <div className="mt-1 text-[10px] text-gray-500">工作台只展示这里发布且启用的服务器模型。</div>
          </div>
          {models.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-gray-500">暂无平台模型</div>
          ) : (
            models.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => {
                  setSelectedModelId(model.id);
                  setActiveView('details');
                  setError('');
                }}
                className={cn(
                  'flex w-full items-start gap-2 border-b border-panel-border bg-canvas-bg/50 px-3 py-3 text-left last:border-b-0 hover:bg-white/5',
                  selectedModelId === model.id && activeView !== 'publish' && 'bg-accent/10'
                )}
              >
                <Bot className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-white">{model.displayName}</span>
                  <span className="mt-1 block truncate text-[10px] text-gray-500">{routeSummary(model)}</span>
                  <span className="mt-2 flex flex-wrap gap-1">
                    <span className="rounded bg-panel-bg px-1.5 py-0.5 text-[9px] text-gray-400">{capabilityOptions.find((item) => item.value === model.capability)?.label || model.capability}</span>
                    <span className="rounded bg-panel-bg px-1.5 py-0.5 text-[9px] text-gray-400">{model.routes?.length || 0} 路由</span>
                    {modelStatusBadges(model).map((badge) => (
                      <span key={badge.label} className={cn('rounded px-1.5 py-0.5 text-[9px]', badgeClassName(badge.tone))}>
                        {badge.label}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        {activeView === 'publish' ? (
          <section className="space-y-4 rounded-lg border border-panel-border bg-canvas-bg/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white">发布服务器模型</div>
                <div className="mt-1 text-xs text-gray-500">从某个服务器 Key 的已保存模型列表批量生成平台模型，并自动绑定默认主路由。</div>
              </div>
              <button
                type="button"
                onClick={() => setActiveView('details')}
                className="rounded-md border border-panel-border px-3 py-1.5 text-xs text-gray-300 hover:border-accent hover:text-accent"
              >
                返回模型详情
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Select
                label="服务器 Key"
                value={bulkKeyId}
                onChange={selectBulkServerKey}
                options={serverKeys.map((key) => ({ label: key.name || key.providerId, value: key.id }))}
              />
              <Select
                label="能力类型"
                value={bulkCapability}
                onChange={(value) => {
                  setBulkCapability(value as ProxyPlatformModelCapability);
                  setBulkSelectedModels([]);
                }}
                options={capabilityOptions}
              />
            </div>

            <div className="rounded-lg border border-panel-border bg-panel-bg">
              <div className="flex items-center justify-between gap-2 border-b border-panel-border px-3 py-2">
                <span className="text-xs text-gray-300">
                  {selectedBulkKey ? `${selectedBulkKey.name || selectedBulkKey.providerId} 保存的模型` : '请选择服务器 Key'}
                </span>
                <div className="flex gap-1">
                  <SmallButton
                    disabled={selectedBulkKeyModels.length === 0}
                    onClick={() => setBulkSelectedModels(selectedBulkKeyModels.map((model) => model.id))}
                  >
                    全选
                  </SmallButton>
                  <SmallButton
                    disabled={bulkSelectedModels.length === 0}
                    onClick={() => setBulkSelectedModels([])}
                  >
                    清空
                  </SmallButton>
                </div>
              </div>
              {selectedBulkKeyModels.length === 0 ? (
                <div className="px-3 py-10 text-center text-xs text-gray-500">这个 Key 没有已启用的此类模型。请切换能力类型，或先到服务器 Key 页面发现并启用模型。</div>
              ) : (
                <div className="grid max-h-[420px] gap-1 overflow-auto p-2 md:grid-cols-2">
                  {selectedBulkKeyModels.map((model) => {
                    const checked = bulkSelectedModels.includes(model.id);
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => toggleBulkModel(model.id)}
                        className={cn(
                          'flex items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-left text-xs text-gray-300 hover:bg-white/5',
                          checked && 'border-accent/30 bg-accent/10 text-accent'
                        )}
                      >
                        <span className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                          checked ? 'border-accent bg-accent text-white' : 'border-panel-border bg-canvas-bg'
                        )}>
                          {checked ? '✓' : ''}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{model.displayName || model.upstreamModel}</span>
                          <span className="mt-0.5 block truncate text-[9px] text-gray-500">{model.adapterId} · {model.upstreamModel}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={bulkCreating || bulkSelectedModels.length === 0}
              onClick={() => void createModelsFromKey()}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-accent/45 bg-accent/15 px-3 py-2 text-xs font-medium text-white hover:border-accent/70 hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {bulkCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {bulkCreating ? '正在生成...' : `生成 ${bulkSelectedModels.length} 个平台模型`}
            </button>
          </section>
        ) : (
          <section className="space-y-4 rounded-lg border border-panel-border bg-canvas-bg/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white">{selectedModel ? selectedModel.displayName : '新建平台模型'}</div>
                <div className="mt-1 text-xs text-gray-500">
                  {selectedModel ? '先维护基础信息，再按需管理路由和能力限制。' : '先保存基础信息，保存后才能绑定路由和配置能力。'}
                </div>
              </div>
              <div className="flex rounded-lg border border-panel-border bg-panel-bg p-1">
                {workspaceTabs.map((tab) => {
                  const disabled = !selectedModel && tab.value !== 'details';
                  return (
                    <button
                      key={tab.value}
                      type="button"
                      disabled={disabled}
                      onClick={() => setActiveView(tab.value)}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                        activeView === tab.value ? 'bg-accent/20 text-white' : 'text-gray-400 hover:text-white'
                      )}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {activeView === 'details' && (
              <div className="space-y-3">
                <div className="grid gap-3 lg:grid-cols-2">
                  <Input label="展示名称" value={modelForm.displayName} onChange={(value) => setModelForm((current) => ({ ...current, displayName: value }))} placeholder="例如 image2.0" />
                  <Select
                    label="能力类型"
                    value={modelForm.capability}
                    onChange={(value) => setModelForm((current) => ({ ...current, capability: value as ProxyPlatformModelCapability }))}
                    options={capabilityOptions}
                  />
                  <Input label="平台模型标识 / 默认上游模型" value={modelForm.model} onChange={(value) => setModelForm((current) => ({ ...current, model: value }))} placeholder="例如 gpt-image-1" />
                  <Input label="排序" type="number" value={String(modelForm.sortOrder)} onChange={(value) => setModelForm((current) => ({ ...current, sortOrder: Number(value || 100) }))} />
                </div>
                <Input label="描述" value={modelForm.description} onChange={(value) => setModelForm((current) => ({ ...current, description: value }))} placeholder="给工作台展示的说明" />
                <SwitchRow label="启用平台模型" checked={modelForm.isEnabled} onChange={(value) => setModelForm((current) => ({ ...current, isEnabled: value }))} />
                <div className="flex gap-2">
                  <SaveActionButton
                    className="flex-1"
                    onClick={() => void saveModel()}
                    disabled={savingModel}
                    saving={savingModel}
                    state={modelSaveState}
                  >
                    保存平台模型
                  </SaveActionButton>
                  {selectedModel && (
                    <button
                      onClick={() => void deleteModel(selectedModel)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-500/30 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      删除
                    </button>
                  )}
                </div>
                <ActionFeedback message={modelSaveMessage} state={modelSaveState} />
              </div>
            )}

            {activeView === 'routes' && selectedModel && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-gray-300">路由管理</div>
                    <div className="mt-1 text-[10px] text-gray-500">普通工作台不会看到这些路由，只会看到平台模型。</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRouteForm({
                      ...emptyRouteForm,
                      apiKeyId: serverKeys[0]?.id || '',
                      apiKeyModelId: '',
                      providerId: serverKeys[0]?.providerId || '',
                      upstreamModel: serverKeys[0]?.models?.find(Boolean) || selectedModel.model || '',
                    })}
                    className="rounded-md border border-panel-border px-2 py-1 text-[10px] text-gray-300 hover:border-accent hover:text-accent"
                  >
                    新路由
                  </button>
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  <Select
                    label="服务器 Key"
                    value={routeForm.apiKeyId}
                    onChange={selectServerKey}
                    options={serverKeys.map((key) => ({ label: key.name || key.providerId, value: key.id }))}
                  />
                  <Input label="Provider" value={routeForm.providerId} onChange={(value) => setRouteForm((current) => ({ ...current, providerId: value }))} placeholder="默认用 Key 的 provider" />
                  <ModelPicker
                    apiKeyName={selectedRouteKey?.name || selectedRouteKey?.providerId || ''}
                    label="上游模型名"
                    models={selectedRouteKeyModels.map((model) => model.upstreamModel)}
                    value={routeForm.upstreamModel}
                    onChange={(value) => setRouteForm((current) => ({
                      ...current,
                      upstreamModel: value,
                      apiKeyModelId: selectedRouteKeyModels.find((model) => model.upstreamModel === value)?.id || '',
                    }))}
                    placeholder={selectedModel.model || '例如 gpt-image-1'}
                  />
                  <Input label="优先级" type="number" value={String(routeForm.priority)} onChange={(value) => setRouteForm((current) => ({ ...current, priority: Number(value || 100) }))} />
                </div>
                <SwitchRow label="启用这条路由" checked={routeForm.isEnabled} onChange={(value) => setRouteForm((current) => ({ ...current, isEnabled: value }))} />
                <SaveActionButton
                  onClick={() => void saveRoute()}
                  disabled={savingRoute}
                  saving={savingRoute}
                  state={routeSaveState}
                >
                  保存路由
                </SaveActionButton>
                <ActionFeedback message={routeSaveMessage} state={routeSaveState} />

                <div className="overflow-hidden rounded-lg border border-panel-border">
                  {!selectedModel.routes?.length ? (
                    <div className="px-3 py-8 text-center text-xs text-gray-500">暂无路由</div>
                  ) : (
                    selectedModel.routes.map((route) => (
                      <div key={route.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-panel-border bg-panel-bg/50 px-3 py-2 last:border-b-0">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-white">{route.apiKey?.name || route.apiKeyId}</div>
                          <div className="mt-1 text-[10px] text-gray-500">实际调用模型</div>
                          <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-gray-500">
                            <span className="rounded bg-canvas-bg px-1.5 py-0.5">{route.providerId || route.apiKey?.providerId}</span>
                            <span className="rounded bg-canvas-bg px-1.5 py-0.5">{route.upstreamModel || selectedModel.model}</span>
                            <span className="rounded bg-canvas-bg px-1.5 py-0.5">优先级 {route.priority}</span>
                            <span className={cn('rounded px-1.5 py-0.5', route.isEnabled && route.apiKey?.isEnabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300')}>
                              {route.isEnabled && route.apiKey?.isEnabled ? '可用' : '不可用'}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <SmallButton onClick={() => setRouteForm(routeToForm(route))}>编辑</SmallButton>
                          <SmallButton danger onClick={() => void deleteRoute(route)}>删除</SmallButton>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeView === 'capabilities' && selectedModel && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-gray-300">能力限制</div>
                    <div className="mt-1 text-[10px] text-gray-500">先看自动推断。只有未命中、推断错误，或模型文档限制不同，才需要套用模板或手动覆盖。</div>
                  </div>
                  <span className="rounded bg-panel-bg px-2 py-1 text-[10px] text-gray-400">
                    当前：{CAPABILITY_SOURCE_LABELS[visibleCapabilitySource] || '能力未声明'}
                  </span>
                </div>
                <div className="rounded-md border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-[10px] leading-4 text-blue-100">
                  如果下方自动推断显示的类型和限制正确，就不用选择模板。模板只是快速写入覆盖项，用于新模型未命中规则或文档限制需要修正时。
                </div>
                {selectedModel.capabilityWarnings?.length ? (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] leading-4 text-amber-200">
                    {selectedModel.capabilityWarnings.join('；')}
                  </div>
                ) : null}
                <CapabilityPreview preview={capabilityPreview} loading={capabilityPreviewLoading} error={capabilityPreviewError} notice={capabilityPreviewNotice} />
                <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                  <Select
                    label="高级：套用能力模板"
                    value=""
                    onChange={applyPreset}
                    options={presetOptions}
                  />
                  <button
                    type="button"
                    onClick={copyRouteCapabilities}
                    className="self-end rounded-md border border-panel-border px-3 py-1.5 text-xs text-gray-300 hover:border-accent hover:text-accent"
                  >
                    把自动推断保存为覆盖
                  </button>
                </div>
                {appliedCapabilityTemplate && (
                  <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[10px] text-emerald-200">
                    当前待保存覆盖来源：{appliedCapabilityTemplate}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setShowAdvancedCapabilities((current) => !current)}
                  className="text-[10px] text-gray-500 hover:text-accent"
                >
                  {showAdvancedCapabilities ? '收起手动覆盖表单' : '展开手动覆盖表单'}
                </button>
                {showAdvancedCapabilities && (
                  <div className="space-y-3">
                    <CapabilityEditor
                      capability={modelForm.capability}
                      capabilities={parsedCapabilities}
                      onChange={setCapabilities}
                    />
                    <label className="block space-y-1">
                      <span className="text-[10px] text-gray-500">能力限制 JSON</span>
                      <textarea
                        value={modelForm.capabilitiesJson}
                        onChange={(event) => {
                          setAppliedCapabilityTemplate('手动编辑 JSON');
                          setModelForm((current) => ({ ...current, capabilitiesJson: event.target.value }));
                        }}
                        rows={8}
                        className="w-full resize-y rounded-md border border-panel-border bg-canvas-bg px-2.5 py-2 font-mono text-[11px] leading-5 text-gray-200 focus:border-accent focus:outline-none"
                        spellCheck={false}
                      />
                    </label>
                  </div>
                )}
                <SaveActionButton
                  onClick={() => void saveModel()}
                  disabled={savingModel}
                  saving={savingModel}
                  state={modelSaveState}
                >
                  保存能力覆盖
                </SaveActionButton>
                <ActionFeedback message={modelSaveMessage} state={modelSaveState} />
              </div>
            )}
          </section>
        )}
      </div>
    </section>
  );
}

function SaveActionButton({
  children,
  className,
  disabled,
  onClick,
  saving,
  state,
}: {
  children: string;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  saving: boolean;
  state: 'idle' | 'saving' | 'saved' | 'error';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium shadow-sm shadow-black/20 transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        state === 'saved'
          ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/20'
          : state === 'error'
            ? 'border-red-500/45 bg-red-500/15 text-red-100 hover:bg-red-500/20'
            : 'border-accent/45 bg-accent/15 text-white hover:border-accent/70 hover:bg-accent/25',
        className
      )}
    >
      {saving ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : state === 'saved' ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <Save className="h-3.5 w-3.5" />
      )}
      {saving ? '保存中...' : state === 'saved' ? '已保存' : children}
    </button>
  );
}

function ActionFeedback({
  message,
  state,
}: {
  message: string;
  state: 'idle' | 'saving' | 'saved' | 'error';
}) {
  if (!message || state === 'idle') return null;
  return (
    <div
      className={cn(
        'rounded-md border px-2.5 py-1.5 text-[10px] leading-4',
        state === 'saved' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
        state === 'error' && 'border-red-500/20 bg-red-500/10 text-red-200',
        state === 'saving' && 'border-blue-500/20 bg-blue-500/10 text-blue-200'
      )}
    >
      {message}
    </div>
  );
}

function CapabilityPreview({
  error,
  loading,
  notice,
  preview,
}: {
  error: string;
  loading: boolean;
  notice: string;
  preview: ProxyResolvedModelCapabilities | null;
}) {
  if (loading) {
    return (
      <div className="rounded-md border border-panel-border bg-canvas-bg px-3 py-2 text-[10px] text-gray-500">
        正在解析当前路由能力...
      </div>
    );
  }
  if (error && !preview) {
    return (
      <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] text-red-200">
        {error}
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="rounded-md border border-panel-border bg-canvas-bg px-3 py-2 text-[10px] text-gray-500">
        选择服务器 Key 和上游模型后，会在这里预览自动推断出的能力。
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-panel-border bg-canvas-bg px-3 py-2 text-[10px] text-gray-400">
      {error && (
        <div className="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-amber-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-blue-200">
          {notice}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-panel-bg px-2 py-0.5 text-gray-300">
          {CAPABILITY_SOURCE_LABELS[preview.source] || preview.source}
        </span>
        <span>{capabilitySummary(preview.capabilities)}</span>
      </div>
      {preview.matchedRules.length > 0 ? (
        <div className="text-gray-500">
          命中规则：{preview.matchedRules.map((rule) => `${rule.providerId}/${rule.modelPattern}`).join('、')}
        </div>
      ) : (
        <div className="text-amber-300">未命中模型能力规则，请先从预设填充或手动配置限制。</div>
      )}
    </div>
  );
}

function capabilitySummary(capabilities: ModelCapabilities): string {
  const image = capabilities.image || {};
  const video = capabilities.video || {};
  if (capabilities.imageGeneration) {
    return [
      '图片',
      image.maxImages ? `单次≤${image.maxImages}张` : '',
      image.maxReferenceImages ? `参考图≤${image.maxReferenceImages}` : '',
    ].filter(Boolean).join(' / ');
  }
  if (capabilities.videoGeneration) {
    return [
      '视频',
      video.durationMin || video.durationMax ? `${video.durationMin || 0}-${video.durationMax || '不限'}秒` : '',
      video.maxReferenceImages ? `参考图≤${video.maxReferenceImages}` : '',
    ].filter(Boolean).join(' / ');
  }
  return capabilities.chat ? '文本' : '能力未声明';
}

function CapabilityEditor({
  capabilities,
  capability,
  onChange,
}: {
  capabilities: ModelCapabilities;
  capability: ProxyPlatformModelCapability;
  onChange: (capabilities: ModelCapabilities) => void;
}) {
  const image = capabilities.image || {};
  const video = capabilities.video || {};
  const text = capabilities.text || {};

  const setTopLevel = (key: keyof ModelCapabilities, value: boolean) => {
    onChange({ ...capabilities, [key]: value });
  };
  const setSectionValue = (
    section: 'image' | 'video' | 'text',
    key: string,
    value: boolean | number | string[] | undefined
  ) => {
    const current = capabilities[section];
    const sectionValue: Record<string, unknown> = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete sectionValue[key];
    } else {
      sectionValue[key] = value;
    }
    onChange(cleanEmptySections({ ...capabilities, [section]: sectionValue }));
  };

  const showImage = capability === 'imageGeneration' || Boolean(capabilities.imageGeneration);
  const showVideo = capability === 'videoGeneration' || Boolean(capabilities.videoGeneration);
  const showText = capability === 'chat' || Boolean(capabilities.chat);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <CapabilitySwitch label="文本能力" checked={Boolean(capabilities.chat)} onChange={(value) => setTopLevel('chat', value)} />
        <CapabilitySwitch label="图片生成" checked={Boolean(capabilities.imageGeneration)} onChange={(value) => setTopLevel('imageGeneration', value)} />
        <CapabilitySwitch label="视频生成" checked={Boolean(capabilities.videoGeneration)} onChange={(value) => setTopLevel('videoGeneration', value)} />
        <CapabilitySwitch label="质量参数" checked={Boolean(capabilities.quality)} onChange={(value) => setTopLevel('quality', value)} />
        <CapabilitySwitch label="Seed" checked={Boolean(capabilities.seed)} onChange={(value) => setTopLevel('seed', value)} />
        <CapabilitySwitch label="反向词" checked={Boolean(capabilities.negativePrompt)} onChange={(value) => setTopLevel('negativePrompt', value)} />
        <CapabilitySwitch label="返回 b64_json" checked={Boolean(capabilities.responseFormatB64)} onChange={(value) => setTopLevel('responseFormatB64', value)} />
        <CapabilitySwitch label="返回 URL" checked={Boolean(capabilities.responseFormatUrl)} onChange={(value) => setTopLevel('responseFormatUrl', value)} />
      </div>

      {showImage && (
        <CapabilitySection title="图片限制">
          <div className="grid gap-2 sm:grid-cols-2">
            <CapabilitySwitch label="参考图" checked={Boolean(capabilities.imageReference)} onChange={(value) => setTopLevel('imageReference', value)} />
            <CapabilitySwitch label="多参考图" checked={Boolean(capabilities.multiImageReference)} onChange={(value) => setTopLevel('multiImageReference', value)} />
            <CapabilityNumberInput label="最大生成张数" value={numberInputValue(image.maxImages)} onChange={(value) => setSectionValue('image', 'maxImages', parseNumberInput(value))} />
            <CapabilityNumberInput label="最大参考图" value={numberInputValue(image.maxReferenceImages)} onChange={(value) => setSectionValue('image', 'maxReferenceImages', parseNumberInput(value))} />
            <CapabilityNumberInput label="最小像素" value={numberInputValue(image.minPixels)} onChange={(value) => setSectionValue('image', 'minPixels', parseNumberInput(value))} />
            <CapabilityNumberInput label="最大像素" value={numberInputValue(image.maxPixels)} onChange={(value) => setSectionValue('image', 'maxPixels', parseNumberInput(value))} />
            <CapabilityNumberInput label="最小宽高比" value={numberInputValue(image.minAspectRatio)} onChange={(value) => setSectionValue('image', 'minAspectRatio', parseNumberInput(value))} />
            <CapabilityNumberInput label="最大宽高比" value={numberInputValue(image.maxAspectRatio)} onChange={(value) => setSectionValue('image', 'maxAspectRatio', parseNumberInput(value))} />
            <CapabilityNumberInput label="单图 MB 上限" value={numberInputValue(image.maxImageFileMb)} onChange={(value) => setSectionValue('image', 'maxImageFileMb', parseNumberInput(value))} />
            <CapabilityNumberInput label="Mask MB 上限" value={numberInputValue(image.maskMaxFileMb)} onChange={(value) => setSectionValue('image', 'maskMaxFileMb', parseNumberInput(value))} />
            <CapabilityListInput label="尺寸列表" value={listInputValue(image.sizeAliases || image.sizes)} onChange={(value) => setSectionValue('image', 'sizeAliases', parseListInput(value))} />
            <CapabilityListInput label="输出格式" value={listInputValue(image.outputFormats)} onChange={(value) => setSectionValue('image', 'outputFormats', parseListInput(value))} />
            <CapabilitySwitch label="水印参数" checked={Boolean(image.supportsWatermark)} onChange={(value) => setSectionValue('image', 'supportsWatermark', value)} />
            <CapabilitySwitch label="透明背景" checked={Boolean(image.supportsTransparentBackground)} onChange={(value) => setSectionValue('image', 'supportsTransparentBackground', value)} />
          </div>
        </CapabilitySection>
      )}

      {showVideo && (
        <CapabilitySection title="视频限制">
          <div className="grid gap-2 sm:grid-cols-2">
            <CapabilityNumberInput label="最短秒数" value={numberInputValue(video.durationMin)} onChange={(value) => setSectionValue('video', 'durationMin', parseNumberInput(value))} />
            <CapabilityNumberInput label="最长秒数" value={numberInputValue(video.durationMax)} onChange={(value) => setSectionValue('video', 'durationMax', parseNumberInput(value))} />
            <CapabilityNumberInput label="最大参考图" value={numberInputValue(video.maxReferenceImages)} onChange={(value) => setSectionValue('video', 'maxReferenceImages', parseNumberInput(value))} />
            <CapabilityNumberInput label="最大参考视频" value={numberInputValue(video.maxReferenceVideos)} onChange={(value) => setSectionValue('video', 'maxReferenceVideos', parseNumberInput(value))} />
            <CapabilityNumberInput label="最大参考音频" value={numberInputValue(video.maxReferenceAudios)} onChange={(value) => setSectionValue('video', 'maxReferenceAudios', parseNumberInput(value))} />
            <CapabilityNumberInput label="素材总数上限" value={numberInputValue(video.maxMediaFiles)} onChange={(value) => setSectionValue('video', 'maxMediaFiles', parseNumberInput(value))} />
            <CapabilityNumberInput label="查询 RPS" value={numberInputValue(video.queryRps)} onChange={(value) => setSectionValue('video', 'queryRps', parseNumberInput(value))} />
            <CapabilityNumberInput label="RPM" value={numberInputValue(video.rpm)} onChange={(value) => setSectionValue('video', 'rpm', parseNumberInput(value))} />
            <CapabilityListInput label="模式" value={listInputValue(video.modes)} onChange={(value) => setSectionValue('video', 'modes', parseListInput(value))} />
            <CapabilityListInput label="分辨率" value={listInputValue(video.resolutions)} onChange={(value) => setSectionValue('video', 'resolutions', parseListInput(value))} />
            <CapabilityListInput label="比例" value={listInputValue(video.ratios)} onChange={(value) => setSectionValue('video', 'ratios', parseListInput(value))} />
            <CapabilityListInput label="输出格式" value={listInputValue(video.outputFormats)} onChange={(value) => setSectionValue('video', 'outputFormats', parseListInput(value))} />
            <CapabilitySwitch label="参考图" checked={Boolean(video.supportsReferenceImage)} onChange={(value) => setSectionValue('video', 'supportsReferenceImage', value)} />
            <CapabilitySwitch label="参考视频" checked={Boolean(video.supportsReferenceVideo)} onChange={(value) => setSectionValue('video', 'supportsReferenceVideo', value)} />
            <CapabilitySwitch label="参考音频" checked={Boolean(video.supportsReferenceAudio)} onChange={(value) => setSectionValue('video', 'supportsReferenceAudio', value)} />
            <CapabilitySwitch label="生成音频" checked={Boolean(video.supportsAudioGeneration)} onChange={(value) => setSectionValue('video', 'supportsAudioGeneration', value)} />
            <CapabilitySwitch label="Seed" checked={Boolean(video.supportsSeed)} onChange={(value) => setSectionValue('video', 'supportsSeed', value)} />
            <CapabilitySwitch label="反向词" checked={Boolean(video.supportsNegativePrompt)} onChange={(value) => setSectionValue('video', 'supportsNegativePrompt', value)} />
            <CapabilitySwitch label="水印" checked={Boolean(video.supportsWatermark)} onChange={(value) => setSectionValue('video', 'supportsWatermark', value)} />
          </div>
        </CapabilitySection>
      )}

      {showText && (
        <CapabilitySection title="文本限制">
          <div className="grid gap-2 sm:grid-cols-2">
            <CapabilityNumberInput label="上下文长度" value={numberInputValue(text.contextWindow)} onChange={(value) => setSectionValue('text', 'contextWindow', parseNumberInput(value))} />
            <CapabilityNumberInput label="最大输出 Token" value={numberInputValue(text.maxOutputTokens)} onChange={(value) => setSectionValue('text', 'maxOutputTokens', parseNumberInput(value))} />
            <CapabilitySwitch label="视觉输入" checked={Boolean(text.supportsVisionInput)} onChange={(value) => setSectionValue('text', 'supportsVisionInput', value)} />
          </div>
        </CapabilitySection>
      )}
    </div>
  );
}

function CapabilitySection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="space-y-2 rounded-md border border-panel-border bg-canvas-bg/70 p-2.5">
      <div className="text-[10px] font-medium text-gray-400">{title}</div>
      {children}
    </div>
  );
}

function CapabilitySwitch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-2 rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-left text-[10px] text-gray-300 hover:border-gray-600"
    >
      <span>{label}</span>
      <span className={cn('h-4 w-7 rounded-full p-0.5 transition-colors', checked ? 'bg-accent' : 'bg-gray-700')}>
        <span className={cn('block h-3 w-3 rounded-full bg-white transition-transform', checked && 'translate-x-3')} />
      </span>
    </button>
  );
}

function CapabilityNumberInput({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return <Input label={label} type="number" value={value} onChange={onChange} />;
}

function CapabilityListInput({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return <Input label={label} value={value} onChange={onChange} placeholder="用逗号分隔" />;
}

function Input({
  label,
  onChange,
  placeholder,
  type = 'text',
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] text-gray-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
      />
    </label>
  );
}

function ModelPicker({
  apiKeyName,
  label,
  models,
  onChange,
  placeholder,
  value,
}: {
  apiKeyName: string;
  label: string;
  models: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const datalistId = `platform-route-models-${apiKeyName.replace(/[^a-zA-Z0-9_-]/g, '-') || 'selected-key'}`;

  return (
    <label className="block space-y-1">
      <span className="text-[10px] text-gray-500">{label}</span>
      <input
        list={models.length ? datalistId : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
      />
      {models.length > 0 && (
        <datalist id={datalistId}>
          {models.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      )}
      <span className="block text-[10px] leading-4 text-gray-600">
        {models.length > 0
          ? `可从 ${apiKeyName || '当前 Key'} 已保存的 ${models.length} 个模型里选择，也可以手动输入。`
          : '这个 Key 还没有保存模型列表。先到 API Key 页面自动获取并保存模型，或在这里手动输入。'}
      </span>
    </label>
  );
}

function Select({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <DarkSelect
      label={label}
      value={value}
      onChange={onChange}
      options={[
        { label: '请选择', value: '' },
        ...options,
      ]}
    />
  );
}

function SwitchRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-panel-border bg-panel-bg px-3 py-2 text-left text-xs text-gray-200 hover:border-gray-600"
    >
      <span>{label}</span>
      <span className={cn('h-5 w-10 rounded-full p-0.5 transition-colors', checked ? 'bg-accent' : 'bg-gray-700')}>
        <span className={cn('block h-4 w-4 rounded-full bg-white transition-transform', checked && 'translate-x-5')} />
      </span>
    </button>
  );
}

function SmallButton({ children, danger, disabled, onClick }: { children: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-md border border-panel-border px-2 py-1 text-[10px] text-gray-300 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50',
        danger && 'border-red-500/30 text-red-300 hover:border-red-400 hover:bg-red-500/10 hover:text-red-200'
      )}
    >
      {children}
    </button>
  );
}
