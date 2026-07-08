import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Eye,
  EyeOff,
  Key,
  Laptop,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { FloatingWindow } from '../layout/FloatingWindow';
import { PanelButton } from '../ui/PanelButton';
import { fetchModelsList, useApiStore } from '../../stores/apiStore';
import {
  getCategoryLabel,
  getProviderDefaultModels,
  getProviderTemplate,
  PROVIDER_TEMPLATES,
  setProviderTemplates,
} from '../../data/providerRegistry';
import {
  proxyAuthMe,
  proxyDeleteApiKey,
  proxyListApiKeys,
  proxyListModelCapabilityPresets,
  proxyListModelCapabilities,
  proxyListProviders,
  proxySaveApiKey,
  proxySaveModelCapabilities,
  proxyTestApiKey,
  proxyUpdateApiKey,
  type ProxyApiKey,
  type ProxyApiKeyTestResult,
  type ProxyAuthMe,
  type ProxyModelCapabilityPreset,
  type ProxyModelCapabilities,
} from '../../lib/apiProxy';
import { summarizeApiKeyTestChecks, summarizeApiKeyTestLimits } from '../../lib/apiKeyTestDisplay';
import { apiKeyScopeLabel, canManageApiKeyScope, summarizeApiKeyQuota, type ApiKeyQuotaSummary } from '../../lib/apiKeyScopeDisplay';
import { API_KEY_CAPABILITY_OPTIONS, completeApiKeyAllowedCapabilities, summarizeAllowedCapabilities } from '../../lib/apiInstanceCapabilities';
import { groupModelCapabilityPresetsByProvider, summarizeModelCapabilityPresetPreview } from '../../lib/modelCapabilityPresetDisplay';
import { clearModelCapabilityCache } from '../../lib/modelCapabilityCache';
import { parseOptionalNumberInput, parseOptionalRatioInput } from '../../lib/modelCapabilityForm';
import type { ApiKeyAllowedCapabilities } from '../../types/api';

interface ApiManagerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  allowedTabs?: readonly ApiManagerTab[];
  initialTab?: ApiManagerTab;
  mode?: ApiManagerMode;
  variant?: 'floating' | 'embedded';
}

export type ApiManagerTab = 'local' | 'server' | 'capabilities';
export type ApiManagerMode = 'mixed' | 'workbench-user-keys' | 'admin-server-keys' | 'admin-capabilities';

type KeyTestOptions = {
  model?: string;
  testText?: boolean;
  testImage?: boolean;
  testVideo?: boolean;
};

type CapabilityForm = {
  providerId: string;
  modelPattern: string;
  capabilities: Record<string, unknown>;
};

type BasicApiForm = {
  name: string;
  providerId: string;
  baseUrl: string;
  apiKey: string;
  hasExistingKey?: boolean;
};

const emptyLocalForm = {
  name: '',
  providerId: 'openai-compatible',
  apiKey: '',
  hasExistingKey: false,
  baseUrl: '',
  customHeaders: '',
  models: [] as string[],
  modelFetchMode: 'manual' as 'auto' | 'manual',
  isEnabled: true,
};

const defaultServerAllowedCapabilities: ApiKeyAllowedCapabilities = {
  chat: true,
  imageGeneration: true,
  videoGeneration: true,
};

function serverAllowedCapabilitiesForForm(
  capabilities?: ApiKeyAllowedCapabilities | null,
  fallback?: ApiKeyAllowedCapabilities | null
): ApiKeyAllowedCapabilities {
  const source = capabilities && Object.keys(capabilities).length > 0 ? capabilities : fallback;
  return completeApiKeyAllowedCapabilities(source, true);
}

function hasAllowedCapabilities(capabilities?: Record<string, boolean> | null): boolean {
  return Boolean(capabilities && Object.keys(capabilities).length > 0);
}

function mergeApiKeyFromServer(freshKey: ProxyApiKey, currentKey?: ProxyApiKey): ProxyApiKey {
  if (hasAllowedCapabilities(freshKey.allowedCapabilities) || !hasAllowedCapabilities(currentKey?.allowedCapabilities)) {
    return freshKey;
  }
  return {
    ...freshKey,
    allowedCapabilities: currentKey?.allowedCapabilities,
  };
}

const emptyServerForm = {
  id: '',
  name: '',
  providerId: 'openai-compatible',
  keyScope: 'server' as 'user' | 'server',
  baseUrl: '',
  apiKey: '',
  models: [] as string[],
  allowedCapabilities: { ...defaultServerAllowedCapabilities },
  hasExistingKey: false,
  isEnabled: true,
  testModel: '',
};

type ServerKeyForm = typeof emptyServerForm;

function apiKeyToServerForm(
  key: ProxyApiKey,
  fallback?: Partial<ServerKeyForm>
): ServerKeyForm {
  return {
    id: key.id,
    name: key.name || key.providerId,
    providerId: key.providerId,
    keyScope: key.keyScope,
    baseUrl: key.baseUrl || '',
    apiKey: '',
    models: [...(key.models || [])],
    allowedCapabilities: serverAllowedCapabilitiesForForm(key.allowedCapabilities, fallback?.allowedCapabilities),
    hasExistingKey: true,
    isEnabled: key.isEnabled,
    testModel: fallback?.testModel || '',
  };
}

const SERVER_KEY_PAGE_SIZE = 80;
const CAPABILITY_PAGE_SIZE = 80;

const capabilityKeys = [
  ['chat', '文本'],
  ['imageGeneration', '文生图'],
  ['imageReference', '参考图'],
  ['multiImageReference', '多参考图'],
  ['negativePrompt', '反向词'],
  ['seed', 'Seed'],
  ['quality', '质量'],
  ['responseFormatB64', 'b64 返回'],
  ['responseFormatUrl', 'URL 返回'],
  ['videoGeneration', '视频'],
] as const;

