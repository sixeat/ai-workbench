import { CheckSquare, ChevronDown, Coins, Folder, History, Images, Loader2, LockKeyhole, LogOut, Play, Save, ShieldCheck, Square, Terminal, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';
import { executeSelectedNodes, executeWorkflow } from '../../engine/WorkflowEngine';
import { useCanvasStore } from '../../stores/canvasStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { ProxyUser } from '../../lib/apiProxy';
import { accountDisplayName, deploymentLabel, roleLabel } from '../../lib/authDisplay';

interface HeaderProps {
  onToggleAgentPanel: () => void;
  onToggleLogs: () => void;
  onToggleWorkflowManager: () => void;
  onSaveWorkflow: () => void;
  onToggleTaskHistory: () => void;
  onToggleAssetLibrary: () => void;
  onToggleAccountSecurity: () => void;
  onToggleCredits: () => void;
  currentWorkflowName: string;
  creditBalance?: number;
  currentUser?: ProxyUser | null;
  deploymentMode?: string;
  workflowSaveMessage?: string;
  workflowSaveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  onLogout?: () => void;
}

export function Header({
  onToggleAgentPanel,
  onToggleLogs,
  onToggleWorkflowManager,
  onSaveWorkflow,
  onToggleTaskHistory,
  onToggleAssetLibrary,
  onToggleAccountSecurity,
  onToggleCredits,
  currentWorkflowName,
  creditBalance,
  currentUser,
  deploymentMode,
  workflowSaveMessage,
  workflowSaveStatus = 'idle',
  onLogout,
}: HeaderProps) {
  const { execution, reset } = useWorkflowStore();
  const selectedNodeIds = useCanvasStore((state) => state.selectedNodeIds);
  const modeLabel = deploymentLabel(deploymentMode);
  const userRoleLabel = roleLabel(currentUser?.role);
  const displayName = accountDisplayName(currentUser, deploymentMode);
  const shouldShowAccountStatus = Boolean(currentUser || modeLabel);
  const selectedCount = selectedNodeIds.length;

  const handleRun = async () => {
    if (execution.status === 'running') return;
    await executeWorkflow();
  };

  const handleRunSelection = async () => {
    if (execution.status === 'running') return;
    if (selectedCount === 0) {
      window.alert('请先在画布上框选或多选要运行的节点。');
      return;
    }
    await executeSelectedNodes(selectedNodeIds);
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
          onClick={handleRunSelection}
          disabled={execution.status === 'running'}
          className={cn(
            'ghost-button',
            execution.status === 'running'
              ? 'cursor-not-allowed opacity-50'
              : ''
          )}
          title={selectedCount > 0 ? `运行当前选中的 ${selectedCount} 个节点，并自动补齐上游依赖。` : '在画布空白处按住左键拖出范围框，或按住 Shift/Command 点击多个节点。'}
        >
          <CheckSquare className="h-4 w-4" />
          运行框选
          {selectedCount > 0 && <span className="rounded bg-canvas-bg px-1.5 py-0.5 text-[10px] text-accent">{selectedCount}</span>}
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

        <button
          className={cn(
            'icon-button small',
            workflowSaveStatus === 'saved' && 'text-emerald-300',
            workflowSaveStatus === 'error' && 'text-red-300',
            workflowSaveStatus === 'saving' && 'cursor-not-allowed opacity-70'
          )}
          type="button"
          title={workflowSaveMessage || '保存当前工作流'}
          onClick={onSaveWorkflow}
          disabled={workflowSaveStatus === 'saving'}
        >
          {workflowSaveStatus === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
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
            {typeof creditBalance === 'number' && (
              <button
                className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20"
                onClick={onToggleCredits}
                title="查看积分余额和流水"
                type="button"
              >
                <Coins className="h-3 w-3" />
                {creditBalance} 积分
              </button>
            )}
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
