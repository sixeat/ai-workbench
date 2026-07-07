import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Bot, ClipboardList, Coins, Database, FolderOpen, Key, Loader2, RefreshCw, Search, Server, ShieldCheck, SlidersHorizontal, UserPlus, X } from 'lucide-react';
import {
  proxyAdminHealth,
  proxyAdminAdjustCredits,
  proxyAdminListCreditUsers,
  proxyAdminListCreditTransactions,
  proxyCreateInvitation,
  proxyCreateUser,
  proxyDisableInvitation,
  proxyListInvitations,
  proxyListAuditLogs,
  proxyUpdateUserPassword,
  proxyUpdateUserStatus,
  type ProxyAdminHealth,
  type ProxyAdminCreditUser,
  type ProxyAuditLog,
  type ProxyCreditTransaction,
  type ProxyInvitation,
  type ProxyUser,
} from '../../lib/apiProxy';
import {
  formatQueueBacklog,
  formatQueueCapacity,
  formatQueueName,
  formatQueueNodeTypes,
  getQueueHealthState,
  summarizeQueues,
} from '../../lib/adminHealthDisplay';
import { cn } from '../../lib/utils';
import { FloatingWindow } from '../layout/FloatingWindow';
import {
  buildAuditActorLabelMap,
  filterAuditLogs,
  formatAuditLogPageSummary,
  formatAuditActionLabel,
  formatAuditActor,
  mergeAuditLogPages,
} from '../../lib/auditLogDisplay';
import {
  creditTransactionTone,
  formatCreditAmount,
  formatCreditDate,
  formatCreditTransactionType,
} from '../../lib/creditDisplay';
import { ApiManagerPanel } from './ApiManagerPanel';
import { PlatformModelsPanel } from './PlatformModelsPanel';

interface AdminUsersPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: ProxyUser | null;
  variant?: 'floating' | 'page';
}

const emptyForm = {
  email: '',
  name: '',
  password: '',
  role: 'user' as 'user' | 'admin',
};

const emptyInviteForm = {
  label: '',
  role: 'user' as 'user' | 'admin',
  maxUses: 1,
  expiresInDays: 30,
};

const emptyCreditForm = {
  amount: '100',
  reason: '管理员赠送积分',
};

const emptyListFilters = {
  search: '',
  role: '',
  status: '',
};

const USER_PAGE_SIZE = 80;
const INVITATION_PAGE_SIZE = 80;
const AUDIT_PAGE_SIZE = 80;
const CREDIT_PAGE_SIZE = 80;

type AdminTab = 'overview' | 'users' | 'credits' | 'invitations' | 'apiKeys' | 'platformModels' | 'modelCapabilities' | 'audit' | 'system';
const SERVER_KEY_ADMIN_TABS = ['server'] as const;
const MODEL_CAPABILITY_ADMIN_TABS = ['capabilities'] as const;

function roleLabel(role: string): string {
  if (role === 'admin') return '管理员';
  if (role === 'user') return '普通用户';
  return role;
}

function deploymentLabel(mode?: string): string {
  if (mode === 'server') return '服务器模式';
  if (mode === 'local') return '本地模式';
  return mode || '未知';
}

function formatDateTime(value?: string): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
}

function mergeById<T extends { id: string }>(current: T[], next: T[]): T[] {
  const items = new Map<string, T>();
  for (const item of current) items.set(item.id, item);
  for (const item of next) items.set(item.id, item);
  return Array.from(items.values());
}

