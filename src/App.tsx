import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, LockKeyhole, Mail, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react';
import { FlowCanvas } from './components/canvas/FlowCanvas';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { Panel, Workspace } from './components/layout/Workspace';
import type { ApiManagerTab } from './components/panels/ApiManagerPanel';
import { ImagePreviewOverlay } from './components/panels/ImagePreviewOverlay';
import { NodeListPanel } from './components/panels/NodeListPanel';
import { PropertiesPanel } from './components/panels/PropertiesPanel';
import {
  proxyAuthMe,
  proxyLogin,
  proxyLogout,
  proxyRequestRegistration,
  proxyVerifyRegistration,
  type ProxyAuthMe,
  type ProxyRegistrationPolicy,
} from './lib/apiProxy';
import { cn } from './lib/utils';
import { useCanvasStore } from './stores/canvasStore';
import type { WorkflowProject } from './stores/workflowDb';

const AccountSecurityPanel = lazy(() =>
  import('./components/panels/AccountSecurityPanel').then((module) => ({ default: module.AccountSecurityPanel }))
);
const AdminUsersPanel = lazy(() =>
  import('./components/panels/AdminUsersPanel').then((module) => ({ default: module.AdminUsersPanel }))
);
const AgentPanel = lazy(() =>
  import('./components/panels/AgentPanel').then((module) => ({ default: module.AgentPanel }))
);
const ApiManagerPanel = lazy(() =>
  import('./components/panels/ApiManagerPanel').then((module) => ({ default: module.ApiManagerPanel }))
);
const AssetLibraryPanel = lazy(() =>
  import('./components/panels/AssetLibraryPanel').then((module) => ({ default: module.AssetLibraryPanel }))
);
const ExecutionLogsPanel = lazy(() =>
  import('./components/panels/ExecutionLogsPanel').then((module) => ({ default: module.ExecutionLogsPanel }))
);
const TaskHistoryPanel = lazy(() =>
  import('./components/panels/TaskHistoryPanel').then((module) => ({ default: module.TaskHistoryPanel }))
);
const WorkflowManagerPanel = lazy(() =>
  import('./components/panels/WorkflowManagerPanel').then((module) => ({ default: module.WorkflowManagerPanel }))
);

type AuthMode = 'login' | 'register' | 'verify';

interface AuthGateProps {
  authInfo: ProxyAuthMe;
  onSuccess: () => Promise<void>;
}

