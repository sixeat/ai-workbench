import { CheckSquare, ChevronDown, Folder, History, Images, LockKeyhole, LogOut, Play, Save, ShieldCheck, Square, Terminal, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';
import { executeWorkflow } from '../../engine/WorkflowEngine';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { ProxyUser } from '../../lib/apiProxy';
import { accountDisplayName, deploymentLabel, roleLabel } from '../../lib/authDisplay';

interface HeaderProps {
  onToggleAgentPanel: () => void;
  onToggleLogs: () => void;
  onToggleWorkflowManager: () => void;
  onToggleTaskHistory: () => void;
  onToggleAssetLibrary: () => void;
  onToggleAccountSecurity: () => void;
  currentWorkflowName: string;
  currentUser?: ProxyUser | null;
  deploymentMode?: string;
  onLogout?: () => void;
}

export function Header({
  onToggleAgentPanel,
  onToggleLogs,
  onToggleWorkflowManager,
  onToggleTaskHistory,
  onToggleAssetLibrary,
  onToggleAccountSecurity,
  currentWorkflowName,
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
    <header className="topbar">
      <div className="topbar-left">
        <div className="min-w-0">
          <span className="eyebrow">AI Workbench</span>
          <h1>无限画布工作流</h1>
        </div>
        <button className="template-chip" onClick={onToggleWorkflowManager} type="button">
          <Folder className="h-4 w-4" />
          <span className="max-w-[160px] truncate">{currentWorkflowName || '短视频模板'}</span>
          <ChevronDown className="h-4 w-4 text-gray-500" />
        </button>
      </div>

      <div className="topbar-actions">
        <button
          onClick={handleRun}
          disabled={execution.status === 'running'}
          className={cn(
            'ghost-button',
            execution.status === 'running'
              ? 'cursor-not-allowed opacity-50'
              : ''
          )}
          title="用于复用完整模板。日常创作建议在右侧属性面板运行单个节点或选区。"
        >
          <CheckSquare className="h-4 w-4" />
          运行框选
        </button>

        <button
          onClick={handleRun}
          disabled={execution.status === 'running'}
          className={cn(
            'primary-button',
            execution.status === 'running' && 'cursor-not-allowed opacity-60'
          )}
        >
          <Play className="h-4 w-4" />
          一键运行
        </button>

        <button className="icon-button small" type="button" title="保存工作流" onClick={onToggleWorkflowManager}>
          <Save className="h-4 w-4" />
        </button>

        {execution.status === 'running' && (
          <button className="stop-button" onClick={reset} type="button">
            <Square className="h-4 w-4" />
            停止
          </button>
        )}

        <button onClick={onToggleTaskHistory} className="icon-button small" type="button" title="任务历史">
          <History className="h-4 w-4" />
        </button>

        <button onClick={onToggleAssetLibrary} className="icon-button small" type="button" title="素材库">
          <Images className="h-4 w-4" />
        </button>

        <button onClick={onToggleAgentPanel} className="icon-button small" type="button" title="Agent">
          <Zap className="h-4 w-4" />
        </button>

        <button
          onClick={onToggleLogs}
          className={cn(
            'icon-button small',
            execution.logs.length > 0 && 'text-amber-300'
          )}
          type="button"
          title="日志"
        >
          <Terminal className="h-4 w-4" />
        </button>

        {shouldShowAccountStatus && (
          <div className="template-chip">
            <span className="max-w-[120px] truncate">{displayName}</span>
            {userRoleLabel && <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] text-gray-500">{userRoleLabel}</span>}
            {modeLabel && <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-300">{modeLabel}</span>}
            {currentUser && (
              <button className="rounded p-0.5 text-gray-500 hover:text-white" title="账号安全" onClick={onToggleAccountSecurity}>
                <ShieldCheck className="h-4 w-4" />
              </button>
            )}
            {onLogout && (
              <button className="rounded p-0.5 text-gray-500 hover:text-white" title="退出登录" onClick={onLogout}>
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {!shouldShowAccountStatus && (
          <button className="template-chip" type="button">
            <LockKeyhole className="h-4 w-4" />
            访客模式
          </button>
        )}
      </div>
    </header>
  );
}