export function AdminUsersPanel({ isOpen, onClose, currentUser, variant = 'floating' }: AdminUsersPanelProps) {
  const [users, setUsers] = useState<ProxyAdminCreditUser[]>([]);
  const [invitations, setInvitations] = useState<ProxyInvitation[]>([]);
  const [auditLogs, setAuditLogs] = useState<ProxyAuditLog[]>([]);
  const [creditTransactions, setCreditTransactions] = useState<ProxyCreditTransaction[]>([]);
  const [health, setHealth] = useState<ProxyAdminHealth | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [form, setForm] = useState(emptyForm);
  const [inviteForm, setInviteForm] = useState(emptyInviteForm);
  const [creditForm, setCreditForm] = useState(emptyCreditForm);
  const [selectedCreditUserId, setSelectedCreditUserId] = useState('');
  const [newInviteCode, setNewInviteCode] = useState('');
  const [userFilters, setUserFilters] = useState(emptyListFilters);
  const [appliedUserFilters, setAppliedUserFilters] = useState(emptyListFilters);
  const [invitationFilters, setInvitationFilters] = useState(emptyListFilters);
  const [appliedInvitationFilters, setAppliedInvitationFilters] = useState(emptyListFilters);
  const [creditTypeFilter, setCreditTypeFilter] = useState('');
  const [creditTaskFilter, setCreditTaskFilter] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [userTotal, setUserTotal] = useState(0);
  const [invitationTotal, setInvitationTotal] = useState(0);
  const [auditTotal, setAuditTotal] = useState(0);
  const [creditTotal, setCreditTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [creditLoading, setCreditLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [passwordUser, setPasswordUser] = useState<ProxyUser | null>(null);
  const [passwordForm, setPasswordForm] = useState({ password: '', confirmation: '' });
  const isPage = variant === 'page';

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setUsersLoading(true);
    setError('');
    try {
      const data = await proxyAdminListCreditUsers({
        limit: USER_PAGE_SIZE,
        offset: 0,
        ...appliedUserFilters,
      });
      setUsers(data.users);
      setUserTotal(data.total ?? data.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载用户失败');
    } finally {
      setUsersLoading(false);
      setLoading(false);
    }
  }, [appliedUserFilters]);

  const loadMoreUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const data = await proxyAdminListCreditUsers({
        limit: USER_PAGE_SIZE,
        offset: users.length,
        ...appliedUserFilters,
      });
      setUsers((current) => mergeById(current, data.users));
      setUserTotal(data.total ?? data.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载用户失败');
    } finally {
      setUsersLoading(false);
    }
  }, [appliedUserFilters, users.length]);

  const loadInvitations = useCallback(async () => {
    setInvitationsLoading(true);
    try {
      const data = await proxyListInvitations({
        limit: INVITATION_PAGE_SIZE,
        offset: 0,
        ...appliedInvitationFilters,
      });
      setInvitations(data.invitations);
      setInvitationTotal(data.total ?? data.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载邀请码失败');
    } finally {
      setInvitationsLoading(false);
    }
  }, [appliedInvitationFilters]);

  const loadMoreInvitations = useCallback(async () => {
    setInvitationsLoading(true);
    try {
      const data = await proxyListInvitations({
        limit: INVITATION_PAGE_SIZE,
        offset: invitations.length,
        ...appliedInvitationFilters,
      });
      setInvitations((current) => mergeById(current, data.invitations));
      setInvitationTotal(data.total ?? data.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载邀请码失败');
    } finally {
      setInvitationsLoading(false);
    }
  }, [appliedInvitationFilters, invitations.length]);

  const loadHealth = useCallback(async () => {
    try {
      const data = await proxyAdminHealth();
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载系统状态失败');
    }
  }, []);

  const loadAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const data = await proxyListAuditLogs({
        limit: AUDIT_PAGE_SIZE,
        offset: 0,
      });
      setAuditLogs(data.logs);
      setAuditTotal(data.total ?? data.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载审计日志失败');
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const loadMoreAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const data = await proxyListAuditLogs({
        limit: AUDIT_PAGE_SIZE,
        offset: auditLogs.length,
      });
      setAuditLogs((current) => mergeAuditLogPages(current, data.logs));
      setAuditTotal(data.total ?? data.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载审计日志失败');
    } finally {
      setAuditLoading(false);
    }
  }, [auditLogs.length]);

  const loadCreditTransactions = useCallback(async () => {
    setCreditLoading(true);
    try {
      const data = await proxyAdminListCreditTransactions({
        limit: CREDIT_PAGE_SIZE,
        offset: 0,
        taskId: creditTaskFilter,
        type: creditTypeFilter,
        userId: selectedCreditUserId,
      });
      setCreditTransactions(data.transactions);
      setCreditTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载积分流水失败');
    } finally {
      setCreditLoading(false);
    }
  }, [creditTaskFilter, creditTypeFilter, selectedCreditUserId]);

  const loadMoreCreditTransactions = useCallback(async () => {
    setCreditLoading(true);
    try {
      const data = await proxyAdminListCreditTransactions({
        limit: CREDIT_PAGE_SIZE,
        offset: creditTransactions.length,
        taskId: creditTaskFilter,
        type: creditTypeFilter,
        userId: selectedCreditUserId,
      });
      setCreditTransactions((current) => mergeById(current, data.transactions));
      setCreditTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载积分流水失败');
    } finally {
      setCreditLoading(false);
    }
  }, [creditTaskFilter, creditTransactions.length, creditTypeFilter, selectedCreditUserId]);

  const reloadAll = useCallback(async () => {
    await Promise.all([loadUsers(), loadInvitations(), loadAuditLogs(), loadHealth()]);
  }, [loadAuditLogs, loadHealth, loadInvitations, loadUsers]);

  const auditActorLabels = useMemo(
    () => buildAuditActorLabelMap(users),
    [users]
  );

  const filteredAuditLogs = useMemo(
    () => filterAuditLogs(auditLogs, auditSearch, auditActorLabels),
    [auditActorLabels, auditLogs, auditSearch]
  );
  const usersHasMore = users.length < userTotal;
  const invitationsHasMore = invitations.length < invitationTotal;
  const auditHasMore = auditLogs.length < auditTotal;
  const creditHasMore = creditTransactions.length < creditTotal;
  const selectedCreditUser = users.find((user) => user.id === selectedCreditUserId) || null;
  const auditSummary = formatAuditLogPageSummary(filteredAuditLogs.length, auditLogs.length, auditTotal, auditSearch);

  useEffect(() => {
    if (isOpen) reloadAll();
  }, [isOpen, reloadAll]);

  useEffect(() => {
    if (isOpen) void loadCreditTransactions();
  }, [isOpen, loadCreditTransactions]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 1800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!isOpen) return null;

  const handleCreateUser = async () => {
    setSaving(true);
    setError('');
    try {
      await proxyCreateUser(form);
      setForm(emptyForm);
      setNotice('用户已创建');
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建用户失败');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateInvitation = async () => {
    setSaving(true);
    setError('');
    setNewInviteCode('');
    try {
      const data = await proxyCreateInvitation(inviteForm);
      setNewInviteCode(data.invitation.code || '');
      setInviteForm(emptyInviteForm);
      setNotice('邀请码已创建，请立即复制');
      await loadInvitations();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建邀请码失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDisableInvitation = async (invitation: ProxyInvitation) => {
    if (!window.confirm(`确认禁用邀请码「${invitation.label || invitation.id}」吗？`)) return;
    setError('');
    try {
      await proxyDisableInvitation(invitation.id);
      setNotice('邀请码已禁用');
      await loadInvitations();
    } catch (err) {
      setError(err instanceof Error ? err.message : '禁用邀请码失败');
    }
  };

  const handleResetPassword = async (user: ProxyUser) => {
    setPasswordUser(user);
    setPasswordForm({ password: '', confirmation: '' });
  };

  const handleConfirmPasswordReset = async () => {
    if (!passwordUser) return;
    if (passwordForm.password.length < 8) {
      setError('新密码至少需要 8 位。');
      return;
    }
    if (passwordForm.password !== passwordForm.confirmation) {
      setError('两次输入的新密码不一致。');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await proxyUpdateUserPassword(passwordUser.id, passwordForm.password);
      setNotice('密码已更新');
      setPasswordUser(null);
      setPasswordForm({ password: '', confirmation: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新密码失败');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (user: ProxyUser) => {
    const nextStatus = !user.isEnabled;
    const action = nextStatus ? '启用' : '禁用';
    if (!window.confirm(`确认${action}用户「${user.email || user.username || user.id}」吗？`)) return;
    setError('');
    try {
      await proxyUpdateUserStatus(user.id, nextStatus);
      setNotice(nextStatus ? '用户已启用' : '用户已禁用');
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新用户状态失败');
    }
  };

  const handleSelectCreditUser = (user: ProxyAdminCreditUser) => {
    setSelectedCreditUserId(user.id);
    setCreditForm((current) => ({
      ...current,
      reason: Number(current.amount) < 0 ? '管理员扣减积分' : '管理员赠送积分',
    }));
    setActiveTab('credits');
  };

  const handleAdjustCredits = async () => {
    if (!selectedCreditUser) {
      setError('请先选择要调整积分的用户。');
      return;
    }

    const amount = Number(creditForm.amount);
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount === 0) {
      setError('请输入非 0 整数积分。');
      return;
    }

    setError('');
    if (!window.confirm(`确认给「${selectedCreditUser.email || selectedCreditUser.username || selectedCreditUser.id}」调整 ${amount} 积分吗？`)) return;
    setSaving(true);
    try {
      await proxyAdminAdjustCredits({
        amount,
        reason: creditForm.reason,
        userId: selectedCreditUser.id,
      });
      setNotice('积分已调整');
      await Promise.all([loadUsers(), loadCreditTransactions()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '积分调整失败');
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <>
        <div className="flex items-center justify-between border-b border-panel-border px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold text-white">管理端</h2>
              <div className="text-[10px] text-gray-500">平台 Key、用户、模型能力和审计统一在这里维护</div>
            </div>
            {notice && <span className="text-[10px] text-emerald-300">{notice}</span>}
          </div>
          <div className="flex items-center gap-2">
            {currentUser && <span className="rounded bg-canvas-bg px-2 py-1 text-[10px] text-gray-500">当前：{currentUser.email || currentUser.username}</span>}
            <button onClick={reloadAll} className="rounded p-1 text-gray-400 hover:bg-gray-700/50 hover:text-white" title="刷新">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
            {!isPage && (
              <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-700/50 hover:text-white" title="关闭">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {error && <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300">{error}</div>}

        <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr] overflow-hidden">
          <aside className="space-y-2 overflow-auto border-r border-panel-border p-3">
            <TabButton active={activeTab === 'overview'} icon={<Activity className="h-3.5 w-3.5" />} onClick={() => setActiveTab('overview')}>
              概览
            </TabButton>
            <TabButton active={activeTab === 'users'} icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setActiveTab('users')}>
              用户
            </TabButton>
            <TabButton active={activeTab === 'credits'} icon={<Coins className="h-3.5 w-3.5" />} onClick={() => setActiveTab('credits')}>
              积分
            </TabButton>
            <TabButton active={activeTab === 'invitations'} icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => setActiveTab('invitations')}>
              邀请
            </TabButton>
            <TabButton active={activeTab === 'apiKeys'} icon={<Key className="h-3.5 w-3.5" />} onClick={() => setActiveTab('apiKeys')}>
              API Key
            </TabButton>
            <TabButton active={activeTab === 'platformModels'} icon={<Bot className="h-3.5 w-3.5" />} onClick={() => setActiveTab('platformModels')}>
              平台模型
            </TabButton>
            <TabButton active={activeTab === 'modelCapabilities'} icon={<SlidersHorizontal className="h-3.5 w-3.5" />} onClick={() => setActiveTab('modelCapabilities')}>
              模型能力
            </TabButton>
            <TabButton active={activeTab === 'audit'} icon={<ClipboardList className="h-3.5 w-3.5" />} onClick={() => setActiveTab('audit')}>
              审计日志
            </TabButton>
            <TabButton active={activeTab === 'system'} icon={<Activity className="h-3.5 w-3.5" />} onClick={() => setActiveTab('system')}>
              系统状态
            </TabButton>
          </aside>

          <main className="min-h-0 overflow-auto p-4">
            {activeTab === 'overview' && (
              <section className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <StatCard icon={<Server className="h-4 w-4" />} label="部署模式" value={deploymentLabel(health?.deploymentMode)} />
                  <StatCard icon={<UserPlus className="h-4 w-4" />} label="启用用户" value={`${health?.enabledUsers ?? 0}/${health?.users ?? 0}`} />
                  <StatCard icon={<Database className="h-4 w-4" />} label="任务" value={String(health?.tasks ?? 0)} />
                  <StatCard icon={<FolderOpen className="h-4 w-4" />} label="资产" value={String(health?.assets ?? 0)} />
                </div>
                <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                  <section className="rounded-lg border border-panel-border bg-canvas-bg/50 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">任务队列</div>
                        <div className="mt-1 text-[10px] text-gray-500">{summarizeQueues(health?.queues)}</div>
                      </div>
                      <button
                        onClick={() => void loadHealth()}
                        className="inline-flex items-center gap-1.5 rounded-md border border-panel-border px-2 py-1 text-[10px] text-gray-300 hover:border-accent hover:text-accent"
                      >
                        <RefreshCw className="h-3 w-3" />
                        刷新
                      </button>
                    </div>
                    {!health?.queues?.length ? (
                      <EmptyText>暂无队列状态</EmptyText>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2">
                        {health.queues.map((queue) => (
                          <QueueHealthCard key={queue.name} queue={queue} />
                        ))}
                      </div>
                    )}
                  </section>
                  <section className="rounded-lg border border-panel-border bg-canvas-bg/50 p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-white">最近积分流水</div>
                        <div className="mt-1 text-[10px] text-gray-500">用于快速判断平台共享 Key 的消耗情况。</div>
                      </div>
                      <button
                        onClick={() => setActiveTab('credits')}
                        className="rounded-md border border-panel-border px-2 py-1 text-[10px] text-gray-300 hover:border-accent hover:text-accent"
                      >
                        查看全部
                      </button>
                    </div>
                    {creditTransactions.length === 0 ? (
                      <EmptyText>暂无积分流水</EmptyText>
                    ) : (
                      <div className="overflow-hidden rounded-lg border border-panel-border">
                        {creditTransactions.slice(0, 6).map((transaction) => (
                          <CreditTransactionItem key={transaction.id} transaction={transaction} />
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </section>
            )}

            {activeTab === 'users' && (
              <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
                <section className="space-y-3 rounded-lg border border-panel-border bg-canvas-bg/60 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
                    <UserPlus className="h-3.5 w-3.5" />
                    创建普通用户
                  </div>
                  <Input label="邮箱" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} />
                  <Input label="昵称" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
                  <Input label="初始密码" type="password" value={form.password} onChange={(value) => setForm((current) => ({ ...current, password: value }))} />
                  <Select
                    label="角色"
                    value={form.role}
                    onChange={(value) => setForm((current) => ({ ...current, role: value as 'user' | 'admin' }))}
                    options={[
                      { label: '普通用户', value: 'user' },
                      { label: '管理员', value: 'admin' },
                    ]}
                  />
                  <PrimaryButton onClick={handleCreateUser} disabled={saving || !form.email || !form.password}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                    创建用户
                  </PrimaryButton>
                </section>

                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">用户列表</h3>
                    <span className="text-[10px] text-gray-500">
                      已加载 {users.length}/{userTotal || users.length} 个用户
                    </span>
                  </div>
                  <div className="mb-3 grid gap-2 rounded-lg border border-panel-border bg-canvas-bg/40 p-2 md:grid-cols-[1fr_120px_120px_auto_auto]">
                    <input
                      value={userFilters.search}
                      onChange={(event) => setUserFilters((current) => ({ ...current, search: event.target.value }))}
                      placeholder="搜索邮箱、昵称、用户 ID"
                      className="rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
                    />
                    <select
                      value={userFilters.role}
                      onChange={(event) => setUserFilters((current) => ({ ...current, role: event.target.value }))}
                      className="rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
                    >
                      <option value="">全部角色</option>
                      <option value="user">普通用户</option>
                      <option value="admin">管理员</option>
                    </select>
                    <select
                      value={userFilters.status}
                      onChange={(event) => setUserFilters((current) => ({ ...current, status: event.target.value }))}
                      className="rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
                    >
                      <option value="">全部状态</option>
                      <option value="enabled">已启用</option>
                      <option value="disabled">已禁用</option>
                    </select>
                    <button
                      onClick={() => setAppliedUserFilters(userFilters)}
                      className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                    >
                      筛选
                    </button>
                    <button
                      onClick={() => {
                        setUserFilters(emptyListFilters);
                        setAppliedUserFilters(emptyListFilters);
                      }}
                      className="rounded-md border border-panel-border px-3 py-1.5 text-xs text-gray-300 hover:border-accent hover:text-accent"
                    >
                      重置
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-panel-border">
                    {users.length === 0 ? (
                      <EmptyText>暂无用户</EmptyText>
                    ) : (
                      users.map((user) => (
                        <div key={user.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-panel-border bg-canvas-bg/50 px-3 py-2 last:border-b-0">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-white">{user.name || user.email || user.username}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
                              <span>{user.email || user.username}</span>
                              <span className="rounded bg-panel-bg px-1.5 py-0.5">{roleLabel(user.role)}</span>
                              <span className={cn('rounded px-1.5 py-0.5', user.isEnabled === false ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300')}>
                                {user.isEnabled === false ? '已禁用' : '已启用'}
                              </span>
                              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
                                {user.creditAccount?.balance ?? 0} 积分
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <SmallButton onClick={() => handleSelectCreditUser(user)}>积分</SmallButton>
                            <SmallButton onClick={() => handleResetPassword(user)}>改密码</SmallButton>
                            <SmallButton onClick={() => handleToggleStatus(user)} danger={user.isEnabled !== false}>
                              {user.isEnabled === false ? '启用' : '禁用'}
                            </SmallButton>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {usersHasMore && (
                    <div className="mt-3 flex justify-center">
                      <button
                        onClick={() => void loadMoreUsers()}
                        disabled={usersLoading}
                        className="inline-flex items-center gap-2 rounded-md border border-panel-border px-3 py-1.5 text-xs text-gray-300 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {usersLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        加载更多用户
                      </button>
                    </div>
                  )}
                </section>
              </div>
            )}

            {activeTab === 'credits' && (
              <section className="space-y-4">
                <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
                  <div className="space-y-4">
                    <section className="space-y-3 rounded-lg border border-panel-border bg-canvas-bg/60 p-3">
                      <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
                        <Coins className="h-3.5 w-3.5 text-emerald-300" />
                        积分调整
                      </div>
                      <label className="block space-y-1">
                        <span className="text-[10px] text-gray-500">目标用户</span>
                        <select
                          value={selectedCreditUserId}
                          onChange={(event) => setSelectedCreditUserId(event.target.value)}
                          className="w-full rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
                        >
                          <option value="">选择用户</option>
                          {users.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.email || user.username || user.id}（{user.creditAccount?.balance ?? 0} 积分）
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedCreditUser && (
                        <div className="grid grid-cols-3 gap-2 text-[10px]">
                          <CreditMetric label="余额" value={selectedCreditUser.creditAccount?.balance ?? 0} />
                          <CreditMetric label="累计获得" value={selectedCreditUser.creditAccount?.totalGranted ?? 0} />
                          <CreditMetric label="累计消耗" value={selectedCreditUser.creditAccount?.totalUsed ?? 0} />
                        </div>
                      )}
                      <Input
                        label="积分变动"
                        type="number"
                        value={creditForm.amount}
                        onChange={(value) => {
                          setCreditForm((current) => ({
                            ...current,
                            amount: value,
                            reason: Number(value) < 0 ? '管理员扣减积分' : '管理员赠送积分',
                          }));
                        }}
                        placeholder="正数增加，负数扣减"
                      />
                      <Input
                        label="调整原因"
                        value={creditForm.reason}
                        onChange={(value) => setCreditForm((current) => ({ ...current, reason: value }))}
                        placeholder="例如：测试赠送、售后补偿、风控修正"
                      />
                      <PrimaryButton onClick={() => void handleAdjustCredits()} disabled={saving || !selectedCreditUserId}>
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Coins className="h-3.5 w-3.5" />}
                        提交积分调整
                      </PrimaryButton>
                      <p className="text-[10px] leading-4 text-gray-500">
                        调整会写入积分流水和审计日志。普通用户不能调用这个接口。
                      </p>
                    </section>

                    <section className="rounded-lg border border-panel-border bg-canvas-bg/60 p-3">
                      <div className="mb-2 text-xs font-medium text-gray-300">计费策略</div>
                      <div className="space-y-2 text-[10px] text-gray-500">
                        <div className="rounded-md bg-panel-bg/70 px-2 py-1.5">服务器 Key：文本 1 分/次，图片 10 分/张，视频 20 分/秒。</div>
                        <div className="rounded-md bg-panel-bg/70 px-2 py-1.5">用户自己的 Key：当前版本不扣平台积分。</div>
                      </div>
                    </section>
                  </div>

                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">积分流水</h3>
                      <span className="text-[10px] text-gray-500">
                        已加载 {creditTransactions.length}/{creditTotal || creditTransactions.length} 条
                      </span>
                    </div>
                    <div className="mb-3 grid gap-2 rounded-lg border border-panel-border bg-canvas-bg/40 p-2 md:grid-cols-[1fr_140px_1fr_auto]">
                      <select
                        value={selectedCreditUserId}
                        onChange={(event) => setSelectedCreditUserId(event.target.value)}
                        className="rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
                      >
                        <option value="">全部用户</option>
                        {users.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.email || user.username || user.id}
                          </option>
                        ))}
                      </select>
                      <select
                        value={creditTypeFilter}
                        onChange={(event) => setCreditTypeFilter(event.target.value)}
                        className="rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
                      >
                        <option value="">全部类型</option>
                        <option value="debit">扣费</option>
                        <option value="refund">退款</option>
                        <option value="admin_adjustment">管理员调整</option>
                        <option value="grant">充值</option>
                        <option value="free_usage">用户 Key 免费</option>
                      </select>
                      <input
                        value={creditTaskFilter}
                        onChange={(event) => setCreditTaskFilter(event.target.value)}
                        placeholder="按任务 ID 筛选"
                        className="rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
                      />
                      <button
                        onClick={() => void loadCreditTransactions()}
                        disabled={creditLoading}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RefreshCw className={cn('h-3.5 w-3.5', creditLoading && 'animate-spin')} />
                        刷新
                      </button>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-panel-border">
                      {creditLoading && creditTransactions.length === 0 ? (
                        <EmptyText>正在加载积分流水...</EmptyText>
                      ) : creditTransactions.length === 0 ? (
                        <EmptyText>暂无积分流水</EmptyText>
                      ) : (
                        creditTransactions.map((transaction) => (
                          <CreditTransactionItem key={transaction.id} transaction={transaction} />
                        ))
                      )}
                    </div>
                    {creditHasMore && (
                      <div className="mt-3 flex justify-center">
                        <button
                          onClick={() => void loadMoreCreditTransactions()}
                          disabled={creditLoading}
                          className="inline-flex items-center gap-2 rounded-md border border-panel-border px-3 py-1.5 text-xs text-gray-300 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {creditLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          加载更多流水
                        </button>
                      </div>
                    )}
                  </section>
                </div>
              </section>
            )}

            {activeTab === 'invitations' && (
              <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
                <section className="space-y-3 rounded-lg border border-panel-border bg-canvas-bg/60 p-3">
                  <div className="text-xs font-medium text-gray-300">创建邀请码</div>
                  <Input label="备注" value={inviteForm.label} onChange={(value) => setInviteForm((current) => ({ ...current, label: value }))} placeholder="例如：朋友测试账号" />
                  <Select
                    label="默认角色"
                    value={inviteForm.role}
                    onChange={(value) => setInviteForm((current) => ({ ...current, role: value as 'user' | 'admin' }))}
                    options={[
                      { label: '普通用户', value: 'user' },
                      { label: '管理员', value: 'admin' },
                    ]}
                  />
                  <Input label="最多使用次数" type="number" value={String(inviteForm.maxUses)} onChange={(value) => setInviteForm((current) => ({ ...current, maxUses: Math.max(1, Number(value || 1)) }))} />
                  <Input label="有效天数" type="number" value={String(inviteForm.expiresInDays)} onChange={(value) => setInviteForm((current) => ({ ...current, expiresInDays: Math.max(1, Number(value || 1)) }))} />
                  <PrimaryButton onClick={handleCreateInvitation} disabled={saving}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                    创建邀请码
                  </PrimaryButton>
                  {newInviteCode && (
                    <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2 text-xs text-emerald-200">
                      <div className="mb-1 text-[10px] text-emerald-300">邀请码</div>
                      <code className="break-all">{newInviteCode}</code>
                    </div>
                  )}
                </section>

                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">邀请码</h3>
                    <span className="text-[10px] text-gray-500">
                      已加载 {invitations.length}/{invitationTotal || invitations.length} 条记录
                    </span>
                  </div>
                  <div className="mb-3 grid gap-2 rounded-lg border border-panel-border bg-canvas-bg/40 p-2 md:grid-cols-[1fr_120px_120px_auto_auto]">
                    <input
                      value={invitationFilters.search}
                      onChange={(event) => setInvitationFilters((current) => ({ ...current, search: event.target.value }))}
                      placeholder="搜索备注、角色、邀请 ID"
                      className="rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
                    />
                    <select
                      value={invitationFilters.role}
                      onChange={(event) => setInvitationFilters((current) => ({ ...current, role: event.target.value }))}
                      className="rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
                    >
                      <option value="">全部角色</option>
                      <option value="user">普通用户</option>
                      <option value="admin">管理员</option>
                    </select>
                    <select
                      value={invitationFilters.status}
                      onChange={(event) => setInvitationFilters((current) => ({ ...current, status: event.target.value }))}
                      className="rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
                    >
                      <option value="">全部状态</option>
                      <option value="active">可用</option>
                      <option value="inactive">不可用</option>
                      <option value="expired">已过期</option>
                      <option value="used">已用完</option>
                      <option value="disabled">已禁用</option>
                    </select>
                    <button
                      onClick={() => setAppliedInvitationFilters(invitationFilters)}
                      className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                    >
                      筛选
                    </button>
                    <button
                      onClick={() => {
                        setInvitationFilters(emptyListFilters);
                        setAppliedInvitationFilters(emptyListFilters);
                      }}
                      className="rounded-md border border-panel-border px-3 py-1.5 text-xs text-gray-300 hover:border-accent hover:text-accent"
                    >
                      重置
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-panel-border">
                    {invitations.length === 0 ? (
                      <EmptyText>暂无邀请码</EmptyText>
                    ) : (
                      invitations.map((invitation) => (
                        <div key={invitation.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-panel-border bg-canvas-bg/50 px-3 py-2 last:border-b-0">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-white">{invitation.label || '未命名邀请'}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
                              <span>{roleLabel(invitation.role)}</span>
                              <span>使用 {invitation.usedCount}/{invitation.maxUses}</span>
                              {invitation.expiresAt && <span>到期 {formatDateTime(invitation.expiresAt)}</span>}
                              <span className={cn('rounded px-1.5 py-0.5', invitation.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300')}>
                                {invitation.isActive ? '可用' : '不可用'}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {invitation.code && <SmallButton onClick={() => navigator.clipboard.writeText(invitation.code || '')}>复制</SmallButton>}
                            <SmallButton onClick={() => handleDisableInvitation(invitation)} disabled={!invitation.isActive} danger>
                              禁用
                            </SmallButton>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {invitationsHasMore && (
                    <div className="mt-3 flex justify-center">
                      <button
                        onClick={() => void loadMoreInvitations()}
                        disabled={invitationsLoading}
                        className="inline-flex items-center gap-2 rounded-md border border-panel-border px-3 py-1.5 text-xs text-gray-300 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {invitationsLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        加载更多邀请码
                      </button>
                    </div>
                  )}
                </section>
              </div>
            )}

            {activeTab === 'apiKeys' && (
              <ApiManagerPanel
                allowedTabs={SERVER_KEY_ADMIN_TABS}
                initialTab="server"
                isOpen
                mode="admin-server-keys"
                onClose={() => undefined}
                variant="embedded"
              />
            )}

            {activeTab === 'platformModels' && (
              <PlatformModelsPanel />
            )}

            {activeTab === 'modelCapabilities' && (
              <ApiManagerPanel
                allowedTabs={MODEL_CAPABILITY_ADMIN_TABS}
                initialTab="capabilities"
                isOpen
                mode="admin-capabilities"
                onClose={() => undefined}
                variant="embedded"
              />
            )}

            {activeTab === 'audit' && (
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="shrink-0 text-xs font-semibold uppercase tracking-wider text-gray-400">审计日志</h3>
                  <div className="relative ml-auto w-72">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                    <input
                      value={auditSearch}
                      onChange={(event) => setAuditSearch(event.target.value)}
                      placeholder="搜索动作、目标、操作者、IP..."
                      className="w-full rounded-md border border-panel-border bg-canvas-bg py-1.5 pl-8 pr-3 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={() => void loadAuditLogs()}
                    disabled={auditLoading}
                    className="rounded-md border border-panel-border px-2 py-1.5 text-[10px] text-gray-300 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                    title="重新加载审计日志"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', auditLoading && 'animate-spin')} />
                  </button>
                  <span className="shrink-0 text-[10px] text-gray-500">
                    {auditSummary}
                  </span>
                </div>
                <div className="overflow-hidden rounded-lg border border-panel-border">
                  {filteredAuditLogs.length === 0 ? (
                    <EmptyText>{auditSearch.trim() ? '没有匹配的审计日志' : '暂无审计日志'}</EmptyText>
                  ) : (
                    filteredAuditLogs.map((log) => (
                      <div key={log.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-panel-border bg-canvas-bg/50 px-3 py-2 last:border-b-0">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-white">{formatAuditActionLabel(log.action)}</span>
                            <span className="rounded bg-panel-bg px-1.5 py-0.5 text-[10px] text-gray-500">{log.targetType || 'system'}</span>
                            {log.targetId && <span className="max-w-[220px] truncate rounded bg-panel-bg px-1.5 py-0.5 text-[10px] text-gray-500">{log.targetId}</span>}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
                            <span>操作者：{formatAuditActor(log, auditActorLabels)}</span>
                            {log.ipAddress && <span>IP：{log.ipAddress}</span>}
                            {log.metadata && Object.keys(log.metadata).length > 0 && (
                              <span className="truncate" title={JSON.stringify(log.metadata)}>
                                {JSON.stringify(log.metadata)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-[10px] text-gray-500">
                          {formatDateTime(log.createdAt)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {auditHasMore && (
                  <div className="mt-3 flex justify-center">
                    <button
                      onClick={() => void loadMoreAuditLogs()}
                      disabled={auditLoading}
                      className="inline-flex items-center gap-2 rounded-md border border-panel-border px-3 py-1.5 text-xs text-gray-300 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {auditLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      加载更多审计日志
                    </button>
                  </div>
                )}
              </section>
            )}

            {activeTab === 'system' && (
              <section className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <StatCard icon={<Server className="h-4 w-4" />} label="部署模式" value={deploymentLabel(health?.deploymentMode)} />
                  <StatCard icon={<UserPlus className="h-4 w-4" />} label="用户" value={`${health?.enabledUsers ?? 0}/${health?.users ?? 0}`} />
                  <StatCard icon={<Database className="h-4 w-4" />} label="任务" value={String(health?.tasks ?? 0)} />
                  <StatCard icon={<FolderOpen className="h-4 w-4" />} label="资产" value={String(health?.assets ?? 0)} />
                </div>

                <div className="rounded-lg border border-panel-border bg-canvas-bg/50 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">任务队列</div>
                      <div className="mt-1 text-[10px] text-gray-500">{summarizeQueues(health?.queues)}</div>
                    </div>
                    <button
                      onClick={() => void loadHealth()}
                      className="inline-flex items-center gap-1.5 rounded-md border border-panel-border px-2 py-1 text-[10px] text-gray-300 hover:border-accent hover:text-accent"
                    >
                      <RefreshCw className="h-3 w-3" />
                      刷新
                    </button>
                  </div>
                  {!health?.queues?.length ? (
                    <EmptyText>暂无队列状态</EmptyText>
                  ) : (
                    <div className="grid gap-2 md:grid-cols-2">
                      {health.queues.map((queue) => (
                        <QueueHealthCard key={queue.name} queue={queue} />
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-panel-border bg-canvas-bg/50">
                  {!health ? (
                    <EmptyText>{loading ? '正在加载系统状态...' : '暂无系统状态'}</EmptyText>
                  ) : (
                    <div className="divide-y divide-panel-border">
                      <InfoRow label="服务状态" value={health.status} tone={health.status === 'ok' ? 'success' : 'warning'} />
                      <InfoRow label="更新时间" value={formatDateTime(health.time)} />
                      <InfoRow label="监听地址" value={health.host} />
                      <InfoRow label="托管前端静态文件" value={health.serveStatic ? '开启' : '关闭'} />
                      <InfoRow label="数据库路径" value={health.dbPath} mono />
                      <InfoRow label="输出目录" value={health.outputDir} mono />
                      <InfoRow label="默认用户 ID" value={health.defaultUserId} mono />
                      <InfoRow label="local-user 任务/资产" value={`${health.localUserTasks ?? 0} / ${health.localUserAssets ?? 0}`} />
                    </div>
                  )}
                </div>
              </section>
            )}
          </main>
        </div>
        <PasswordResetDialog
          confirmation={passwordForm.confirmation}
          isSaving={saving}
          password={passwordForm.password}
          user={passwordUser}
          onCancel={() => {
            setPasswordUser(null);
            setPasswordForm({ password: '', confirmation: '' });
          }}
          onChange={(patch) => setPasswordForm((current) => ({ ...current, ...patch }))}
          onConfirm={handleConfirmPasswordReset}
        />
    </>
  );

  if (isPage) {
    return (
      <main className="admin-console-page text-gray-100">
        <section className="admin-console-shell">
          {content}
        </section>
      </main>
    );
  }

  return (
    <FloatingWindow contentClassName="h-[calc(100vh-32px)] w-[calc(100vw-112px)] flex-col">
      {content}
    </FloatingWindow>
  );
}

function PasswordResetDialog({
  confirmation,
  isSaving,
  onCancel,
  onChange,
  onConfirm,
  password,
  user,
}: {
  confirmation: string;
  isSaving: boolean;
  onCancel: () => void;
  onChange: (patch: Partial<{ password: string; confirmation: string }>) => void;
  onConfirm: () => void;
  password: string;
  user: ProxyUser | null;
}) {
  if (!user) return null;
  const label = user.email || user.username || user.id;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4">
      <section className="w-full max-w-md rounded-2xl border border-panel-border bg-[#11161c] p-4 shadow-2xl">
        <div className="mb-3">
          <div className="text-sm font-semibold text-white">重置用户密码</div>
          <div className="mt-1 text-xs leading-5 text-gray-500">目标用户：{label}</div>
        </div>
        <div className="space-y-3">
          <Input
            label="新密码"
            type="password"
            value={password}
            onChange={(value) => onChange({ password: value })}
            placeholder="至少 8 位"
          />
          <Input
            label="再次输入新密码"
            type="password"
            value={confirmation}
            onChange={(value) => onChange({ confirmation: value })}
            placeholder="再次确认，避免误改"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-panel-border px-3 py-2 text-xs text-gray-300 hover:border-gray-500 hover:text-white"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSaving || !password || !confirmation}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            确认重置
          </button>
        </div>
      </section>
    </div>
  );
}

function TabButton({
  active,
  children,
  icon,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors',
        active ? 'border border-accent/30 bg-accent/15 text-white' : 'text-gray-400 hover:bg-gray-700/40 hover:text-white'
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-panel-border bg-canvas-bg/60 p-3">
      <div className="mb-2 flex items-center gap-2 text-[10px] text-gray-500">
        {icon}
        {label}
      </div>
      <div className="truncate text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function CreditMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-panel-bg/70 px-2 py-1.5">
      <div className="text-gray-500">{label}</div>
      <div className="mt-0.5 text-xs font-medium text-gray-100">{value}</div>
    </div>
  );
}

function CreditTransactionItem({ transaction }: { transaction: ProxyCreditTransaction }) {
  const tone = creditTransactionTone(transaction);
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-panel-border bg-canvas-bg/50 px-3 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-white">{formatCreditTransactionType(transaction.type)}</span>
          {transaction.taskId && (
            <span className="max-w-[180px] truncate rounded bg-panel-bg px-1.5 py-0.5 text-[10px] text-gray-500" title={transaction.taskId}>
              任务 {transaction.taskId}
            </span>
          )}
          {transaction.userId && (
            <span className="max-w-[180px] truncate rounded bg-panel-bg px-1.5 py-0.5 text-[10px] text-gray-500" title={transaction.userId}>
              用户 {transaction.userId}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
          <span>{formatCreditDate(transaction.createdAt)}</span>
          {transaction.description && <span className="truncate">{transaction.description}</span>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div
          className={cn(
            'text-xs font-semibold',
            tone === 'success' && 'text-emerald-300',
            tone === 'danger' && 'text-red-300',
            tone === 'neutral' && 'text-gray-300'
          )}
        >
          {formatCreditAmount(transaction.amount)}
        </div>
        <div className="mt-1 text-[10px] text-gray-500">余额 {transaction.balanceAfter}</div>
      </div>
    </div>
  );
}

function QueueHealthCard({ queue }: { queue: NonNullable<ProxyAdminHealth['queues']>[number] }) {
  const state = getQueueHealthState(queue);
  return (
    <div className="rounded-lg border border-panel-border bg-panel-bg/70 p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-white">{formatQueueName(queue.name)}</div>
          <div className="mt-1 text-[10px] text-gray-500">{formatQueueNodeTypes(queue.nodeTypes)}</div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded px-2 py-0.5 text-[10px]',
            state.tone === 'success' && 'bg-emerald-500/15 text-emerald-300',
            state.tone === 'warning' && 'bg-amber-500/15 text-amber-300',
            state.tone === 'danger' && 'bg-red-500/15 text-red-300',
            state.tone === 'neutral' && 'bg-gray-500/15 text-gray-300'
          )}
        >
          {state.label}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="rounded-md bg-canvas-bg px-2 py-1.5 text-gray-300">{formatQueueCapacity(queue)}</div>
        <div className="rounded-md bg-canvas-bg px-2 py-1.5 text-gray-300">{formatQueueBacklog(queue)}</div>
      </div>
      <div className="mt-2 text-[10px] leading-4 text-gray-500">{state.description}</div>
    </div>
  );
}

function InfoRow({
  label,
  mono,
  tone,
  value,
}: {
  label: string;
  mono?: boolean;
  tone?: 'success' | 'warning';
  value: string;
}) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-4 px-3 py-2 text-xs">
      <div className="text-gray-500">{label}</div>
      <div
        className={cn(
          'break-all text-gray-300',
          mono && 'font-mono text-[11px]',
          tone === 'success' && 'text-emerald-300',
          tone === 'warning' && 'text-amber-300'
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] text-gray-500">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-accent focus:outline-none"
      />
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-panel-border bg-panel-bg px-2.5 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2 rounded-md border border-accent/45 bg-accent/15 px-3 py-2 text-xs font-medium text-white shadow-sm shadow-black/20 transition-colors hover:border-accent/70 hover:bg-accent/25 disabled:cursor-not-allowed disabled:border-panel-border disabled:bg-canvas-bg disabled:text-gray-500 disabled:opacity-70"
    >
      {children}
    </button>
  );
}

function SmallButton({ children, onClick, disabled, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded px-2 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        danger ? 'text-red-300 hover:bg-red-500/10' : 'text-gray-300 hover:bg-gray-700/60'
      )}
    >
      {children}
    </button>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <div className="bg-canvas-bg/50 px-3 py-8 text-center text-xs text-gray-500">{children}</div>;
}
