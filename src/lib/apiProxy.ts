import type { NodeType } from '../types/nodes';

type ViteLikeEnv = Record<string, unknown>;

const viteEnv = (import.meta as ImportMeta & { env?: ViteLikeEnv }).env || {};
const MISSING_PRODUCTION_PROXY_URL_MESSAGE = 'VITE_PROXY_URL is required for production frontend builds. Use VITE_PROXY_URL=/ only when same-origin deployment is intentional.';

function envString(env: ViteLikeEnv, key: string): string {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function envFlag(env: ViteLikeEnv, key: string): boolean {
  const value = env[key];
  return value === true || value === 'true';
}

function normalizeProxyUrl(value: string): { baseUrl: string; sameOrigin: boolean } {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return { baseUrl: '', sameOrigin: true };
  return { baseUrl: trimmed.replace(/\/+$/, ''), sameOrigin: false };
}

export function resolveWorkbenchProxyUrl(env: ViteLikeEnv = viteEnv): {
  baseUrl: string;
  explicit: boolean;
  production: boolean;
  sameOrigin: boolean;
  error?: string;
} {
  const configured = envString(env, 'VITE_PROXY_URL');
  const explicit = configured.length > 0;
  const production = envFlag(env, 'PROD') || envString(env, 'MODE') === 'production';

  if (explicit) {
    const normalized = normalizeProxyUrl(configured);
    return {
      baseUrl: normalized.baseUrl,
      explicit,
      production,
      sameOrigin: normalized.sameOrigin,
    };
  }

  return {
    baseUrl: '',
    explicit,
    production,
    sameOrigin: true,
    error: production ? MISSING_PRODUCTION_PROXY_URL_MESSAGE : undefined,
  };
}

const PROXY_CONFIG = resolveWorkbenchProxyUrl(viteEnv);

export function buildWorkbenchApiUrl(path: string, baseUrl = PROXY_CONFIG.baseUrl): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

function apiUrl(path: string): string {
  if (PROXY_CONFIG.error) throw new Error(PROXY_CONFIG.error);
  return buildWorkbenchApiUrl(path);
}

let accessToken = '';
let adminToken = '';
const DEFAULT_AUTH_FETCH_TIMEOUT_MS = 60_000;

function getAccessToken(): string {
  return accessToken;
}

export function setWorkbenchAccessToken(token: string): void {
  accessToken = token.trim();
}

function getAdminToken(): string {
  return adminToken;
}

export function setWorkbenchAdminToken(token: string): void {
  adminToken = token.trim();
}

function authHeaders(headers?: HeadersInit): HeadersInit {
  const token = getAccessToken();
  const currentAdminToken = getAdminToken();
  return {
    ...(headers || {}),
    ...(token ? { 'x-workbench-token': token } : {}),
    ...(currentAdminToken ? { 'x-workbench-admin-token': currentAdminToken } : {}),
  };
}

function timeoutSignal(timeoutMs = DEFAULT_AUTH_FETCH_TIMEOUT_MS): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return undefined;
  return AbortSignal.timeout(timeoutMs);
}

async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    credentials: 'include',
    headers: authHeaders(init.headers),
    signal: init.signal || timeoutSignal(),
  });

  return response;
}

function apiErrorMessage(response: Response, data: any, fallback = '请求失败'): string {
  const rawMessage = data?.error?.message || data?.error || `HTTP ${response.status}`;
  if (response.status === 402 && /insufficient credits/i.test(String(rawMessage))) {
    return '积分不足。请联系管理员加积分，或切换为你自己的 API Key。';
  }
  return rawMessage || fallback;
}

export interface ProxyAsset {
  id: string;
  type: 'image' | 'video' | 'text' | string;
  url: string;
  legacyUrl?: string;
  fileName?: string;
  filePath?: string;
  prompt?: string;
  model?: string;
  providerId?: string;
  libraryRole?: string;
  libraryNote?: string;
  librarySortOrder?: number;
  createdAt?: string;
}

export interface ProxyAssetListOptions {
  limit?: number;
  offset?: number;
}

export interface ProxyAssetListResponse {
  assets: ProxyAsset[];
  count: number;
  total?: number;
  limit?: number;
  offset?: number;
}