function capabilitySummary(capability: ProxyModelCapabilities): string {
  const labels = capabilityKeys
    .filter(([key]) => Boolean(capability.capabilities[key]))
    .map(([, label]) => label);

  return labels.length ? labels.join(' / ') : '未声明能力';
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function apiKeyScopeUiLabel(scope?: string): string {
  return scope === 'user' ? '我的 API' : apiKeyScopeLabel(scope);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function listToInput(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(', ') : '';
}

function inputToList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberOrUndefined(value: string): number | undefined {
  return parseOptionalNumberInput(value);
}

function mergeById<T extends { id: string }>(current: T[], next: T[]): T[] {
  const items = new Map<string, T>();
  for (const item of current) items.set(item.id, item);
  for (const item of next) items.set(item.id, item);
  return [...items.values()];
}

export function ApiManagerPanel({
  allowedTabs,
  initialTab = 'server',
  isOpen,
  mode,
  onClose,
  variant = 'floating',
}: ApiManagerPanelProps) {
  const { instances, addInstance, removeInstance, updateInstance, setDeploymentMode, syncServerKeyInstances } = useApiStore();
  const [tab, setTab] = useState<ApiManagerTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [localForm, setLocalForm] = useState(emptyLocalForm);
  const [serverForm, setServerForm] = useState(emptyServerForm);
  const [serverKeys, setServerKeys] = useState<ProxyApiKey[]>([]);
  const [serverKeyTotal, setServerKeyTotal] = useState(0);
  const [apiKeyQuota, setApiKeyQuota] = useState<ApiKeyQuotaSummary | null>(null);
  const [capabilities, setCapabilities] = useState<ProxyModelCapabilities[]>([]);
  const [capabilityTotal, setCapabilityTotal] = useState(0);
  const [capabilityPresets, setCapabilityPresets] = useState<ProxyModelCapabilityPreset[]>([]);
  const [capabilityForm, setCapabilityForm] = useState<CapabilityForm>({
    providerId: 'openai-compatible',
    modelPattern: 'gpt-image-*',
    capabilities: {},
  });
  const [isAddingLocal, setIsAddingLocal] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMoreServerKeys, setLoadingMoreServerKeys] = useState(false);
  const [loadingMoreCapabilities, setLoadingMoreCapabilities] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [savingCapabilities, setSavingCapabilities] = useState(false);
  const [autoSaveServerCapabilities] = useState(false);
  const [keyTestResult, setKeyTestResult] = useState<ProxyApiKeyTestResult | null>(null);
  const [authInfo, setAuthInfo] = useState<ProxyAuthMe | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const isServerMode = authInfo?.deploymentMode === 'server';
  const canManageServerKeys = authInfo?.user?.role === 'admin';
  const isEmbedded = variant === 'embedded';
  const resolvedMode: ApiManagerMode = mode
    || (allowedTabs?.length === 1 && allowedTabs[0] === 'capabilities'
      ? 'admin-capabilities'
      : 'mixed');
  const workbenchUserKeysOnly = resolvedMode === 'workbench-user-keys';
  const adminServerKeysOnly = resolvedMode === 'admin-server-keys';
  const adminCapabilitiesOnly = resolvedMode === 'admin-capabilities';
  const apiKeyQueryScope = workbenchUserKeysOnly ? 'user' : adminServerKeysOnly ? 'server' : undefined;
  const keyPanelLabel = workbenchUserKeysOnly ? '我的 API' : adminServerKeysOnly ? '服务器 Key' : '后端 Key';

  const visibleTabs = useMemo<ApiManagerTab[]>(() => {
    if (workbenchUserKeysOnly || adminServerKeysOnly) return ['server'];
    if (adminCapabilitiesOnly) return ['capabilities'];
    const candidates: ApiManagerTab[] = [
      ...(!isServerMode ? ['local' as const] : []),
      'server',
      'capabilities',
    ];
    return allowedTabs?.length ? candidates.filter((item) => allowedTabs.includes(item)) : candidates;
  }, [adminCapabilitiesOnly, adminServerKeysOnly, allowedTabs, isServerMode, workbenchUserKeysOnly]);

  const normalizeTab = useCallback((nextTab: ApiManagerTab): ApiManagerTab => {
    if (visibleTabs.includes(nextTab)) return nextTab;
    return visibleTabs[0] || 'server';
  }, [visibleTabs]);

  const filteredInstances = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return Object.values(instances).filter((instance) => {
      if (instance.id.startsWith('server:')) return false;
      if (!query) return true;
      return instance.name.toLowerCase().includes(query) || instance.providerId.toLowerCase().includes(query);
    });
  }, [instances, searchQuery]);

  const groupedInstances = useMemo(() => {
    const groups: Record<string, typeof filteredInstances> = {};
    for (const instance of filteredInstances) {
      const category = getProviderTemplate(instance.providerId)?.category || 'other';
      groups[category] ||= [];
      groups[category].push(instance);
    }
    return groups;
  }, [filteredInstances]);

  const loadServerData = async (apiKeyOverride?: ProxyApiKey) => {
    setLoading(true);
    setError('');
    const search = searchQuery.trim();
    try {
      const [authData, providersData, keysData, capabilityData, presetData] = await Promise.all([
        proxyAuthMe().catch(() => null),
        proxyListProviders(),
        proxyListApiKeys({ limit: SERVER_KEY_PAGE_SIZE, offset: 0, search, keyScope: apiKeyQueryScope }),
        proxyListModelCapabilities({ limit: CAPABILITY_PAGE_SIZE, offset: 0, search }),
        proxyListModelCapabilityPresets(),
      ]);

      setAuthInfo(authData);
      if (authData?.deploymentMode) {
        setDeploymentMode(authData.deploymentMode);
      }
      if (authData?.deploymentMode === 'server') {
        setTab((current) => current === 'local' ? 'server' : current);
        setIsAddingLocal(false);
        setSelectedInstanceId(null);
      }

      const currentKeyById = new Map(serverKeys.map((key) => [key.id, key]));
      if (apiKeyOverride) currentKeyById.set(apiKeyOverride.id, apiKeyOverride);
      const mergedApiKeys = keysData.apiKeys.map((key) => mergeApiKeyFromServer(key, currentKeyById.get(key.id)));

      setProviderTemplates(providersData.providers);
      setServerKeys(mergedApiKeys);
      setServerForm((current) => {
        if (!current.id) return current;
        const freshKey = mergedApiKeys.find((key) => key.id === current.id);
        return freshKey
          ? apiKeyToServerForm(freshKey, {
            allowedCapabilities: current.allowedCapabilities,
            testModel: current.testModel,
          })
          : current;
      });
      setServerKeyTotal(keysData.total ?? keysData.count);
      setApiKeyQuota(keysData.quota || null);
      syncServerKeyInstances(mergedApiKeys, {
        replaceMissing: !search && (keysData.total ?? keysData.count) <= keysData.apiKeys.length,
      });
      setCapabilities(capabilityData.capabilities);
      setCapabilityTotal(capabilityData.total ?? capabilityData.count);
      setCapabilityPresets(presetData.presets);

      if (Object.keys(capabilityForm.capabilities).length === 0 && capabilityData.capabilities[0]) {
        const first = capabilityData.capabilities[0];
        setCapabilityForm({
          providerId: first.providerId,
          modelPattern: first.modelPattern,
          capabilities: { ...first.capabilities },
        });
      }
    } catch (err) {
      setError(toErrorMessage(err, '加载服务端配置失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void loadServerData();
    // loadServerData intentionally reads the latest form state only on panel open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, setDeploymentMode, syncServerKeyInstances]);

  useEffect(() => {
    if (!isOpen || tab === 'local') return;
    const timer = window.setTimeout(() => {
      void loadServerData();
    }, 250);
    return () => window.clearTimeout(timer);
    // loadServerData intentionally reads the latest search query after debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, searchQuery, tab]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 1800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const loadMoreServerKeys = async () => {
    setLoadingMoreServerKeys(true);
    setError('');
    try {
      const data = await proxyListApiKeys({
        limit: SERVER_KEY_PAGE_SIZE,
        offset: serverKeys.length,
        search: searchQuery.trim(),
        keyScope: apiKeyQueryScope,
      });
      setServerKeys((current) => {
        const currentKeyById = new Map(current.map((key) => [key.id, key]));
        const mergedApiKeys = data.apiKeys.map((key) => mergeApiKeyFromServer(key, currentKeyById.get(key.id)));
        return mergeById(current, mergedApiKeys);
      });
      setServerKeyTotal(data.total ?? data.count);
      setApiKeyQuota(data.quota || null);
      syncServerKeyInstances(data.apiKeys);
    } catch (err) {
      setError(toErrorMessage(err, `更多${keyPanelLabel}加载失败`));
    } finally {
      setLoadingMoreServerKeys(false);
    }
  };

  const loadMoreCapabilities = async () => {
    setLoadingMoreCapabilities(true);
    setError('');
    try {
      const data = await proxyListModelCapabilities({
        limit: CAPABILITY_PAGE_SIZE,
        offset: capabilities.length,
        search: searchQuery.trim(),
      });
      setCapabilities((current) => mergeById(current, data.capabilities));
      setCapabilityTotal(data.total ?? data.count);
    } catch (err) {
      setError(toErrorMessage(err, '更多模型能力加载失败'));
    } finally {
      setLoadingMoreCapabilities(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setTab(normalizeTab(initialTab));
  }, [initialTab, isOpen, normalizeTab]);

  useEffect(() => {
    if (!visibleTabs.includes(tab)) {
      setTab(normalizeTab(tab));
    }
  }, [normalizeTab, tab, visibleTabs]);

  const switchTab = (nextTab: ApiManagerTab) => {
    if (!visibleTabs.includes(nextTab)) {
      setTab(normalizeTab(nextTab));
      return;
    }
    if (isServerMode && nextTab === 'local') {
      setTab('server');
      setError('服务器模式只使用后端托管 Key。本地浏览器 Key 已禁用。');
      return;
    }
    setTab(nextTab);
    setSearchQuery('');
    setError('');
    setShowKey(false);
    setKeyTestResult(null);
  };

  const startAddLocal = () => {
    if (isServerMode) {
      setError('服务器模式不能新增本地浏览器 Key。请使用后端 Key。');
      switchTab('server');
      return;
    }

    switchTab('local');
    setIsAddingLocal(true);
    setSelectedInstanceId(null);
    setLocalForm({ ...emptyLocalForm, models: getProviderDefaultModels('openai-compatible') });
  };

  const selectLocalInstance = (id: string) => {
    if (isServerMode) {
      setError('服务器模式不会读取本地浏览器 Key。请使用后端 Key。');
      switchTab('server');
      return;
    }

    const instance = instances[id];
    if (!instance) return;

    switchTab('local');
    setIsAddingLocal(false);
    setSelectedInstanceId(id);
    setLocalForm({
      name: instance.name,
      providerId: instance.providerId,
      apiKey: '',
      hasExistingKey: Boolean(instance.apiKey),
      baseUrl: instance.baseUrl || '',
      customHeaders: instance.customHeaders ? JSON.stringify(instance.customHeaders, null, 2) : '',
      models: [...instance.models],
      modelFetchMode: instance.modelFetchMode,
      isEnabled: instance.isEnabled,
    });
  };

  const saveLocalInstance = () => {
    if (isServerMode) {
      setError('服务器模式不会保存本地浏览器 Key。请使用后端 Key。');
      return;
    }

    if (!localForm.name || !localForm.providerId) {
      setError('请填写名称和 Provider。');
      return;
    }
    if (isAddingLocal && !localForm.apiKey) {
      setError('新增本地 API 时必须填写 API Key。');
      return;
    }

    let customHeaders: Record<string, string> | undefined;
    if (localForm.customHeaders.trim()) {
      try {
        customHeaders = JSON.parse(localForm.customHeaders) as Record<string, string>;
      } catch {
        setError('自定义 Headers 不是合法 JSON。');
        return;
      }
    }

    if (isAddingLocal) {
      addInstance({
        name: localForm.name,
        providerId: localForm.providerId,
        apiKey: localForm.apiKey,
        baseUrl: localForm.baseUrl || undefined,
        customHeaders,
        models: localForm.models,
        modelFetchMode: localForm.modelFetchMode,
        isEnabled: localForm.isEnabled,
      });
      setIsAddingLocal(false);
      setLocalForm(emptyLocalForm);
      setNotice('本地 API 已保存');
      return;
    }

    if (!selectedInstanceId) return;
    updateInstance(selectedInstanceId, {
      name: localForm.name,
      baseUrl: localForm.baseUrl || undefined,
      customHeaders,
      models: localForm.models,
      modelFetchMode: localForm.modelFetchMode,
      isEnabled: localForm.isEnabled,
      ...(localForm.apiKey ? { apiKey: localForm.apiKey } : {}),
    });
    setNotice('本地 API 已更新');
  };

  const fetchLocalModels = async () => {
    if (isServerMode) {
      setError('服务器模式请在后端 Key 里测试模型能力。');
      return;
    }
    if (!selectedInstanceId) {
      setError('请先保存本地 API，再自动获取模型。');
      return;
    }

    setModelLoading(true);
    setError('');
    const result = await fetchModelsList(selectedInstanceId);
    if (result.success) {
      setLocalForm((prev) => ({ ...prev, models: result.models }));
      setNotice(`获取到 ${result.models.length} 个模型`);
    } else {
      setError(result.error || '获取模型失败');
    }
    setModelLoading(false);
  };

  const selectServerKey = (key: ProxyApiKey) => {
    switchTab('server');
    setServerForm(apiKeyToServerForm(key, { testModel: serverForm.id === key.id ? serverForm.testModel : '' }));
    setKeyTestResult(null);
  };

  const updateServerForm = (patch: Partial<ServerKeyForm>) => {
    const nextForm = { ...serverForm, ...patch };
    setServerForm(nextForm);

    if (!autoSaveServerCapabilities) return;
    if (!patch.allowedCapabilities || !serverForm.id) return;
    if (!canManageApiKeyScope(serverForm.keyScope, canManageServerKeys)) return;

    setSavingCapabilities(true);
    setError('');
    void proxyUpdateApiKey(serverForm.id, {
      allowedCapabilities: patch.allowedCapabilities,
    })
      .then(({ apiKey }) => {
        const savedForm = apiKeyToServerForm(apiKey, nextForm);
        setServerKeys((current) => current.map((item) => item.id === apiKey.id ? apiKey : item));
        setServerForm((current) => current.id === apiKey.id ? { ...current, allowedCapabilities: savedForm.allowedCapabilities } : current);
        void loadServerData();
        setNotice('允许用途已自动保存');
      })
      .catch((err: unknown) => {
        setError(toErrorMessage(err, '保存允许用途失败'));
      })
      .finally(() => {
        setSavingCapabilities(false);
      });
  };

  const startAddServerKey = (keyScope?: 'user' | 'server') => {
    switchTab('server');
    const nextScope = adminServerKeysOnly ? 'server' : workbenchUserKeysOnly ? 'user' : keyScope || (canManageServerKeys ? 'server' : 'user');
    setServerForm({
      ...emptyServerForm,
      allowedCapabilities: serverAllowedCapabilitiesForForm(),
      keyScope: nextScope,
      models: [],
    });
    setKeyTestResult(null);
  };

  const saveServerKey = async () => {
    const effectiveKeyScope = adminServerKeysOnly ? 'server' : workbenchUserKeysOnly ? 'user' : serverForm.keyScope;
    if (!serverForm.name || !serverForm.providerId) {
      setError('请填写名称和 Provider。');
      return;
    }
    if (!serverForm.id && !serverForm.apiKey) {
      setError(`新增${keyPanelLabel}时必须填写 API Key。`);
      return;
    }
    if (!canManageApiKeyScope(effectiveKeyScope, canManageServerKeys)) {
      setError('只有管理员可以创建或修改服务器共享 Key。普通用户请保存自定义 Key。');
      return;
    }

    setLoading(true);
    setError('');
    try {
      let savedKey: ProxyApiKey;
      if (serverForm.id) {
        const data = await proxyUpdateApiKey(serverForm.id, {
          name: serverForm.name,
          providerId: serverForm.providerId,
          baseUrl: serverForm.baseUrl,
          models: serverForm.models,
          allowedCapabilities: serverForm.allowedCapabilities,
          isEnabled: serverForm.isEnabled,
          ...(serverForm.apiKey ? { apiKey: serverForm.apiKey } : {}),
        });
        savedKey = data.apiKey;
      } else {
        const data = await proxySaveApiKey({
          keyScope: effectiveKeyScope,
          providerId: serverForm.providerId,
          name: serverForm.name,
          baseUrl: serverForm.baseUrl,
          apiKey: serverForm.apiKey,
          models: serverForm.models,
          allowedCapabilities: serverForm.allowedCapabilities,
          isEnabled: serverForm.isEnabled,
        });
        savedKey = data.apiKey;
      }

      const nextForm = apiKeyToServerForm(savedKey, serverForm);
      setServerKeys((current) => {
        const exists = current.some((item) => item.id === savedKey.id);
        return exists
          ? current.map((item) => item.id === savedKey.id ? savedKey : item)
          : [savedKey, ...current];
      });
      setServerForm(nextForm);
      await loadServerData(savedKey);
      setNotice(`${keyPanelLabel}已保存，可以继续测试模型能力`);
    } catch (err) {
      setError(toErrorMessage(err, `保存${keyPanelLabel}失败`));
    } finally {
      setLoading(false);
    }
  };

  const deleteServerKey = async (id: string) => {
    const target = serverKeys.find((key) => key.id === id);
    if (!window.confirm(`确定删除${keyPanelLabel}「${target?.name || target?.providerId || id}」吗？`)) return;

    setLoading(true);
    setError('');
    try {
      await proxyDeleteApiKey(id);
      removeInstance(`user:${id}`);
      removeInstance(`server:${id}`);
      await loadServerData();
      setServerForm(emptyServerForm);
      setNotice(`${keyPanelLabel}已删除`);
    } catch (err) {
      setError(toErrorMessage(err, `删除${keyPanelLabel}失败`));
    } finally {
      setLoading(false);
    }
  };

  const testServerKey = async (options: KeyTestOptions = {}) => {
    if (!serverForm.id) {
      setError(`请先保存${keyPanelLabel}，再测试。`);
      return;
    }

    setTestingKey(true);
    setError('');
    setKeyTestResult(null);
    try {
      const { result } = await proxyTestApiKey(serverForm.id, {
        providerId: serverForm.providerId,
        model: serverForm.testModel.trim() || undefined,
        ...options,
      });
      if (!serverForm.testModel.trim() && result.selectedModel) {
        setServerForm((prev) => ({ ...prev, testModel: result.selectedModel }));
      }
      setKeyTestResult(result);
      setNotice(options.testText || options.testImage || options.testVideo ? '能力检测完成' : '连接测试完成');
    } catch (err) {
      setError(toErrorMessage(err, 'Key 测试失败'));
    } finally {
      setTestingKey(false);
    }
  };

  const fetchServerModels = async () => {
    if (!serverForm.id) {
      setError(`请先保存${keyPanelLabel}，再获取模型列表。`);
      return;
    }

    setModelLoading(true);
    setError('');
    try {
      const { result } = await proxyTestApiKey(serverForm.id, {
        providerId: serverForm.providerId,
        model: serverForm.testModel.trim() || undefined,
      });
      const models = result.models.models.map((model) => model.id);
      setServerForm((current) => ({ ...current, models }));
      setKeyTestResult(result);
      setNotice(`获取到 ${models.length} 个模型，请保存 Key 后生效`);
    } catch (err) {
      setError(toErrorMessage(err, '获取服务器模型列表失败'));
    } finally {
      setModelLoading(false);
    }
  };

  const selectCapability = (item: ProxyModelCapabilities) => {
    switchTab('capabilities');
    setCapabilityForm({
      providerId: item.providerId,
      modelPattern: item.modelPattern,
      capabilities: { ...item.capabilities },
    });
  };

  const startAddCapability = () => {
    switchTab('capabilities');
    setCapabilityForm({
      providerId: 'openai-compatible',
      modelPattern: '*',
      capabilities: {},
    });
  };

  const applyCapabilityPreset = (presetId: string) => {
    const preset = capabilityPresets.find((item) => item.id === presetId);
    if (!preset) return;
    setCapabilityForm({
      providerId: preset.providerId,
      modelPattern: preset.modelPattern,
      capabilities: { ...preset.capabilities },
    });
    setNotice(`已套用模板：${preset.label}`);
  };

  const saveCapability = async () => {
    if (!capabilityForm.providerId || !capabilityForm.modelPattern) {
      setError('请填写 Provider 和模型匹配规则。');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await proxySaveModelCapabilities(capabilityForm);
      clearModelCapabilityCache();
      await loadServerData();
      setNotice('模型能力已保存');
    } catch (err) {
      setError(toErrorMessage(err, '保存模型能力失败'));
    } finally {
      setLoading(false);
    }
  };

  const serverKeyCount = serverKeyTotal || serverKeys.length;
  const capabilityCount = capabilityTotal || capabilities.length;
  const hasMoreServerKeys = serverKeys.length < serverKeyCount;
  const hasMoreCapabilities = capabilities.length < capabilityCount;

  if (!isOpen) return null;

  const content = (
    <>
        <div className="flex items-center justify-between border-b border-panel-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Key className="h-4 w-4 shrink-0 text-accent" />
            <h2 className="text-sm font-semibold text-white">
              {workbenchUserKeysOnly ? '我的 API' : adminServerKeysOnly ? '服务器 Key' : adminCapabilitiesOnly ? '模型能力' : 'API 与模型能力'}
            </h2>
            {authInfo && (
              <span className="rounded bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-300">
                {workbenchUserKeysOnly
                  ? '工作台：只管理个人 Key'
                  : adminServerKeysOnly
                    ? '管理员：平台托管 Key'
                    : isServerMode
                      ? '服务器模式：后端 Key 管理'
                      : '本地模式：支持临时 Key'}
              </span>
            )}
            {notice && <span className="truncate rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">{notice}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void loadServerData()} className="rounded p-1 text-gray-400 hover:bg-gray-700/50 hover:text-white" title="刷新">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
            {!isEmbedded && (
              <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-700/50 hover:text-white" title="关闭">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {error && <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300">{error}</div>}

        {visibleTabs.length > 1 && (
          <div className="flex border-b border-panel-border px-3 py-2">
            {visibleTabs.includes('local') && (
              <TabButton active={tab === 'local'} icon={Laptop} label="本地 Key" count={filteredInstances.length} onClick={() => switchTab('local')} />
            )}
            {visibleTabs.includes('server') && (
              <TabButton active={tab === 'server'} icon={Cloud} label={keyPanelLabel} count={serverKeyCount} onClick={() => switchTab('server')} />
            )}
            {visibleTabs.includes('capabilities') && (
              <TabButton active={tab === 'capabilities'} icon={ShieldCheck} label="模型能力" count={capabilityCount} onClick={() => switchTab('capabilities')} />
            )}
          </div>
          )}

        <div className="flex min-h-0 flex-1">
          <div className="flex w-80 flex-col border-r border-panel-border bg-canvas-bg/50">
            <div className="border-b border-panel-border p-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={tab === 'local' ? '搜索本地 API...' : tab === 'server' ? `搜索${keyPanelLabel}...` : '搜索模型能力...'}
                  className="w-full rounded-md border border-panel-border bg-panel-bg py-1.5 pl-8 pr-3 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
                />
              </div>
            </div>

            <div className="flex-1 overflow-auto p-3">
              {tab === 'local' && (
                <LocalList
                  groups={groupedInstances}
                  selectedId={selectedInstanceId}
                  onAdd={startAddLocal}
                  onSelect={selectLocalInstance}
                />
              )}
              {tab === 'server' && (
                <ServerKeyList
                  keys={serverKeys}
                  selectedId={serverForm.id}
                  total={serverKeyCount}
                  quota={apiKeyQuota}
                  canManageServerKeys={canManageServerKeys}
                  serverOnly={adminServerKeysOnly}
                  userOnly={workbenchUserKeysOnly}
                  loadingMore={loadingMoreServerKeys}
                  hasMore={hasMoreServerKeys}
                  onAdd={startAddServerKey}
                  onLoadMore={loadMoreServerKeys}
                  onSelect={selectServerKey}
                />
              )}
              {tab === 'capabilities' && (
                <CapabilityList
                  items={capabilities}
                  selected={`${capabilityForm.providerId}:${capabilityForm.modelPattern}`}
                  total={capabilityCount}
                  loadingMore={loadingMoreCapabilities}
                  hasMore={hasMoreCapabilities}
                  onAdd={startAddCapability}
                  onLoadMore={loadMoreCapabilities}
                  onSelect={selectCapability}
                />
              )}
            </div>
          </div>

          <div className="min-w-0 flex-1 overflow-auto p-4">
            {tab === 'local' && (
              isAddingLocal || selectedInstanceId ? (
                <LocalEditor
                  form={localForm}
                  isAdding={isAddingLocal}
                  showKey={showKey}
                  modelLoading={modelLoading}
                  onToggleKey={() => setShowKey(!showKey)}
                  onChange={(patch) => setLocalForm((prev) => ({ ...prev, ...patch }))}
                  onSave={saveLocalInstance}
                  onFetchModels={fetchLocalModels}
                  onAddModel={(model) => setLocalForm((prev) => ({ ...prev, models: prev.models.includes(model) ? prev.models : [...prev.models, model] }))}
                  onRemoveModel={(model) => setLocalForm((prev) => ({ ...prev, models: prev.models.filter((item) => item !== model) }))}
                  onDelete={() => {
                    if (!selectedInstanceId) return;
                    if (window.confirm('确定删除这个本地 API 实例吗？')) {
                      removeInstance(selectedInstanceId);
                      setSelectedInstanceId(null);
                      setLocalForm(emptyLocalForm);
                      setNotice('本地 API 已删除');
                    }
                  }}
                />
              ) : (
                <EmptyEditor icon={Laptop} title="选择或新增本地 API" description="本地 Key 只适合单机调试。服务器模式会隐藏这条路径。" />
              )
            )}

            {tab === 'server' && (
              <ServerKeyEditor
                form={serverForm}
                showKey={showKey}
                loading={loading}
                modelLoading={modelLoading}
                testing={testingKey}
                savingCapabilities={savingCapabilities}
                testResult={keyTestResult}
                canManageServerKeys={canManageServerKeys}
                serverOnly={adminServerKeysOnly}
                userOnly={workbenchUserKeysOnly}
                quota={apiKeyQuota}
                onToggleKey={() => setShowKey(!showKey)}
                onChange={updateServerForm}
                onSave={saveServerKey}
                onFetchModels={fetchServerModels}
                onAddModel={(model) => setServerForm((prev) => ({ ...prev, models: prev.models.includes(model) ? prev.models : [...prev.models, model] }))}
                onRemoveModel={(model) => setServerForm((prev) => ({ ...prev, models: prev.models.filter((item) => item !== model) }))}
                onTest={testServerKey}
                onDelete={() => serverForm.id && void deleteServerKey(serverForm.id)}
              />
            )}

            {tab === 'capabilities' && (
              <CapabilityEditor
                form={capabilityForm}
                presets={capabilityPresets}
                loading={loading}
                onChange={(patch) => setCapabilityForm((prev) => ({ ...prev, ...patch }))}
                onToggle={(key, value) => setCapabilityForm((prev) => ({
                  ...prev,
                  capabilities: { ...prev.capabilities, [key]: value },
                }))}
                onApplyPreset={applyCapabilityPreset}
                onSave={saveCapability}
              />
            )}
          </div>
        </div>
    </>
  );

  if (isEmbedded) {
    return (
      <section className="flex h-full min-h-[720px] flex-col overflow-hidden rounded-xl border border-panel-border bg-[#0c0f12]">
        {content}
      </section>
    );
  }

  return (
    <FloatingWindow contentClassName="h-[82vh] w-[980px] flex-col">
      {content}
    </FloatingWindow>
  );
}

function TabButton(props: {
  active: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  count: number;
  onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      onClick={props.onClick}
      className={cn(
        'mr-2 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors',
        props.active ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:bg-gray-700/40 hover:text-white'
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {props.label}
      <span className="rounded bg-black/20 px-1.5 py-0.5 text-[9px]">{props.count}</span>
    </button>
  );
}

function LocalList(props: {
  groups: Record<string, Array<{ id: string; name: string; providerId: string; isEnabled: boolean }>>;
  selectedId: string | null;
  onAdd: () => void;
  onSelect: (id: string) => void;
}) {
  const entries = Object.entries(props.groups);
  return (
    <section>
      <ListHeader title="本地浏览器 Key" onAdd={props.onAdd} />
      {entries.length === 0 ? (
        <EmptyList text="暂无本地 API。点击 + 添加。" />
      ) : (
        <div className="space-y-3">
          {entries.map(([category, items]) => (
            <div key={category}>
              <div className="mb-1 text-[10px] text-gray-500">{getCategoryLabel(category)}</div>
              <div className="space-y-1.5">
                {items.map((instance) => (
                  <button
                    key={instance.id}
                    onClick={() => props.onSelect(instance.id)}
                    className={cn(
                      'w-full rounded-lg border p-2.5 text-left transition-colors',
                      props.selectedId === instance.id ? 'border-accent bg-accent/10' : 'border-panel-border bg-panel-bg hover:border-gray-600'
                    )}
                  >
                    <div className="truncate text-xs font-medium text-white">{instance.name}</div>
                    <div className="mt-1 text-[10px] text-gray-500">
                      {instance.providerId} · {instance.isEnabled ? '启用' : '停用'}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ServerKeyList(props: {
  keys: ProxyApiKey[];
  selectedId: string;
  total: number;
  quota: ApiKeyQuotaSummary | null;
  canManageServerKeys: boolean;
  serverOnly: boolean;
  userOnly: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onAdd: (keyScope?: 'user' | 'server') => void;
  onLoadMore: () => void;
  onSelect: (key: ProxyApiKey) => void;
}) {
  const serverKeys = props.keys.filter((key) => key.keyScope === 'server');
  const customKeys = props.keys.filter((key) => key.keyScope !== 'server');
  const shownKeys = props.serverOnly ? serverKeys : props.userOnly ? customKeys : props.keys;
  const shownTotal = props.serverOnly
    ? props.total || serverKeys.length
    : props.userOnly
      ? props.total || customKeys.length
      : props.total;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[11px] font-semibold text-gray-400">
          {props.serverOnly ? '服务器 Key' : props.userOnly ? '我的 API' : '后端 Key'} {shownKeys.length}/{shownTotal}
        </h3>
        <p className="mt-1 text-[10px] leading-4 text-gray-600">
          {props.serverOnly
            ? '这里只维护平台统一托管的共享 Key。'
            : props.userOnly
              ? '这里只管理你自己的 API。平台模型由管理员发布，运行时扣积分。'
              : '服务器共享和自定义 Key 分开管理。'}
        </p>
      </div>
      {props.userOnly ? (
        <div className="space-y-3">
          <ServerKeySection
            title="我的 API"
            description="你自己添加的第三方 API Key。当前版本使用个人 Key 不扣平台积分。"
            emptyText="暂无我的 API。点击 + 添加。"
            keys={customKeys}
            selectedId={props.selectedId}
            onAdd={() => props.onAdd('user')}
            onSelect={props.onSelect}
          />
          {props.hasMore && (
            <LoadMoreButton loading={props.loadingMore} onClick={props.onLoadMore}>
              加载更多我的 API
            </LoadMoreButton>
          )}
        </div>
      ) : props.serverOnly ? (
        <div className="space-y-3">
          <ServerKeySection
            title="服务器共享 Key"
            description="管理员统一托管，普通用户工作流可按权限使用。"
            emptyText={props.canManageServerKeys ? '暂无服务器 Key。点击 + 添加服务器共享 Key。' : '暂无服务器 Key。'}
            keys={serverKeys}
            selectedId={props.selectedId}
            onAdd={props.canManageServerKeys ? () => props.onAdd('server') : undefined}
            onSelect={props.onSelect}
          />
          {props.hasMore && (
            <LoadMoreButton loading={props.loadingMore} onClick={props.onLoadMore}>
              加载更多服务器 Key
            </LoadMoreButton>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <ServerKeySection
            title="服务器"
            description="平台统一托管的共享 Key。"
            emptyText={props.canManageServerKeys ? '暂无服务器 Key。点击 + 添加服务器共享 Key。' : '暂无服务器 Key。'}
            keys={serverKeys}
            selectedId={props.selectedId}
            onAdd={props.canManageServerKeys ? () => props.onAdd('server') : undefined}
            onSelect={props.onSelect}
          />
          <ServerKeySection
            title="自定义"
            description="你自己添加的第三方 API Key。"
            emptyText="暂无自定义 Key。点击 + 添加自定义 Key。"
            keys={customKeys}
            selectedId={props.selectedId}
            onAdd={() => props.onAdd('user')}
            onSelect={props.onSelect}
          >
            <div className="mb-2 rounded-lg border border-panel-border bg-panel-bg px-2.5 py-2 text-[10px] leading-4 text-gray-500">
              {summarizeApiKeyQuota(props.quota)}
            </div>
          </ServerKeySection>
          {props.hasMore && (
            <LoadMoreButton loading={props.loadingMore} onClick={props.onLoadMore}>
              加载更多 Key
            </LoadMoreButton>
          )}
        </div>
      )}
    </section>
  );
}

function ServerKeySection({
  children,
  description,
  emptyText,
  keys,
  onAdd,
  onSelect,
  selectedId,
  title,
}: {
  children?: React.ReactNode;
  description: string;
  emptyText: string;
  keys: ProxyApiKey[];
  onAdd?: () => void;
  onSelect: (key: ProxyApiKey) => void;
  selectedId: string;
  title: string;
}) {
  return (
    <div className="rounded-xl border border-panel-border bg-canvas-bg/40 p-2.5">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h4 className="text-[11px] font-semibold text-gray-300">{title}</h4>
            <span className="rounded bg-panel-bg px-1.5 py-0.5 text-[9px] text-gray-500">{keys.length}</span>
          </div>
          <p className="mt-0.5 text-[10px] leading-4 text-gray-600">{description}</p>
        </div>
        {onAdd && (
          <button onClick={onAdd} className="rounded p-1 text-gray-400 hover:bg-gray-700/50 hover:text-white" title={`新增${title} Key`}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {children}
      {keys.length === 0 ? (
        <EmptyList text={emptyText} />
      ) : (
        <div className="space-y-1.5">
          {keys.map((key) => (
            <ServerKeyItem key={key.id} item={key} selected={selectedId === key.id} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function ServerKeyItem({
  item,
  onSelect,
  selected,
}: {
  item: ProxyApiKey;
  onSelect: (key: ProxyApiKey) => void;
  selected: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(item)}
      className={cn(
        'w-full rounded-lg border p-2.5 text-left transition-colors',
        selected ? 'border-accent bg-accent/10' : 'border-panel-border bg-panel-bg hover:border-gray-600'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-xs font-medium text-white">{item.name || item.providerId}</span>
        <span className={cn(
          'ml-auto rounded px-1.5 py-0.5 text-[9px]',
          item.keyScope === 'server' ? 'bg-blue-500/10 text-blue-300' : 'bg-emerald-500/10 text-emerald-300'
        )}
        >
          {apiKeyScopeUiLabel(item.keyScope)}
        </span>
      </div>
      <div className="mt-1 text-[10px] text-gray-500">
        {item.providerId} · {item.isEnabled ? '启用' : '停用'}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] text-accent">
          {summarizeAllowedCapabilities(item.allowedCapabilities)}
        </span>
        {Boolean(item.models?.length) && (
          <span className="rounded bg-panel-bg px-1.5 py-0.5 text-[9px] text-gray-400">
            {item.models?.length} 个模型
          </span>
        )}
      </div>
    </button>
  );
}

function CapabilityList(props: {
  items: ProxyModelCapabilities[];
  selected: string;
  total: number;
  loadingMore: boolean;
  hasMore: boolean;
  onAdd: () => void;
  onLoadMore: () => void;
  onSelect: (item: ProxyModelCapabilities) => void;
}) {
  return (
    <section>
      <ListHeader title={`模型能力规则 ${props.items.length}/${props.total}`} onAdd={props.onAdd} />
      {props.items.length === 0 ? (
        <EmptyList text="暂无能力规则。点击 + 添加。" />
      ) : (
        <div className="space-y-1.5">
          {props.items.map((item) => {
            const id = `${item.providerId}:${item.modelPattern}`;
            return (
              <button
                key={item.id}
                onClick={() => props.onSelect(item)}
                className={cn(
                  'w-full rounded-lg border p-2.5 text-left transition-colors',
                  props.selected === id ? 'border-accent bg-accent/10' : 'border-panel-border bg-panel-bg hover:border-gray-600'
                )}
              >
                <div className="truncate text-xs font-medium text-white">
                  {item.providerId} / {item.modelPattern}
                </div>
                <div className="mt-1 line-clamp-1 text-[10px] text-gray-500">{capabilitySummary(item)}</div>
              </button>
            );
          })}
          {props.hasMore && (
            <LoadMoreButton loading={props.loadingMore} onClick={props.onLoadMore}>
              加载更多规则
            </LoadMoreButton>
          )}
        </div>
      )}
    </section>
  );
}

function LoadMoreButton({ children, loading, onClick }: { children: React.ReactNode; loading: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-panel-border px-3 py-2 text-[11px] text-gray-300 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading && <Loader2 className="h-3 w-3 animate-spin" />}
      {loading ? '加载中...' : children}
    </button>
  );
}

function ListHeader({ title, onAdd }: { title: string; onAdd: () => void }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-[11px] font-semibold text-gray-400">{title}</h3>
      <button onClick={onAdd} className="rounded p-1 text-gray-400 hover:bg-gray-700/50 hover:text-white" title="新增">
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function EmptyList({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-panel-border p-3 text-[11px] text-gray-500">{text}</div>;
}

function EmptyEditor({ icon: Icon, title, description }: { icon: ComponentType<{ className?: string }>; title: string; description: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-gray-500">
      <Icon className="mb-3 h-12 w-12 opacity-30" />
      <div className="text-sm text-gray-300">{title}</div>
      <div className="mt-1 text-xs">{description}</div>
    </div>
  );
}

function PanelTitle({ icon: Icon, title, description }: { icon: ComponentType<{ className?: string }>; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-panel-border bg-canvas-bg/50 p-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
        <Icon className="h-4 w-4 text-accent" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-gray-500">{description}</p>
      </div>
    </div>
  );
}

function LocalEditor(props: {
  form: typeof emptyLocalForm;
  isAdding: boolean;
  showKey: boolean;
  modelLoading: boolean;
  onToggleKey: () => void;
  onChange: (patch: Partial<typeof emptyLocalForm>) => void;
  onSave: () => void;
  onFetchModels: () => void;
  onAddModel: (model: string) => void;
  onRemoveModel: (model: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-4">
      <PanelTitle
        icon={Laptop}
        title={props.isAdding ? '新增本地 API' : '编辑本地 API'}
        description="Key 只保存在当前浏览器内存里。适合单机调试，不适合多人服务器。"
      />
      <ApiBasicFields form={props.form} showKey={props.showKey} onToggleKey={props.onToggleKey} onChange={props.onChange} />
      <div>
        <label className="mb-1 block text-[10px] text-gray-500">自定义 Headers JSON</label>
        <textarea
          value={props.form.customHeaders}
          onChange={(event) => props.onChange({ customHeaders: event.target.value })}
          rows={3}
          className="w-full resize-none rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 font-mono text-xs text-white focus:border-accent focus:outline-none"
          placeholder='{"x-custom": "value"}'
        />
      </div>
      <ModelListEditor
        models={props.form.models}
        loading={props.modelLoading}
        onFetch={props.onFetchModels}
        onAdd={props.onAddModel}
        onRemove={props.onRemoveModel}
      />
      <SwitchRow label="启用这个 API 实例" checked={props.form.isEnabled} onChange={(value) => props.onChange({ isEnabled: value })} />
      <div className="flex gap-2">
        <PanelButton onClick={props.onSave} variant="primary" size="md" className="flex-1">
          <Save className="h-3.5 w-3.5" />
          保存本地配置
        </PanelButton>
        {!props.isAdding && (
          <button onClick={props.onDelete} className="rounded-md px-3 py-2 text-red-400 hover:bg-red-500/10" title="删除">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function ServerKeyEditor(props: {
  form: typeof emptyServerForm;
  showKey: boolean;
  loading: boolean;
  modelLoading: boolean;
  testing: boolean;
  savingCapabilities: boolean;
  testResult: ProxyApiKeyTestResult | null;
  canManageServerKeys: boolean;
  serverOnly: boolean;
  userOnly: boolean;
  quota: ApiKeyQuotaSummary | null;
  onToggleKey: () => void;
  onChange: (patch: Partial<typeof emptyServerForm>) => void;
  onSave: () => void;
  onFetchModels: () => void;
  onAddModel: (model: string) => void;
  onRemoveModel: (model: string) => void;
  onTest: (options?: KeyTestOptions) => void;
  onDelete: () => void;
}) {
  const effectiveKeyScope = props.userOnly ? 'user' : props.form.keyScope;
  const canManageCurrentKey = canManageApiKeyScope(effectiveKeyScope, props.canManageServerKeys);
  const isReadOnlyServerKey = effectiveKeyScope === 'server' && !props.canManageServerKeys;
  const currentKeyLabel = props.userOnly ? '我的 API' : apiKeyScopeUiLabel(props.form.keyScope);

  if (isReadOnlyServerKey) {
    return (
      <ReadOnlyServerKeyDetails
        form={props.form}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PanelTitle
        icon={Cloud}
        title={props.form.id ? `编辑${currentKeyLabel}` : props.userOnly ? '新增我的 API' : props.serverOnly ? '新增服务器共享 Key' : '新增后端 Key'}
        description={props.userOnly ? 'Key 会加密保存到后端，只属于当前账号。使用我的 API 时当前不扣平台积分。' : props.serverOnly ? 'Key 会加密保存到后端，由管理员统一托管给平台使用。' : 'Key 会加密保存到后端。自定义 Key 只属于当前账号，服务器共享 Key 由管理员统一托管。'}
      />
      {props.userOnly && (
        <div className="rounded-xl border border-panel-border bg-canvas-bg/50 p-3 text-[11px] leading-5 text-gray-500">
          {summarizeApiKeyQuota(props.quota)}
        </div>
      )}
      {!props.serverOnly && !props.userOnly && (
        <>
          <div className="rounded-xl border border-panel-border bg-canvas-bg/50 p-3 text-[11px] leading-5 text-gray-500">
            {summarizeApiKeyQuota(props.quota)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              disabled={!props.canManageServerKeys}
              onClick={() => props.onChange({ keyScope: 'server' })}
              className={cn(
                'rounded-lg border p-3 text-left',
                props.form.keyScope === 'server' ? 'border-accent bg-accent/10' : 'border-panel-border bg-panel-bg',
                !props.canManageServerKeys && 'cursor-not-allowed opacity-50'
              )}
            >
              <div className="text-xs font-medium text-white">服务器共享 Key</div>
              <div className="mt-1 text-[10px] text-gray-500">管理员统一托管，适合给朋友共用。</div>
            </button>
            <button
              onClick={() => props.onChange({ keyScope: 'user' })}
              className={cn('rounded-lg border p-3 text-left', props.form.keyScope === 'user' ? 'border-accent bg-accent/10' : 'border-panel-border bg-panel-bg')}
            >
              <div className="text-xs font-medium text-white">自定义 Key</div>
              <div className="mt-1 text-[10px] text-gray-500">登录用户自带，只自己可管理和使用。</div>
            </button>
          </div>
        </>
      )}
      <ApiBasicFields form={props.form} showKey={props.showKey} onToggleKey={props.onToggleKey} onChange={props.onChange} />
      <ModelListEditor
        models={props.form.models}
        loading={props.modelLoading}
        onFetch={props.onFetchModels}
        onAdd={props.onAddModel}
        onRemove={props.onRemoveModel}
      />
      <ApiKeyCapabilitySelector
        saving={props.savingCapabilities}
        value={props.form.allowedCapabilities}
        onChange={(allowedCapabilities) => props.onChange({ allowedCapabilities })}
      />
      <div className="rounded-xl border border-panel-border bg-canvas-bg/50 p-3">
        <label className="mb-1 block text-[10px] text-gray-500">测试模型</label>
        <input
          value={props.form.testModel}
          onChange={(event) => props.onChange({ testModel: event.target.value })}
          className="w-full rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
          placeholder="留空时使用模型列表第一个模型或厂商默认模型"
        />
        <p className="mt-1 text-[10px] leading-4 text-gray-500">
          不同模型限制不同。这里填具体模型名后，测试结果会按这个模型读取能力表。
        </p>
      </div>
      <SwitchRow
        label={`启用${currentKeyLabel}`}
        description={effectiveKeyScope === 'user' ? '关闭后，节点不会再使用这个个人 Key。' : '关闭后，普通用户不会再使用这个服务器 Key。'}
        checked={props.form.isEnabled}
        onChange={(value) => props.onChange({ isEnabled: value })}
      />
      <div className="flex flex-wrap gap-2">
        <PanelButton
          onClick={props.onSave}
          disabled={props.loading || !canManageCurrentKey}
          variant="primary"
          size="md"
          className="flex-1"
        >
          {props.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          保存{currentKeyLabel}
        </PanelButton>
        {props.form.id && (
          <PanelButton onClick={() => props.onTest()} disabled={props.testing} variant="secondary" size="md">
            {props.testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            测试连接
          </PanelButton>
        )}
        {props.form.id && (
          <PanelButton onClick={() => props.onTest({ testText: true })} disabled={props.testing} variant="secondary" size="md">
            文本测试
          </PanelButton>
        )}
        {props.form.id && (
          <PanelButton onClick={() => props.onTest({ testImage: true })} disabled={props.testing} variant="secondary" size="md">
            图片能力
          </PanelButton>
        )}
        {props.form.id && (
          <PanelButton onClick={() => props.onTest({ testVideo: true })} disabled={props.testing} variant="secondary" size="md">
            视频能力
          </PanelButton>
        )}
        {props.form.id && (
          <PanelButton
            onClick={() => props.onTest({ testText: true, testImage: true, testVideo: true })}
            disabled={props.testing}
            variant="primary"
            size="md"
            className="border-emerald-500/45 bg-emerald-500/15 text-emerald-100 hover:border-emerald-400/70 hover:bg-emerald-500/25"
          >
            全部能力
          </PanelButton>
        )}
        {props.form.id && canManageCurrentKey && (
          <PanelButton onClick={props.onDelete} variant="danger" size="md" title="删除">
            <Trash2 className="h-3.5 w-3.5" />
          </PanelButton>
        )}
      </div>
      {props.testResult && <ApiKeyTestSummary result={props.testResult} />}
    </div>
  );
}

function ReadOnlyServerKeyDetails({
  form,
}: {
  form: typeof emptyServerForm;
}) {
  const provider = getProviderTemplate(form.providerId);

  return (
    <div className="space-y-4">
      <PanelTitle
        icon={Cloud}
        title="服务器共享 Key"
        description="这个 Key 由管理员统一配置。当前账号只能查看和使用，不能编辑密钥。"
      />

      <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-3 text-xs leading-5 text-blue-100">
        服务器 Key 属于平台配置。请在管理员后台维护真实 Key，普通用户工作流运行时会自动使用可用的服务器 Key。
      </div>

      <div className="grid gap-3 rounded-xl border border-panel-border bg-canvas-bg/50 p-3">
        <ReadOnlyField label="名称" value={form.name || '未命名服务器 Key'} />
        <ReadOnlyField label="Provider" value={provider ? `${provider.name} - ${provider.description}` : form.providerId} />
        <ReadOnlyField label="Base URL" value={form.baseUrl || provider?.defaultBaseUrl || '-'} />
        <ReadOnlyField label="状态" value={form.isEnabled ? '启用' : '停用'} />
        <ReadOnlyField label="允许用途" value={summarizeAllowedCapabilities(form.allowedCapabilities)} />
        <ReadOnlyField label="模型数量" value={form.models.length ? `${form.models.length} 个模型` : '未保存模型列表'} />
        <ReadOnlyField label="API Key" value="由管理员加密托管，普通用户不可查看或修改" />
      </div>

      <div className="rounded-xl border border-panel-border bg-canvas-bg/50 p-3 text-[11px] leading-5 text-gray-500">
        连接测试、密钥更新和启停操作需要管理员权限。你可以在工作流节点里直接选择平台模型使用。
      </div>
    </div>
  );
}

function ApiKeyCapabilitySelector({
  onChange,
  saving,
  value,
}: {
  onChange: (value: ApiKeyAllowedCapabilities) => void;
  saving: boolean;
  value: ApiKeyAllowedCapabilities;
}) {
  return (
    <div className="rounded-xl border border-panel-border bg-canvas-bg/50 p-3">
      <div className="mb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-white">允许用途</div>
          {saving && <div className="text-[10px] text-emerald-300">保存中...</div>}
        </div>
        <div className="mt-1 text-[10px] leading-4 text-gray-500">
          用来限制这个 Key 可以被哪些工作流节点使用。比如只勾选“图片”，它就不会出现在文本节点里。
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {API_KEY_CAPABILITY_OPTIONS.map((item) => {
          const checked = Boolean(value[item.key]);
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={checked}
              disabled={saving}
              onClick={() => onChange({ ...value, [item.key]: !checked })}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-70',
                checked
                  ? 'border-emerald-400/80 bg-emerald-500/15 shadow-[0_0_0_1px_rgba(52,211,153,0.25)]'
                  : 'border-panel-border bg-panel-bg opacity-55 hover:border-gray-600 hover:opacity-100'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={cn('text-xs font-medium', checked ? 'text-emerald-100' : 'text-gray-400')}>{item.label}</span>
                <span className={cn('h-3 w-3 rounded-full border', checked ? 'border-emerald-200 bg-emerald-400' : 'border-gray-600 bg-transparent')} />
              </div>
              <div className={cn('mt-1 text-[10px] leading-4', checked ? 'text-emerald-100/70' : 'text-gray-600')}>{item.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] text-gray-500">{label}</div>
      <div className="rounded-md border border-panel-border bg-panel-bg px-2.5 py-2 text-xs text-gray-200">
        {value}
      </div>
    </div>
  );
}

function ApiKeyTestSummary({ result }: { result: ProxyApiKeyTestResult }) {
  const limitRows = summarizeApiKeyTestLimits(result.capabilities);
  const checks = summarizeApiKeyTestChecks(result);

  return (
    <div className="rounded-xl border border-panel-border bg-canvas-bg/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-white">测试结果</span>
        <span className="rounded bg-panel-bg px-2 py-0.5 text-[10px] text-gray-400">{result.selectedModel || result.providerId}</span>
      </div>
      <p className="mb-2 text-[10px] leading-4 text-gray-500">
        文本测试会发起一次极短对话请求。图片和视频默认只做能力表检测，避免误触付费生成。
      </p>
      <div className="grid grid-cols-2 gap-2">
        {checks.map((check) => (
          <div key={check.label} className="rounded-lg border border-panel-border bg-panel-bg p-2">
            <div className="flex items-center gap-1.5 text-xs text-gray-200">
              {check.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-400" />}
              {check.label}
            </div>
            <div className={cn(
              'mt-1 inline-flex rounded px-1.5 py-0.5 text-[9px]',
              check.tone === 'success' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'
            )}>
              {check.methodLabel}
            </div>
            <div className="mt-1 text-[10px] text-gray-500">{check.billingLabel}</div>
            {check.detail && <div className="mt-1 line-clamp-2 text-[10px] text-gray-400">{check.detail}</div>}
          </div>
        ))}
      </div>
      {result.models.models.length > 0 && (
        <div className="mt-3 rounded-lg border border-panel-border bg-panel-bg p-2">
          <div className="mb-1 text-[10px] font-medium text-gray-400">模型列表预览</div>
          <div className="flex max-h-20 flex-wrap gap-1 overflow-auto">
            {result.models.models.map((model) => (
              <span key={model.id} className="rounded bg-canvas-bg px-1.5 py-0.5 text-[9px] text-gray-300">
                {model.id}
              </span>
            ))}
          </div>
        </div>
      )}
      {limitRows.length > 0 && (
        <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2">
          <div className="mb-2 text-[10px] font-medium text-emerald-200">当前模型能力限制</div>
          <div className="grid grid-cols-2 gap-1.5">
            {limitRows.map((row) => (
              <div key={row.label} className="rounded bg-black/20 px-2 py-1">
                <div className="text-[9px] text-emerald-200/70">{row.label}</div>
                <div className="truncate text-[10px] text-emerald-100" title={row.value}>{row.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CapabilityEditor(props: {
  form: CapabilityForm;
  presets: ProxyModelCapabilityPreset[];
  loading: boolean;
  onChange: (patch: Partial<CapabilityForm>) => void;
  onToggle: (key: string, value: boolean) => void;
  onApplyPreset: (presetId: string) => void;
  onSave: () => void;
}) {
  const [jsonError, setJsonError] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [capabilitiesJson, setCapabilitiesJson] = useState(() => JSON.stringify(props.form.capabilities, null, 2));
  const selectedPreset = useMemo(
    () => props.presets.find((preset) => preset.id === selectedPresetId),
    [props.presets, selectedPresetId]
  );
  const groupedPresets = useMemo(
    () => groupModelCapabilityPresetsByProvider(props.presets, props.form.providerId),
    [props.presets, props.form.providerId]
  );
  const selectedPresetRows = useMemo(
    () => selectedPreset ? summarizeModelCapabilityPresetPreview(selectedPreset) : [],
    [selectedPreset]
  );

  useEffect(() => {
    setCapabilitiesJson(JSON.stringify(props.form.capabilities, null, 2));
    setJsonError('');
  }, [props.form.providerId, props.form.modelPattern, props.form.capabilities]);

  useEffect(() => {
    if (selectedPresetId && !props.presets.some((preset) => preset.id === selectedPresetId)) {
      setSelectedPresetId('');
    }
  }, [props.presets, selectedPresetId]);

  const updateCapabilitiesJson = (value: string) => {
    setCapabilitiesJson(value);
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      props.onChange({ capabilities: parsed });
      setJsonError('');
    } catch (err) {
      setJsonError(toErrorMessage(err, 'JSON 格式不正确'));
    }
  };

  const imageCapabilities = asRecord(props.form.capabilities.image);
  const videoCapabilities = asRecord(props.form.capabilities.video);

  const updateNestedCapability = (section: 'image' | 'video', patch: Record<string, unknown>) => {
    props.onChange({
      capabilities: {
        ...props.form.capabilities,
        [section]: {
          ...asRecord(props.form.capabilities[section]),
          ...patch,
        },
      },
    });
  };

  return (
    <div className="space-y-4">
      <PanelTitle
        icon={ShieldCheck}
        title="模型能力适配"
        description="节点会根据能力表显示限制并发送参数。不支持的能力会被忽略，或在执行前阻止。"
      />
      <div className="rounded-xl border border-panel-border bg-canvas-bg/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-white">能力模板</div>
            <div className="mt-1 text-[10px] text-gray-500">从厂商文档维护的预设开始，再按实际模型微调。</div>
          </div>
          <span className="rounded bg-panel-bg px-2 py-0.5 text-[10px] text-gray-500">{props.presets.length} 个模板</span>
        </div>
        <PresetSelect
          groupedPresets={groupedPresets}
          value={selectedPresetId}
          onChange={setSelectedPresetId}
        />
        {selectedPreset && (
          <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-emerald-100">{selectedPreset.label}</div>
                <div className="mt-1 text-[10px] leading-4 text-emerald-100/70">{selectedPreset.description || '这个模板没有额外说明。'}</div>
                <div className="mt-1 text-[10px] text-emerald-100/50">
                  {selectedPreset.providerId} / {selectedPreset.modelPattern}
                </div>
              </div>
              <button
                type="button"
                onClick={() => props.onApplyPreset(selectedPreset.id)}
                className="shrink-0 rounded-md bg-emerald-500/20 px-2.5 py-1.5 text-[10px] font-medium text-emerald-100 hover:bg-emerald-500/30"
              >
                套用模板
              </button>
            </div>
            {selectedPresetRows.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {selectedPresetRows.map((row) => (
                  <div key={row.label} className="rounded bg-black/20 px-2 py-1">
                    <div className="text-[9px] text-emerald-200/70">{row.label}</div>
                    <div className="truncate text-[10px] text-emerald-100" title={row.value}>{row.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {props.presets.length === 0 && (
          <div className="mt-2 text-[10px] text-gray-500">暂无模板。你仍然可以手动维护下方 JSON。</div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[10px] text-gray-500">Provider</label>
          <ProviderSelect
            value={props.form.providerId}
            onChange={(providerId) => props.onChange({ providerId })}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-gray-500">模型匹配</label>
          <input value={props.form.modelPattern} onChange={(event) => props.onChange({ modelPattern: event.target.value })} className="w-full rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none" placeholder="gpt-image-* 或 *" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {capabilityKeys.map(([key, label]) => (
          <SwitchRow key={key} label={label} checked={Boolean(props.form.capabilities[key])} onChange={(value) => props.onToggle(key, value)} />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-panel-border bg-canvas-bg/50 p-3">
          <div>
            <div className="text-xs font-semibold text-white">图片常用限制</div>
            <div className="mt-1 text-[10px] text-gray-500">用于图片生成节点的数量、尺寸和参考图判断。</div>
          </div>
          <SmallInput
            label="最多生成张数"
            type="number"
            value={String(imageCapabilities.maxImages ?? '')}
            onChange={(value) => updateNestedCapability('image', { maxImages: numberOrUndefined(value) })}
            placeholder="例如 4"
          />
          <SmallInput
            label="最多参考图"
            type="number"
            value={String(imageCapabilities.maxReferenceImages ?? '')}
            onChange={(value) => updateNestedCapability('image', { maxReferenceImages: numberOrUndefined(value) })}
            placeholder="例如 2"
          />
          <SmallInput
            label="尺寸别名"
            value={listToInput(imageCapabilities.sizeAliases)}
            onChange={(value) => updateNestedCapability('image', { sizeAliases: inputToList(value) })}
            placeholder="1K, 2K, 4K"
          />
          <SmallInput
            label="固定尺寸"
            value={listToInput(imageCapabilities.sizes)}
            onChange={(value) => updateNestedCapability('image', { sizes: inputToList(value) })}
            placeholder="1024x1024, 1792x1024"
          />
          <div className="grid grid-cols-2 gap-2">
            <SmallInput
              label="最小像素"
              type="number"
              value={String(imageCapabilities.minPixels ?? '')}
              onChange={(value) => updateNestedCapability('image', { minPixels: numberOrUndefined(value) })}
              placeholder="例如 1024"
            />
            <SmallInput
              label="最大像素"
              type="number"
              value={String(imageCapabilities.maxPixels ?? '')}
              onChange={(value) => updateNestedCapability('image', { maxPixels: numberOrUndefined(value) })}
              placeholder="例如 16777216"
            />
            <SmallInput
              label="最小宽高比"
              value={String(imageCapabilities.minAspectRatio ?? '')}
              onChange={(value) => updateNestedCapability('image', { minAspectRatio: parseOptionalRatioInput(value) })}
              placeholder="1:8 或 0.125"
            />
            <SmallInput
              label="最大宽高比"
              value={String(imageCapabilities.maxAspectRatio ?? '')}
              onChange={(value) => updateNestedCapability('image', { maxAspectRatio: parseOptionalRatioInput(value) })}
              placeholder="8:1 或 8"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SwitchRow label="水印参数" checked={Boolean(imageCapabilities.supportsWatermark)} onChange={(value) => updateNestedCapability('image', { supportsWatermark: value })} />
            <SwitchRow label="组图连续性" checked={Boolean(imageCapabilities.supportsSequential)} onChange={(value) => updateNestedCapability('image', { supportsSequential: value })} />
            <SwitchRow label="思考模式" checked={Boolean(imageCapabilities.supportsThinkingMode)} onChange={(value) => updateNestedCapability('image', { supportsThinkingMode: value })} />
            <SwitchRow label="提示词改写" checked={Boolean(imageCapabilities.supportsPromptExtend)} onChange={(value) => updateNestedCapability('image', { supportsPromptExtend: value })} />
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-panel-border bg-canvas-bg/50 p-3">
          <div>
            <div className="text-xs font-semibold text-white">视频常用限制</div>
            <div className="mt-1 text-[10px] text-gray-500">用于视频节点的时长、参考素材、比例和分辨率判断。</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SmallInput
              label="最短时长"
              type="number"
              value={String(videoCapabilities.durationMin ?? '')}
              onChange={(value) => updateNestedCapability('video', { durationMin: numberOrUndefined(value) })}
              placeholder="例如 4"
            />
            <SmallInput
              label="最长时长"
              type="number"
              value={String(videoCapabilities.durationMax ?? '')}
              onChange={(value) => updateNestedCapability('video', { durationMax: numberOrUndefined(value) })}
              placeholder="例如 15"
            />
          </div>
          <SmallInput
            label="最多参考图"
            type="number"
            value={String(videoCapabilities.maxReferenceImages ?? '')}
            onChange={(value) => updateNestedCapability('video', { maxReferenceImages: numberOrUndefined(value) })}
            placeholder="例如 2"
          />
          <div className="grid grid-cols-2 gap-2">
            <SmallInput
              label="最多参考视频"
              type="number"
              value={String(videoCapabilities.maxReferenceVideos ?? '')}
              onChange={(value) => updateNestedCapability('video', { maxReferenceVideos: numberOrUndefined(value) })}
              placeholder="例如 1"
            />
            <SmallInput
              label="最多参考音频"
              type="number"
              value={String(videoCapabilities.maxReferenceAudios ?? '')}
              onChange={(value) => updateNestedCapability('video', { maxReferenceAudios: numberOrUndefined(value) })}
              placeholder="例如 1"
            />
          </div>
          <SmallInput
            label="支持比例"
            value={listToInput(videoCapabilities.ratios)}
            onChange={(value) => updateNestedCapability('video', { ratios: inputToList(value) })}
            placeholder="16:9, 9:16, 1:1"
          />
          <SmallInput
            label="支持分辨率"
            value={listToInput(videoCapabilities.resolutions)}
            onChange={(value) => updateNestedCapability('video', { resolutions: inputToList(value) })}
            placeholder="480P, 720P, 1080P"
          />
          <SmallInput
            label="支持模式"
            value={listToInput(videoCapabilities.modes)}
            onChange={(value) => updateNestedCapability('video', { modes: inputToList(value) })}
            placeholder="text-to-video, image-to-video, images-to-video"
          />
          <div className="grid grid-cols-3 gap-2">
            <SmallInput
              label="FPS"
              type="number"
              value={String(videoCapabilities.fps ?? '')}
              onChange={(value) => updateNestedCapability('video', { fps: numberOrUndefined(value) })}
              placeholder="24"
            />
            <SmallInput
              label="并发"
              type="number"
              value={String(videoCapabilities.concurrency ?? '')}
              onChange={(value) => updateNestedCapability('video', { concurrency: numberOrUndefined(value) })}
              placeholder="3"
            />
            <SmallInput
              label="RPM"
              type="number"
              value={String(videoCapabilities.rpm ?? '')}
              onChange={(value) => updateNestedCapability('video', { rpm: numberOrUndefined(value) })}
              placeholder="180"
            />
          </div>
          <SmallInput
            label="任务类型"
            value={listToInput(videoCapabilities.taskTypes)}
            onChange={(value) => updateNestedCapability('video', { taskTypes: inputToList(value) })}
            placeholder="text2video, image2video"
          />
          <SmallInput
            label="媒体类型"
            value={listToInput(videoCapabilities.mediaTypes)}
            onChange={(value) => updateNestedCapability('video', { mediaTypes: inputToList(value) })}
            placeholder="image, video, audio"
          />
          <div className="grid grid-cols-2 gap-2">
            <SwitchRow label="参考图" checked={Boolean(videoCapabilities.supportsReferenceImage)} onChange={(value) => updateNestedCapability('video', { supportsReferenceImage: value })} />
            <SwitchRow label="参考视频" checked={Boolean(videoCapabilities.supportsReferenceVideo)} onChange={(value) => updateNestedCapability('video', { supportsReferenceVideo: value })} />
            <SwitchRow label="参考音频" checked={Boolean(videoCapabilities.supportsReferenceAudio)} onChange={(value) => updateNestedCapability('video', { supportsReferenceAudio: value })} />
            <SwitchRow label="生成音频" checked={Boolean(videoCapabilities.supportsAudioGeneration)} onChange={(value) => updateNestedCapability('video', { supportsAudioGeneration: value })} />
            <SwitchRow label="反向词" checked={Boolean(videoCapabilities.supportsNegativePrompt)} onChange={(value) => updateNestedCapability('video', { supportsNegativePrompt: value })} />
            <SwitchRow label="Seed" checked={Boolean(videoCapabilities.supportsSeed)} onChange={(value) => updateNestedCapability('video', { supportsSeed: value })} />
            <SwitchRow label="智能改写" checked={Boolean(videoCapabilities.supportsPromptExtend)} onChange={(value) => updateNestedCapability('video', { supportsPromptExtend: value })} />
            <SwitchRow label="水印" checked={Boolean(videoCapabilities.supportsWatermark)} onChange={(value) => updateNestedCapability('video', { supportsWatermark: value })} />
          </div>
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-[10px] text-gray-500">高级能力 JSON</label>
          {jsonError && <span className="text-[10px] text-red-400">{jsonError}</span>}
        </div>
        <textarea
          value={capabilitiesJson}
          onChange={(event) => updateCapabilitiesJson(event.target.value)}
          rows={14}
          className="w-full resize-y rounded-md border border-panel-border bg-panel-bg px-2.5 py-2 font-mono text-[11px] leading-5 text-gray-200 focus:border-accent focus:outline-none"
          spellCheck={false}
        />
        <p className="mt-1 text-[10px] leading-4 text-gray-500">
          不常用或厂商专属字段仍可写在 JSON 内。常用限制建议优先用上方表单维护，减少字段名写错。
        </p>
      </div>
      <PanelButton onClick={props.onSave} disabled={props.loading || Boolean(jsonError)} variant="primary" size="md" className="w-full">
        {props.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        保存模型能力
      </PanelButton>
    </div>
  );
}

function ApiBasicFields(props: {
  form: BasicApiForm;
  showKey: boolean;
  onToggleKey: () => void;
  onChange: (patch: Partial<BasicApiForm>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[10px] text-gray-500">名称</label>
        <input value={props.form.name} onChange={(event) => props.onChange({ name: event.target.value })} className="w-full rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none" placeholder="例如：我的 OneAPI" />
      </div>
      <div>
        <label className="mb-1 block text-[10px] text-gray-500">Provider</label>
        <ProviderSelect
          showDescription
          value={props.form.providerId}
          onChange={(providerId) => props.onChange({ providerId })}
        />
      </div>
      <div>
        <label className="mb-1 block text-[10px] text-gray-500">Base URL</label>
        <input value={props.form.baseUrl} onChange={(event) => props.onChange({ baseUrl: event.target.value })} className="w-full rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none" placeholder={getProviderTemplate(props.form.providerId)?.defaultBaseUrl || 'https://...'} />
      </div>
      <div>
        <label className="mb-1 block text-[10px] text-gray-500">
          API Key {props.form.hasExistingKey && <span className="text-emerald-400">（已保存，留空表示不修改）</span>}
        </label>
        <div className="relative">
          <input
            type={props.showKey ? 'text' : 'password'}
            value={props.form.apiKey}
            onChange={(event) => props.onChange({ apiKey: event.target.value })}
            className="w-full rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 pr-10 text-xs text-white focus:border-accent focus:outline-none"
            placeholder={props.form.hasExistingKey ? '输入新 Key 才会覆盖' : 'sk-...'}
          />
          <button onClick={props.onToggleKey} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white" title={props.showKey ? '隐藏 Key' : '显示 Key'}>
            {props.showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProviderSelect({
  onChange,
  showDescription = false,
  value,
}: {
  onChange: (value: string) => void;
  showDescription?: boolean;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedProvider = getProviderTemplate(value) || PROVIDER_TEMPLATES.find((provider) => provider.id === value);
  const selectedLabel = selectedProvider
    ? showDescription
      ? `${selectedProvider.name} - ${selectedProvider.description}`
      : selectedProvider.name
    : value || '选择 Provider';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex min-h-[34px] w-full items-center gap-2 rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-left text-xs text-white transition-colors',
          open ? 'border-accent' : 'hover:border-gray-600'
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-64 overflow-auto rounded-lg border border-panel-border bg-[#0c0f12] p-1.5 shadow-2xl">
          {PROVIDER_TEMPLATES.map((provider) => {
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => {
                  onChange(provider.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full flex-col rounded-md px-2.5 py-2 text-left transition-colors hover:bg-[#151a20]',
                  provider.id === value && 'bg-accent/10 text-accent'
                )}
              >
                <span className="text-xs font-medium">{provider.name}</span>
                {showDescription && <span className="mt-0.5 line-clamp-2 text-[10px] text-gray-500">{provider.description}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PresetSelect({
  groupedPresets,
  onChange,
  value,
}: {
  groupedPresets: ReturnType<typeof groupModelCapabilityPresetsByProvider>;
  onChange: (value: string) => void;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const allPresets = [...groupedPresets.matching, ...groupedPresets.others];
  const selectedPreset = allPresets.find((preset) => preset.id === value);
  const selectedLabel = selectedPreset
    ? `${selectedPreset.label} - ${selectedPreset.modelPattern}`
    : '选择一个模板查看...';

  const renderPreset = (preset: ProxyModelCapabilityPreset, showProvider: boolean) => (
    <button
      key={preset.id}
      type="button"
      onClick={() => {
        onChange(preset.id);
        setOpen(false);
      }}
      className={cn(
        'flex w-full flex-col rounded-md px-2.5 py-2 text-left transition-colors hover:bg-[#151a20]',
        preset.id === value && 'bg-accent/10 text-accent'
      )}
    >
      <span className="text-xs font-medium">{preset.label}</span>
      <span className="mt-0.5 text-[10px] text-gray-500">
        {showProvider ? `${preset.providerId} / ${preset.modelPattern}` : preset.modelPattern}
      </span>
    </button>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex min-h-[34px] w-full items-center gap-2 rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-left text-xs text-white transition-colors',
          open ? 'border-accent' : 'hover:border-gray-600'
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-72 overflow-auto rounded-lg border border-panel-border bg-[#0c0f12] p-1.5 shadow-2xl">
          <button
            type="button"
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
            className={cn(
              'flex w-full rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-[#151a20]',
              !value && 'bg-accent/10 text-accent'
            )}
          >
            选择一个模板查看...
          </button>

          {groupedPresets.matching.length > 0 && (
            <div className="mt-1">
              <div className="px-2.5 py-1 text-[10px] font-medium text-gray-500">当前 Provider 模板</div>
              <div className="space-y-1">{groupedPresets.matching.map((preset) => renderPreset(preset, false))}</div>
            </div>
          )}

          {groupedPresets.others.length > 0 && (
            <div className="mt-1 border-t border-panel-border pt-1">
              <div className="px-2.5 py-1 text-[10px] font-medium text-gray-500">其他 Provider 模板</div>
              <div className="space-y-1">{groupedPresets.others.map((preset) => renderPreset(preset, true))}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModelListEditor(props: {
  models: string[];
  loading: boolean;
  onFetch: () => void;
  onAdd: (model: string) => void;
  onRemove: (model: string) => void;
}) {
  const [newModel, setNewModel] = useState('');

  const addModel = () => {
    const model = newModel.trim();
    if (!model) return;
    props.onAdd(model);
    setNewModel('');
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-gray-500">模型列表</label>
        <div className="flex gap-2">
          <button onClick={props.onFetch} className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-accent hover:bg-accent/10">
            {props.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            自动获取
          </button>
        </div>
      </div>
      <div className="flex gap-2">
        <input
          value={newModel}
          onChange={(event) => setNewModel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addModel();
          }}
          className="min-w-0 flex-1 rounded-md border border-panel-border bg-canvas-bg px-2.5 py-1.5 text-[10px] text-white placeholder-gray-600 focus:border-accent focus:outline-none"
          placeholder="输入模型名称，例如 gpt-4o"
        />
        <button
          type="button"
          onClick={addModel}
          disabled={!newModel.trim()}
          className="inline-flex items-center gap-1 rounded-md border border-panel-border px-2.5 py-1.5 text-[10px] text-gray-300 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          添加
        </button>
      </div>
      <div className="flex max-h-36 flex-wrap gap-1.5 overflow-auto rounded-lg border border-panel-border bg-canvas-bg/40 p-2">
        {props.models.length === 0 ? (
          <span className="text-[10px] text-gray-600">暂无模型</span>
        ) : (
          props.models.map((model) => (
            <span key={model} className="flex items-center gap-1 rounded bg-panel-bg px-2 py-1 text-[10px] text-gray-300">
              <Zap className="h-3 w-3 text-accent" />
              {model}
              <button onClick={() => props.onRemove(model)} className="text-gray-500 hover:text-red-400" title="移除">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function SwitchRow({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description?: string;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-panel-border bg-panel-bg px-3 py-2.5 text-left transition-colors hover:border-gray-600"
    >
      <span className="min-w-0">
        <span className="block text-xs font-medium text-gray-200">{label}</span>
        {description && <span className="mt-0.5 block text-[10px] leading-4 text-gray-500">{description}</span>}
      </span>
      <span
        className={cn(
          'relative h-[22px] w-[42px] shrink-0 rounded-full border transition-colors',
          checked ? 'border-accent bg-accent' : 'border-[#303b49] bg-[#1a222c]'
        )}
      >
        <span className={cn('absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-[20px]' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}

function SmallInput({
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