function AuthGate({ authInfo, onSuccess }: AuthGateProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const registration = authInfo.registration;
  const canRegister = Boolean(registration?.allowPublicRegistration || registration?.requireInvitationCode);

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await proxyLogin(email.trim(), password);
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请检查邮箱和密码。');
    } finally {
      setLoading(false);
    }
  };

  const submitRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const data = await proxyRequestRegistration(email.trim(), password, name.trim(), invitationCode.trim());
      setMode('verify');
      setNotice(data.delivery?.devCode ? `验证码已生成：${data.delivery.devCode}` : '验证码已发送，请查收邮箱。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册请求失败，请稍后再试。');
    } finally {
      setLoading(false);
    }
  };

  const submitVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await proxyVerifyRegistration(email.trim(), verificationCode.trim());
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码验证失败。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0c0f12] px-6 text-gray-100">
      <section className="w-full max-w-[920px] overflow-hidden rounded-3xl border border-white/10 bg-[#141a21]/95 shadow-2xl">
        <div className="grid md:grid-cols-[1fr_380px]">
          <div className="flex min-h-[520px] flex-col justify-between bg-[radial-gradient(circle_at_20%_20%,rgba(54,196,134,0.22),transparent_30%),linear-gradient(135deg,#101820,#0d1117)] p-8">
            <div>
              <div className="mb-8 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400 text-gray-950 shadow-lg shadow-emerald-400/20">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200/80">AI Workbench</p>
              <h1 className="max-w-md text-3xl font-semibold leading-tight text-white">登录后使用你的多模态创作工作台</h1>
              <p className="mt-4 max-w-md text-sm leading-6 text-gray-400">
                服务器模式下，API Key、素材、任务和工作流都由后端管理。这样更适合多人协作，也更接近 SaaS 部署方式。
              </p>
            </div>

            <div className="grid gap-3 text-xs text-gray-300 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <CheckCircle2 className="mb-2 h-4 w-4 text-emerald-300" />
                Cookie 登录态
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <CheckCircle2 className="mb-2 h-4 w-4 text-emerald-300" />
                后端托管 Key
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <CheckCircle2 className="mb-2 h-4 w-4 text-emerald-300" />
                任务与素材隔离
              </div>
            </div>
          </div>

          <div className="p-7">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-white">
                {mode === 'login' ? '邮箱登录' : mode === 'register' ? '创建账号' : '验证邮箱'}
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                {mode === 'login' ? '请输入管理员创建的账号，或使用邀请注册。' : '注册完成后会进入工作台。'}
              </p>
            </div>

            {mode === 'login' && (
              <form className="space-y-4" onSubmit={submitLogin}>
                <TextInput icon={<Mail className="h-4 w-4" />} label="邮箱" type="email" value={email} onChange={setEmail} required />
                <TextInput icon={<LockKeyhole className="h-4 w-4" />} label="密码" type="password" value={password} onChange={setPassword} required />
                <SubmitButton loading={loading}>登录</SubmitButton>
              </form>
            )}

            {mode === 'register' && (
              <form className="space-y-4" onSubmit={submitRegister}>
                <TextInput label="邮箱" type="email" value={email} onChange={setEmail} required />
                <TextInput label="昵称" value={name} onChange={setName} required />
                <TextInput label="密码" type="password" value={password} onChange={setPassword} required />
                {registration?.requireInvitationCode && (
                  <TextInput label="邀请码" value={invitationCode} onChange={setInvitationCode} required />
                )}
                <SubmitButton loading={loading}>发送验证码</SubmitButton>
              </form>
            )}

            {mode === 'verify' && (
              <form className="space-y-4" onSubmit={submitVerify}>
                <TextInput label="邮箱" type="email" value={email} onChange={setEmail} required />
                <TextInput label="验证码" value={verificationCode} onChange={setVerificationCode} required />
                <SubmitButton loading={loading}>完成注册</SubmitButton>
              </form>
            )}

            {notice && (
              <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                {notice}
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {error}
              </div>
            )}

            <div className="mt-6 flex items-center justify-between text-xs">
              {mode !== 'login' ? (
                <button className="text-gray-400 hover:text-white" type="button" onClick={() => setMode('login')}>
                  返回登录
                </button>
              ) : (
                <span className="text-gray-600">服务器模式</span>
              )}
              {mode === 'login' && canRegister && (
                <button className="flex items-center gap-1.5 text-emerald-300 hover:text-emerald-200" type="button" onClick={() => setMode('register')}>
                  <UserPlus className="h-3.5 w-3.5" />
                  注册账号
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

interface TextInputProps {
  icon?: React.ReactNode;
  label: string;
  type?: string;
  value: string;
  required?: boolean;
  onChange: (value: string) => void;
}

function TextInput({ icon, label, type = 'text', value, required, onChange }: TextInputProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-gray-400">{label}</span>
      <span className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white focus-within:border-emerald-400/70">
        {icon && <span className="text-gray-500">{icon}</span>}
        <input
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-gray-600"
          type={type}
          value={value}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </label>
  );
}

function SubmitButton({ children, loading }: { children: React.ReactNode; loading: boolean }) {
  return (
    <button
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-gray-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={loading}
      type="submit"
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0c0f12] text-gray-300">
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm">
        <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />
        正在连接 AI Workbench 服务...
      </div>
    </main>
  );
}

function ConnectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0c0f12] px-6 text-gray-100">
      <section className="max-w-md rounded-2xl border border-red-500/20 bg-red-500/10 p-6">
        <AlertCircle className="mb-4 h-8 w-8 text-red-300" />
        <h1 className="text-lg font-semibold text-white">无法连接后端服务</h1>
        <p className="mt-2 text-sm leading-6 text-red-100/80">{message}</p>
        <button
          className="mt-5 flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15"
          onClick={onRetry}
        >
          <RefreshCw className="h-4 w-4" />
          重新连接
        </button>
      </section>
    </main>
  );
}

function PanelLoading() {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#121820]/95 px-5 py-4 text-sm text-gray-200 shadow-2xl">
        <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />
        正在加载面板...
      </div>
    </div>
  );
}

function registrationPolicyAllowsGate(authInfo: ProxyAuthMe | null): authInfo is ProxyAuthMe & { registration: ProxyRegistrationPolicy } {
  return Boolean(authInfo?.registration);
}

