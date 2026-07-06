import { FolderKanban, History, Images, Key, LogOut, Play, ShieldCheck, Square, Terminal, Users, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';
import { executeWorkflow } from '../../engine/WorkflowEngine';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { ProxyUser } from '../../lib/apiProxy';
import { accountDisplayName, deploymentLabel, roleLabel } from '../../lib/authDisplay';

interface HeaderProps {
  onToggleApiManager: () => void;
  onToggleAgentPanel: () => void;
  onToggleLogs: () => void;
  onToggleWorkflowManager: () => void;
  onToggleTaskHistory: () => void;
  onToggleAssetLibrary: () => void;
  onToggleAdminUsers: () => void;
  onToggleAccountSecurity: () => void;
  currentUser?: ProxyUser | null;
  deploymentMode?: string;
  onLogout?: () => void;
}

export function Header({
  onToggleApiManager,
  onToggleAgentPanel,
  onToggleLogs,
  onToggleWorkflowManager,
  onToggleTaskHistory,
  onToggleAssetLibrary,
  onToggleAdminUsers,
  onToggleAccountSecurity,
  currentUser,
  deploymentMode,
  onLogout,
}: HeaderProps) {
  const { execution, reset } = useWorkflowStore();
  const modeLabel = deploymentLabel(deploymentMode);
  const userRoleLabel = roleLabel(currentUser?.role);
  const displayName = accountDisplayName(currentUser, deploymentMode);
  const shouldShowAccountStatus = Boolean(currentUser || modeLabel);

  const handleRun = async () => {
    if (execution.status === 'running') return;
    await executeWorkflow();
  };

  return (
    <header className="z-50 flex h-12 shrink-0 items-center justify-between border-b border-panel-border bg-panel-bg px-4">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
          <Zap className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold tracking-tight text-white">AI Workbench</h1>
          <div className="text-[10px] text-gray-500">多模态工作流</div>
        </div>
        <span className="rounded bg-canvas-bg px-2 py-0.5 text-xs text-gray-500">v0.1.0</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleRun}
          disabled={execution.status === 'running'}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
            execution.status === 'running'
              ? 'cursor-not-allowed bg-gray-700 text-gray-400'
              : 'border border-panel-border bg-gray-800/60 text-gray-300 hover:bg-gray-700/70'
          )}
          title="用于复用完整模板。日常创作建议在右侧属性面板运行单个节点或选区。"
        >
          <Play className="h-3.5 w-3.5" />
          运行全部
        </button>

        <button
          onClick={reset}
          disabled={execution.status === 'idle'}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
            execution.status === 'idle'
              ? 'cursor-not-allowed bg-gray-700 text-gray-400'
              : 'bg-red-600 text-white hover:bg-red-500'
          )}
        >
          <Square className="h-3.5 w-3.5" />
          停止
        </button>

        {execution.status !== 'idle' && (
          <div className="ml-2 flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-700">
              <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${execution.progress}%` }} />
            </div>
            <span className="text-xs text-gray-400">{execution.progress}%</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={onToggleWorkflowManager} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-700/50">
          <FolderKanban className="h-3.5 w-3.5" />
          工作流
        </button>

        <button onClick={onToggleTaskHistory} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-700/50">
          <History className="h-3.5 w-3.5" />
          任务
        </button>

        <button onClick={onToggleAssetLibrary} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-700/50">
          <Images className="h-3.5 w-3.5" />
          素材库
        </button>

        <div className="h-5 w-px bg-panel-border" />

        <button onClick={onToggleApiManager} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-700/50">
          <Key className="h-3.5 w-3.5" />
          API 管理
        </button>

        {currentUser?.role === 'admin' && (
          <button onClick={onToggleAdminUsers} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-700/50">
            <Users className="h-3.5 w-3.5" />
            后台
          </button>
        )}

        <button onClick={onToggleAgentPanel} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-700/50">
          <Zap className="h-3.5 w-3.5" />
          Agent
        </button>

        <button
          onClick={onToggleLogs}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors',
            execution.logs.length > 0 ? 'text-amber-400 hover:bg-amber-500/10' : 'text-gray-300 hover:bg-gray-700/50'
          )}
        >
          <Terminal className="h-3.5 w-3.5" />
          日志
          {execution.logs.length > 0 && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/20 text-[10px] text-amber-400">
              {execution.logs.length}
            </span>
          )}
        </button>

        {shouldShowAccountStatus && (
          <div className="flex items-center gap-1 rounded-md border border-panel-border px-2 py-1.5 text-xs text-gray-300">
            <span className="max-w-[120px] truncate">{displayName}</span>
            {userRoleLabel && <span className="rounded bg-canvas-bg px-1.5 py-0.5 text-[10px] text-gray-500">{userRoleLabel}</span>}
            {modeLabel && <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-300">{modeLabel}</span>}
            {currentUser && (
              <button className="ml-1 rounded p-0.5 text-gray-500 hover:bg-gray-700/60 hover:text-white" title="账号安全" onClick={onToggleAccountSecurity}>
                <ShieldCheck className="h-3.5 w-3.5" />
              </button>
            )}
            {onLogout && (
              <button className="ml-1 rounded p-0.5 text-gray-500 hover:bg-gray-700/60 hover:text-white" title="退出登录" onClick={onLogout}>
                <LogOut className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