export interface ProxyTask {
  id: string;
  kind: string;
  nodeType?: string;
  providerId?: string;
  model?: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  creditCost?: number;
  creditStatus?: 'none' | 'free' | 'charged' | 'refunded' | string;
  creditKeyScope?: 'user_key' | 'server_key' | string;
  input: any;
  output: any;
  error: any;
  assets?: ProxyAsset[];
  logs?: Array<{
    id: string;
    taskId: string;
    level: string;
    event: string;
    message?: string;
    data?: Record<string, any>;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
  durationMs: number | null;
}

export interface ProxyTaskListOptions {
  limit?: number;
  offset?: number;
  includeLogs?: boolean;
}

export interface ProxyTaskListResponse {
  tasks: ProxyTask[];
  count: number;
  total?: number;
  limit?: number;
  offset?: number;
}

export interface ProxyApiKey {
  id: string;
  ownerUserId: string;
  keyScope: 'user' | 'server';
  providerId: string;
  name?: string;
  baseUrl?: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProxyApiKeyListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  providerId?: string;
  keyScope?: 'user' | 'server' | string;
  status?: 'enabled' | 'disabled' | string;
}

export interface ProxyApiKeyListResponse {
  apiKeys: ProxyApiKey[];
  count: number;
  total?: number;
  limit?: number;
  offset?: number;
  quota?: {
    userKeyCount: number;
    maxUserApiKeys: number;
    remainingUserKeys: number;
  };
}

export interface ProxyApiKeyTestResult {
  apiKeyId: string;
  providerId: string;
  baseUrl: string;
  selectedModel: string;
  models: {
    ok: boolean;
    skipped?: boolean;
    method?: string;
    networkRequest?: boolean;
    billable?: boolean;
    reason?: string;
    status?: number;
    count: number;
    models: Array<{ id: string; ownedBy?: string }>;
    error?: string;
  };
  capabilities: Record<string, any>;
  tests: {
    credentials: { ok: boolean };
    text: { ok: boolean; skipped?: boolean; method?: string; networkRequest?: boolean; billable?: boolean; reason?: string; status?: number; error?: string };
    image: { ok: boolean; skipped?: boolean; method?: string; networkRequest?: boolean; billable?: boolean; reason?: string };
    video: { ok: boolean; skipped?: boolean; method?: string; networkRequest?: boolean; billable?: boolean; reason?: string };
  };
}

export interface ProxyProviderTemplate {
  id: string;
  name: string;
  description: string;
  category: 'text' | 'image' | 'video' | 'multi';
  authType: 'bearer' | 'apiKey' | 'custom';
  defaultBaseUrl: string;
  endpoints: {
    chat?: string;
    image?: string;
    video?: string;
    models?: string;
  };
  headers?: Record<string, string>;
  requestFormat: 'openai' | 'anthropic' | 'dashscope' | 'custom';
  supportedNodes: NodeType[];
  defaultModels?: string[];
}

export interface ProxyModelCapabilities {
  id: string;
  providerId: string;
  modelPattern: string;
  capabilities: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface ProxyModelCapabilityPreset {
  id: string;
  label: string;
  description: string;
  providerId: string;
  modelPattern: string;
  capabilities: Record<string, any>;
}

export interface ProxyModelCapabilityListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  providerId?: string;
}

export interface ProxyModelCapabilityListResponse {
  capabilities: ProxyModelCapabilities[];
  count: number;
  total?: number;
  limit?: number;
  offset?: number;
}

export interface ProxyAssetCollection {
  id: string;
  userId: string;
  name: string;
  description?: string;
  category: string;
  coverAssetId?: string;
  metadata?: Record<string, any>;
  assets: ProxyAsset[];
  createdAt: string;
  updatedAt: string;
}

export interface ProxyAssetCollectionListOptions {
  limit?: number;
  offset?: number;
  search?: string;
}

export interface ProxyAssetCollectionListResponse {
  collections: ProxyAssetCollection[];
  count: number;
  total?: number;
  limit?: number;
  offset?: number;
}

export interface ProxyAssetCollectionTemplate {
  category: string;
  label: string;
  description: string;
  placeholder: string;
  roles: string[];
}

export interface ProxyWorkflowProject {
  id: string;
  userId?: string;
  name: string;
  description: string;
  nodes: any[];
  edges: any[];
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
}

export interface ProxyWorkflowListOptions {
  limit?: number;
  offset?: number;
  search?: string;
}

export interface ProxyWorkflowListResponse {
  workflows: ProxyWorkflowProject[];
  count: number;
  total?: number;
  limit?: number;
  offset?: number;
}

export interface ProxyWorkflowVersion {
  id: string;
  workflowId: string;
  userId?: string;
  versionNumber: number;
  name: string;
  description: string;
  nodes: any[];
  edges: any[];
  metadata?: Record<string, any>;
  nodeCount: number;
  source: string;
  createdAt: string;
}

export interface ProxyWorkflowVersionListOptions {
  limit?: number;
  offset?: number;
}

export interface ProxyWorkflowVersionListResponse {
  versions: ProxyWorkflowVersion[];
  count: number;
  total?: number;
  limit?: number;
  offset?: number;
}

export interface ProxyRequest {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  baseUrl?: string;
  apiKey?: string;
}

export interface ProxyCredentialRef {
  apiKeyId?: string;
  providerId?: string;
}

export interface ProxyResponse {
  status: number;
  data: any;
}

export interface ProxyUser {
  id: string;
  username: string;
  email?: string;
  name: string;
  role: 'admin' | 'user' | 'local' | string;
  isEnabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProxyUserListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  role?: string;
  status?: string;
}

export interface ProxyUserListResponse {
  users: ProxyUser[];
  count: number;
  total?: number;
  limit?: number;
  offset?: number;
}

export interface ProxyCreditAccount {
  userId: string;
  balance: number;
  reservedBalance: number;
  totalGranted: number;
  totalUsed: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProxyCreditTransaction {
  id: string;
  userId: string;
  taskId?: string;
  type: 'grant' | 'debit' | 'refund' | 'admin_adjustment' | 'free_usage' | string;
  amount: number;
  balanceAfter: number;
  reservedAfter: number;
  actorUserId?: string;
  description?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface ProxyCreditTransactionListOptions {
  limit?: number;
  offset?: number;
  userId?: string;
  taskId?: string;
  type?: string;
}

export interface ProxyAdminCreditUser extends ProxyUser {
  creditAccount: ProxyCreditAccount;
}

export interface ProxyRegistrationPolicy {
  allowPublicRegistration: boolean;
  requireInvitationCode: boolean;
}

export interface ProxyAuthMe {
  authenticated: boolean;
  user: ProxyUser | null;
  deploymentMode: 'local' | 'server' | string;
  requireLogin: boolean;
  registration?: ProxyRegistrationPolicy;
}

export interface ProxyInvitation {
  id: string;
  label?: string;
  role: 'admin' | 'user' | string;
  maxUses: number;
  usedCount: number;
  expiresAt?: string;
  createdBy?: string;
  disabledAt?: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  code?: string;
}

export interface ProxyInvitationListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  role?: string;
  status?: string;
}

export interface ProxyInvitationListResponse {
  invitations: ProxyInvitation[];
  count: number;
  total?: number;
  limit?: number;
  offset?: number;
}

export interface ProxySession {
  id: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  isCurrent: boolean;
}

export interface ProxyAuditLog {
  id: string;
  actorUserId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface ProxyAuditLogListOptions {
  limit?: number;
  offset?: number;
  action?: string;
  targetType?: string;
  targetId?: string;
  actorUserId?: string;
  search?: string;
}

export interface ProxyAuditLogListResponse {
  logs: ProxyAuditLog[];
  count: number;
  total?: number;
  limit?: number;
  offset?: number;
}

export interface ProxyAdminHealth {
  status: 'ok' | string;
  time: string;
  deploymentMode: 'local' | 'server' | string;
  host: string;
  serveStatic: boolean;
  outputDir: string;
  dbPath: string;
  defaultUserId: string;
  assets: number;
  tasks: number;
  users: number;
  enabledUsers: number;
  localUserAssets?: number;
  localUserTasks?: number;
  queues?: Array<{
    name: string;
    nodeTypes: string[];
    concurrency: number;
    activeCount: number;
    queuedCount: number;
    scheduled: boolean;
    stopped: boolean;
  }>;
}

export function proxyAssetUrl(url: string): string {
  return url.startsWith('http') || url.startsWith('data:')
    ? url
    : apiUrl(url);
}

export async function proxyCall(req: ProxyRequest): Promise<ProxyResponse> {
  const response = await authFetch(apiUrl('/api/proxy'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return { status: response.status, data };
}

export async function proxyAuthMe(): Promise<ProxyAuthMe> {
  const response = await authFetch(apiUrl('/api/auth/me'));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyLogin(email: string, password: string): Promise<{ user: ProxyUser }> {
  const response = await fetch(apiUrl('/api/auth/login'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyLogout(): Promise<void> {
  const response = await authFetch(apiUrl('/api/auth/logout'), { method: 'POST' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
}

export async function proxyListSessions(): Promise<{ sessions: ProxySession[]; count: number }> {
  const response = await authFetch(apiUrl('/api/auth/sessions'));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyLogoutAllSessions(): Promise<{ ok: boolean; deleted: number }> {
  const response = await authFetch(apiUrl('/api/auth/sessions/logout-all'), { method: 'POST' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyLogoutSession(sessionId: string): Promise<{ ok: boolean; deleted: number; current: boolean }> {
  const response = await authFetch(apiUrl(`/api/auth/sessions/${encodeURIComponent(sessionId)}`), { method: 'DELETE' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyRequestRegistration(
  email: string,
  password: string,
  name: string,
  invitationCode = ''
): Promise<{
  ok: boolean;
  email: string;
  expiresAt: string;
  delivery?: {
    delivered: boolean;
    method?: 'smtp' | 'console' | string;
    expiresInMinutes?: number;
    messageId?: string;
    devCode?: string;
  };
}> {
  const response = await fetch(apiUrl('/api/auth/register/request'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name, invitationCode }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyVerifyRegistration(email: string, code: string): Promise<{ user: ProxyUser }> {
  const response = await fetch(apiUrl('/api/auth/register/verify'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyRequestPasswordReset(
  email: string
): Promise<{
  ok: boolean;
  email: string;
  expiresAt: string;
  delivery?: {
    delivered: boolean;
    method?: 'smtp' | 'console' | string;
    expiresInMinutes?: number;
    messageId?: string;
    devCode?: string;
  };
}> {
  const response = await fetch(apiUrl('/api/auth/password-reset/request'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyVerifyPasswordReset(email: string, code: string, password: string): Promise<{ user: ProxyUser }> {
  const response = await fetch(apiUrl('/api/auth/password-reset/verify'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyListUsers(options: ProxyUserListOptions = {}): Promise<ProxyUserListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await authFetch(apiUrl(`/api/admin/users${suffix}`));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyGetMyCredits(): Promise<{ account: ProxyCreditAccount }> {
  const response = await authFetch(apiUrl('/api/credits/me'));
  const data = await response.json();
  if (!response.ok) throw new Error(apiErrorMessage(response, data, '无法读取积分余额'));
  return data;
}

export async function proxyListMyCreditTransactions(
  options: ProxyCreditTransactionListOptions = {}
): Promise<{ transactions: ProxyCreditTransaction[]; total: number }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await authFetch(apiUrl(`/api/credits/transactions${suffix}`));
  const data = await response.json();
  if (!response.ok) throw new Error(apiErrorMessage(response, data, '无法读取积分流水'));
  return data;
}

export async function proxyAdminListCreditUsers(
  options: ProxyUserListOptions = {}
): Promise<{ users: ProxyAdminCreditUser[]; count: number; total?: number; limit?: number; offset?: number }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await authFetch(apiUrl(`/api/admin/credits/users${suffix}`));
  const data = await response.json();
  if (!response.ok) throw new Error(apiErrorMessage(response, data, '无法读取用户积分'));
  return data;
}

export async function proxyAdminAdjustCredits(input: {
  amount: number;
  reason?: string;
  userId: string;
}): Promise<{ account: ProxyCreditAccount; transaction: ProxyCreditTransaction }> {
  const response = await authFetch(apiUrl('/api/admin/credits/adjust'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(apiErrorMessage(response, data, '积分调整失败'));
  return data;
}

export async function proxyAdminListCreditTransactions(
  options: ProxyCreditTransactionListOptions = {}
): Promise<{ transactions: ProxyCreditTransaction[]; total: number }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await authFetch(apiUrl(`/api/admin/credits/transactions${suffix}`));
  const data = await response.json();
  if (!response.ok) throw new Error(apiErrorMessage(response, data, '无法读取积分流水'));
  return data;
}

export async function proxyCreateUser(input: {
  email: string;
  password: string;
  name?: string;
  role?: 'admin' | 'user';
}): Promise<{ user: ProxyUser }> {
  const response = await authFetch(apiUrl('/api/admin/users'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyUpdateUserPassword(userId: string, password: string): Promise<{ user: ProxyUser }> {
  const response = await authFetch(apiUrl(`/api/admin/users/${encodeURIComponent(userId)}/password`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyUpdateUserStatus(userId: string, isEnabled: boolean): Promise<{ user: ProxyUser }> {
  const response = await authFetch(apiUrl(`/api/admin/users/${encodeURIComponent(userId)}/status`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isEnabled }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyListInvitations(options: ProxyInvitationListOptions = {}): Promise<ProxyInvitationListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await authFetch(apiUrl(`/api/admin/invitations${suffix}`));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyCreateInvitation(input: {
  label?: string;
  role?: 'admin' | 'user';
  maxUses?: number;
  expiresInDays?: number;
}): Promise<{ invitation: ProxyInvitation }> {
  const response = await authFetch(apiUrl('/api/admin/invitations'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyDisableInvitation(invitationId: string): Promise<{ invitation: ProxyInvitation }> {
  const response = await authFetch(apiUrl(`/api/admin/invitations/${encodeURIComponent(invitationId)}`), {
    method: 'DELETE',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyListAuditLogs(options: number | ProxyAuditLogListOptions = 100): Promise<ProxyAuditLogListResponse> {
  const params = new URLSearchParams();
  if (typeof options === 'number') {
    params.set('limit', String(options));
  } else {
    for (const [key, value] of Object.entries(options)) {
      if (value == null || value === '') continue;
      params.set(key, String(value));
    }
  }

  const response = await authFetch(apiUrl(`/api/admin/audit-logs?${params.toString()}`));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyAdminHealth(): Promise<ProxyAdminHealth> {
  const response = await authFetch(apiUrl('/api/admin/health'));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyFetchModels(
  baseUrl: string,
  apiKey: string,
  credential?: ProxyCredentialRef
): Promise<{ models: Array<{ id: string; ownedBy?: string }>; count: number }> {
  const response = await authFetch(apiUrl('/api/models'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl, apiKey, ...credential }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyOpenAIChat(
  baseUrl: string,
  apiKey: string,
  body: any,
  credential?: ProxyCredentialRef
): Promise<any> {
  const response = await authFetch(apiUrl('/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl, apiKey, ...credential, ...body }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(apiErrorMessage(response, data, '聊天请求失败'));
  if (response.status === 202 && data.taskId) {
    const task = await waitForTaskResult(data.taskId);
    return { ...(task.output || {}), __task: task };
  }
  return data;
}

export async function proxyOpenAIImage(
  baseUrl: string,
  apiKey: string,
  body: any,
  credential?: ProxyCredentialRef
): Promise<any> {
  const response = await authFetch(apiUrl('/api/images'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl, apiKey, ...credential, ...body }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(apiErrorMessage(response, data, '图片生成请求失败'));
  if (response.status === 202 && data.taskId) {
    const task = await waitForTaskResult(data.taskId);
    return {
      ...data,
      task,
      data: Array.isArray(task.output) ? task.output : task.assets || [],
    };
  }
  return data;
}

export async function proxyCreateVideoTask(
  baseUrl: string,
  apiKey: string,
  body: any,
  credential?: ProxyCredentialRef
): Promise<any> {
  const response = await authFetch(apiUrl('/api/videos'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl, apiKey, ...credential, ...body }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(apiErrorMessage(response, data, '视频任务提交失败'));
  return data;
}

export async function proxyGetVideoTask(taskId: string, apiKeyId?: string, providerId?: string): Promise<any> {
  const query = new URLSearchParams();
  if (apiKeyId) query.set('apiKeyId', apiKeyId);
  if (providerId) query.set('providerId', providerId);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await authFetch(apiUrl(`/api/videos/${encodeURIComponent(taskId)}${suffix}`));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyListTasks(options: ProxyTaskListOptions = {}): Promise<ProxyTaskListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await authFetch(apiUrl(`/api/tasks${suffix}`));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyGetTask(taskId: string): Promise<{ task: ProxyTask }> {
  const response = await authFetch(apiUrl(`/api/tasks/${encodeURIComponent(taskId)}`));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

async function waitForTaskResult(taskId: string, timeoutMs = 300_000): Promise<ProxyTask> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const { task } = await proxyGetTask(taskId);
    if (task.status === 'succeeded') return task;
    if (task.status === 'failed' || task.status === 'cancelled') {
      throw new Error(task.error?.message || `任务状态为 ${task.status}`);
    }
    await delay(1200);
  }

  throw new Error('等待生成任务结果超时。');
}

export async function proxyRetryTask(taskId: string): Promise<{ task: ProxyTask }> {
  const response = await authFetch(apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/retry`), { method: 'POST' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyCancelTask(taskId: string): Promise<{ task: ProxyTask }> {
  const response = await authFetch(apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/cancel`), { method: 'POST' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyOpenAssetLocation(assetId: string): Promise<void> {
  const response = await authFetch(apiUrl(`/api/assets/${encodeURIComponent(assetId)}/open-location`), { method: 'POST' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
}

export async function proxyListAssets(options: ProxyAssetListOptions = {}): Promise<ProxyAssetListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await authFetch(apiUrl(`/api/assets${suffix}`));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyUploadAsset(body: {
  dataUrl: string;
  fileName?: string;
  prompt?: string;
}): Promise<{ asset: ProxyAsset }> {
  const response = await authFetch(apiUrl('/api/assets/upload'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyListAssetCollections(
  options: ProxyAssetCollectionListOptions = {}
): Promise<ProxyAssetCollectionListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await authFetch(apiUrl(`/api/asset-collections${suffix}`));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyListAssetCollectionTemplates(): Promise<{ templates: ProxyAssetCollectionTemplate[]; count: number }> {
  const response = await authFetch(apiUrl('/api/asset-collection-templates'));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyListWorkflows(options: ProxyWorkflowListOptions = {}): Promise<ProxyWorkflowListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await authFetch(apiUrl(`/api/workflows${suffix}`));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxySaveWorkflow(project: ProxyWorkflowProject): Promise<{ workflow: ProxyWorkflowProject }> {
  const response = await authFetch(apiUrl(`/api/workflows/${encodeURIComponent(project.id)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyDeleteWorkflow(workflowId: string): Promise<void> {
  const response = await authFetch(apiUrl(`/api/workflows/${encodeURIComponent(workflowId)}`), { method: 'DELETE' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
}

export async function proxyDuplicateWorkflow(workflowId: string): Promise<{ workflow: ProxyWorkflowProject }> {
  const response = await authFetch(apiUrl(`/api/workflows/${encodeURIComponent(workflowId)}/duplicate`), { method: 'POST' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyListWorkflowVersions(
  workflowId: string,
  options: ProxyWorkflowVersionListOptions = {}
): Promise<ProxyWorkflowVersionListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await authFetch(apiUrl(`/api/workflows/${encodeURIComponent(workflowId)}/versions${suffix}`));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyRestoreWorkflowVersion(workflowId: string, versionId: string): Promise<{ workflow: ProxyWorkflowProject }> {
  const response = await authFetch(apiUrl(`/api/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}/restore`), {
    method: 'POST',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyDuplicateWorkflowVersion(workflowId: string, versionId: string): Promise<{ workflow: ProxyWorkflowProject }> {
  const response = await authFetch(apiUrl(`/api/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}/duplicate`), {
    method: 'POST',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyCreateAssetCollection(body: {
  name: string;
  description?: string;
  category?: string;
  metadata?: Record<string, any>;
}): Promise<{ collection: ProxyAssetCollection }> {
  const response = await authFetch(apiUrl('/api/asset-collections'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyUpdateAssetCollection(
  collectionId: string,
  body: Partial<{
    name: string;
    description: string;
    category: string;
    coverAssetId: string;
    metadata: Record<string, any>;
  }>
): Promise<{ collection: ProxyAssetCollection }> {
  const response = await authFetch(apiUrl(`/api/asset-collections/${encodeURIComponent(collectionId)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyDeleteAssetCollection(collectionId: string): Promise<void> {
  const response = await authFetch(apiUrl(`/api/asset-collections/${encodeURIComponent(collectionId)}`), {
    method: 'DELETE',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
}

export async function proxyAddAssetToCollection(
  collectionId: string,
  body: {
    assetId: string;
    role?: string;
    note?: string;
  }
): Promise<{ collection: ProxyAssetCollection }> {
  const response = await authFetch(apiUrl(`/api/asset-collections/${encodeURIComponent(collectionId)}/assets`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyAddAssetsToCollection(
  collectionId: string,
  body: {
    assetIds: string[];
    role?: string;
    note?: string;
  }
): Promise<{ collection: ProxyAssetCollection; added: number; skipped: number }> {
  const response = await authFetch(apiUrl(`/api/asset-collections/${encodeURIComponent(collectionId)}/assets/batch`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyRemoveAssetFromCollection(collectionId: string, assetId: string): Promise<void> {
  const response = await authFetch(apiUrl(`/api/asset-collections/${encodeURIComponent(collectionId)}/assets/${encodeURIComponent(assetId)}`), { method: 'DELETE' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
}

export async function proxyRemoveAssetsFromCollection(
  collectionId: string,
  body: {
    assetIds: string[];
  }
): Promise<{ collection: ProxyAssetCollection; removed: number; skipped: number }> {
  const response = await authFetch(apiUrl(`/api/asset-collections/${encodeURIComponent(collectionId)}/assets/batch-remove`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyReorderAssetCollectionItems(
  collectionId: string,
  body: {
    assetIds: string[];
  }
): Promise<{ collection: ProxyAssetCollection; reordered: number; skipped: number }> {
  const response = await authFetch(apiUrl(`/api/asset-collections/${encodeURIComponent(collectionId)}/assets/reorder`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyListApiKeys(options: ProxyApiKeyListOptions = {}): Promise<ProxyApiKeyListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await authFetch(apiUrl(`/api/api-keys${suffix}`));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyListProviders(): Promise<{ providers: ProxyProviderTemplate[]; count: number }> {
  const response = await authFetch(apiUrl('/api/providers'));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxySaveApiKey(body: {
  id?: string;
  keyScope: 'user' | 'server';
  providerId: string;
  name: string;
  baseUrl?: string;
  apiKey: string;
  isEnabled?: boolean;
}): Promise<{ apiKey: ProxyApiKey }> {
  const response = await authFetch(apiUrl('/api/api-keys'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyUpdateApiKey(
  apiKeyId: string,
  body: Partial<{
    providerId: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    isEnabled: boolean;
  }>
): Promise<{ apiKey: ProxyApiKey }> {
  const response = await authFetch(apiUrl(`/api/api-keys/${encodeURIComponent(apiKeyId)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyDeleteApiKey(apiKeyId: string): Promise<void> {
  const response = await authFetch(apiUrl(`/api/api-keys/${encodeURIComponent(apiKeyId)}`), { method: 'DELETE' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
}

export async function proxyTestApiKey(
  apiKeyId: string,
  body: {
    providerId?: string;
    model?: string;
    testText?: boolean;
    testImage?: boolean;
    testVideo?: boolean;
  } = {}
): Promise<{ result: ProxyApiKeyTestResult }> {
  const response = await authFetch(apiUrl(`/api/api-keys/${encodeURIComponent(apiKeyId)}/test`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyListModelCapabilities(
  options: ProxyModelCapabilityListOptions = {}
): Promise<ProxyModelCapabilityListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await authFetch(apiUrl(`/api/model-capabilities${suffix}`));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyListModelCapabilityPresets(providerId?: string): Promise<{ presets: ProxyModelCapabilityPreset[]; count: number }> {
  const query = providerId ? `?providerId=${encodeURIComponent(providerId)}` : '';
  const response = await authFetch(apiUrl(`/api/model-capability-presets${query}`));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxySaveModelCapabilities(body: {
  providerId: string;
  modelPattern: string;
  capabilities: Record<string, any>;
}): Promise<{ capability: ProxyModelCapabilities }> {
  const response = await authFetch(apiUrl('/api/model-capabilities'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function proxyClaudeMessage(
  baseUrl: string,
  apiKey: string,
  body: any,
  credential?: ProxyCredentialRef
): Promise<any> {
  const response = await authFetch(apiUrl('/api/claude'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl, apiKey, ...credential, ...body }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(apiErrorMessage(response, data, 'Claude 请求失败'));
  if (response.status === 202 && data.taskId) {
    const task = await waitForTaskResult(data.taskId);
    return task.output;
  }
  return data;
}

export async function checkProxyHealth(): Promise<boolean> {
  try {
    const response = await authFetch(apiUrl('/api/health'), {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