function App() {
  const [authInfo, setAuthInfo] = useState<ProxyAuthMe | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isApiManagerOpen, setIsApiManagerOpen] = useState(false);
  const [apiManagerInitialTab, setApiManagerInitialTab] = useState<ApiManagerTab>('server');
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [isWorkflowManagerOpen, setIsWorkflowManagerOpen] = useState(false);
  const [isTaskHistoryOpen, setIsTaskHistoryOpen] = useState(false);
  const [isAssetLibraryOpen, setIsAssetLibraryOpen] = useState(false);
  const [isAdminUsersOpen, setIsAdminUsersOpen] = useState(false);
  const [isAccountSecurityOpen, setIsAccountSecurityOpen] = useState(false);
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | undefined>();
  const [currentWorkflowName, setCurrentWorkflowName] = useState('未命名工作流');
  const { nodes, edges, clearCanvas, setEdges, setNodes } = useCanvasStore();

  const refreshAuth = useCallback(async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const data = await proxyAuthMe();
      setAuthInfo(data);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : '后端服务没有响应。');
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const handleLogout = async () => {
    try {
      await proxyLogout();
    } finally {
      await refreshAuth();
    }
  };

  const openApiManager = (tab: ApiManagerTab = 'server') => {
    setApiManagerInitialTab(tab);
    setIsApiManagerOpen(true);
  };

  const handleLoadProject = (project: WorkflowProject) => {
    setNodes(project.nodes);
    setEdges(project.edges);
    setCurrentWorkflowId(project.id);
    setCurrentWorkflowName(project.name);
    setIsWorkflowManagerOpen(false);
  };

  const handleCurrentProjectChange = (project: WorkflowProject) => {
    setCurrentWorkflowId(project.id);
    setCurrentWorkflowName(project.name);
  };

  const handleNewWorkflow = () => {
    if (nodes.length > 0 && !window.confirm('新建工作流会清空当前画布，确定继续吗？')) return;
    clearCanvas();
    setCurrentWorkflowId(undefined);
    setCurrentWorkflowName('未命名工作流');
    setIsWorkflowManagerOpen(false);
  };

  const handleExport = () => {
    const payload = {
      id: currentWorkflowId || `workflow-${Date.now()}`,
      name: currentWorkflowName,
      description: '',
      nodes,
      edges,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodeCount: nodes.length,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${currentWorkflowName || 'ai-workbench-workflow'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (authLoading) return <LoadingScreen />;
  if (authError) return <ConnectionError message={authError} onRetry={refreshAuth} />;
  if (authInfo?.requireLogin && !authInfo.authenticated) {
    return <AuthGate authInfo={registrationPolicyAllowsGate(authInfo) ? authInfo : { ...authInfo, registration: { allowPublicRegistration: false, requireInvitationCode: false } }} onSuccess={refreshAuth} />;
  }

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-canvas-bg text-gray-100">
      <Header
        onToggleApiManager={() => openApiManager('server')}
        onToggleAgentPanel={() => setIsAgentPanelOpen(true)}
        onToggleLogs={() => setIsLogsOpen(true)}
        onToggleWorkflowManager={() => setIsWorkflowManagerOpen(true)}
        onToggleTaskHistory={() => setIsTaskHistoryOpen(true)}
        onToggleAssetLibrary={() => setIsAssetLibraryOpen(true)}
        onToggleAdminUsers={() => setIsAdminUsersOpen(true)}
        onToggleAccountSecurity={() => setIsAccountSecurityOpen(true)}
        currentUser={authInfo?.user}
        deploymentMode={authInfo?.deploymentMode}
        onLogout={authInfo?.authenticated ? handleLogout : undefined}
      />

      <Workspace className="min-h-0">
        <Sidebar
          position="left"
          width={280}
          collapsed={leftCollapsed}
          onToggle={() => setLeftCollapsed((value) => !value)}
          title="节点"
        >
          <NodeListPanel />
        </Sidebar>

        <Panel className="min-w-0">
          <FlowCanvas />
        </Panel>

        <Sidebar
          position="right"
          width={340}
          collapsed={rightCollapsed}
          onToggle={() => setRightCollapsed((value) => !value)}
          title="属性"
          className={cn(rightCollapsed && 'border-l')}
        >
          <PropertiesPanel />
        </Sidebar>
      </Workspace>

      <Suspense fallback={<PanelLoading />}>
        {isWorkflowManagerOpen && (
          <WorkflowManagerPanel
            isOpen={isWorkflowManagerOpen}
            onClose={() => setIsWorkflowManagerOpen(false)}
            onLoadProject={handleLoadProject}
            onCurrentProjectChange={handleCurrentProjectChange}
            onNewWorkflow={handleNewWorkflow}
            onExport={handleExport}
            currentWorkflowId={currentWorkflowId}
            currentWorkflowName={currentWorkflowName}
          />
        )}
        {isTaskHistoryOpen && <TaskHistoryPanel isOpen={isTaskHistoryOpen} onClose={() => setIsTaskHistoryOpen(false)} />}
        {isAssetLibraryOpen && <AssetLibraryPanel isOpen={isAssetLibraryOpen} onClose={() => setIsAssetLibraryOpen(false)} />}
        {isApiManagerOpen && <ApiManagerPanel isOpen={isApiManagerOpen} onClose={() => setIsApiManagerOpen(false)} initialTab={apiManagerInitialTab} />}
        {isAccountSecurityOpen && (
          <AccountSecurityPanel
            isOpen={isAccountSecurityOpen}
            currentUser={authInfo?.user}
            onClose={() => setIsAccountSecurityOpen(false)}
            onSessionInvalidated={refreshAuth}
          />
        )}
        {isAdminUsersOpen && (
          <AdminUsersPanel
            isOpen={isAdminUsersOpen}
            onClose={() => setIsAdminUsersOpen(false)}
            currentUser={authInfo?.user}
            onOpenApiManager={openApiManager}
          />
        )}
        {isAgentPanelOpen && <AgentPanel isOpen={isAgentPanelOpen} onClose={() => setIsAgentPanelOpen(false)} />}
        {isLogsOpen && <ExecutionLogsPanel isOpen={isLogsOpen} onClose={() => setIsLogsOpen(false)} />}
      </Suspense>
      <ImagePreviewOverlay />
    </main>
  );
}

export default App;
