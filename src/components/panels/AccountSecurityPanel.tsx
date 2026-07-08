import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Loader2, LogOut, MonitorSmartphone, RefreshCw, ShieldCheck, X } from 'lucide-react';
import {
  proxyListSessions,
  proxyLogoutAllSessions,
  proxyLogoutSession,
  type ProxySession,
  type ProxyUser,
} from '../../lib/apiProxy';
import { formatSessionDate, formatSessionDevice, formatSessionIp, sortSessionsForDisplay } from '../../lib/sessionDisplay';
import { cn } from '../../lib/utils';
import { FloatingWindow } from '../layout/FloatingWindow';
import { PanelButton } from '../ui/PanelButton';

interface AccountSecurityPanelProps {
  isOpen: boolean;
  currentUser?: ProxyUser | null;
  onClose: () => void;
  onSessionInvalidated: () => Promise<void> | void;
}

export function AccountSecurityPanel({ isOpen, currentUser, onClose, onSessionInvalidated }: AccountSecurityPanelProps) {
  const [sessions, setSessions] = useState<ProxySession[]>([]);
  const [loading, setLoading] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [loggingOutSessionId, setLoggingOutSessionId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const sortedSessions = useMemo(() => sortSessionsForDisplay(sessions), [sessions]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await proxyListSessions();
      setSessions(data.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : '会话列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadSessions();
  }, [isOpen, loadSessions]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 1800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const handleLogoutAll = async () => {
    const confirmed = window.confirm('这会让所有设备重新登录，包括当前设备。确定继续吗？');
    if (!confirmed) return;

    setLoggingOutAll(true);
    setError('');
    try {
      const result = await proxyLogoutAllSessions();
      setNotice(`已退出 ${result.deleted} 个登录设备`);
      await onSessionInvalidated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '退出所有设备失败');
    } finally {
      setLoggingOutAll(false);
    }
  };

  const handleLogoutSession = async (session: ProxySession) => {
    const confirmed = window.confirm(
      session.isCurrent
        ? '这会退出当前设备，需要重新登录。确定继续吗？'
        : '确定让这台设备退出登录吗？'
    );
    if (!confirmed) return;

    setLoggingOutSessionId(session.id);
    setError('');
    try {
      const result = await proxyLogoutSession(session.id);
      if (result.current) {
        await onSessionInvalidated();
        onClose();
        return;
      }
      setNotice('已退出所选设备');
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : '退出所选设备失败');
    } finally {
      setLoggingOutSessionId('');
    }
  };

  if (!isOpen) return null;

  return (
    <FloatingWindow placement="right" contentClassName="h-full w-full max-w-[440px] flex-col">
        <div className="border-b border-panel-border p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">账号安全</h2>
                {notice && <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">{notice}</span>}
              </div>
              <p className="mt-1 truncate text-xs text-gray-500">
                {currentUser?.name || currentUser?.email || currentUser?.username || '当前账号'}
              </p>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-700/60 hover:text-white" title="关闭">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 border-b border-panel-border px-4 py-3">
          <PanelButton
            onClick={() => void loadSessions()}
            disabled={loading}
            variant="secondary"
            size="sm"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            刷新设备
          </PanelButton>
          <PanelButton
            onClick={() => void handleLogoutAll()}
            disabled={loggingOutAll || sessions.length === 0}
            variant="danger"
            size="sm"
            className="ml-auto"
          >
            {loggingOutAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
            退出所有设备
          </PanelButton>
        </div>

        {error && (
          <div className="mx-4 mt-4 flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 overflow-auto p-4">
          {loading && sessions.length === 0 ? (
            <div className="flex h-40 items-center justify-center gap-2 text-xs text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载登录设备...
            </div>
          ) : sortedSessions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-panel-border p-6 text-center text-xs text-gray-500">
              暂时没有可显示的登录设备。
            </div>
          ) : (
            <div className="space-y-3">
              {sortedSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  isLoggingOut={loggingOutSessionId === session.id}
                  onLogout={() => void handleLogoutSession(session)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-panel-border px-4 py-3 text-[11px] leading-5 text-gray-500">
          你可以单独退出某台设备，也可以一键退出所有设备。退出当前设备后需要重新登录。
        </div>
    </FloatingWindow>
  );
}

function SessionCard({
  session,
  isLoggingOut,
  onLogout,
}: {
  session: ProxySession;
  isLoggingOut: boolean;
  onLogout: () => void;
}) {
  return (
    <article className="rounded-2xl border border-panel-border bg-canvas-bg/60 p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 text-gray-300">
          <MonitorSmartphone className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium text-white">{formatSessionDevice(session)}</h3>
            {session.isCurrent && (
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                当前设备
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-gray-500">{formatSessionIp(session)}</div>
          {session.userAgent && (
            <div className="mt-2 line-clamp-2 rounded-lg bg-black/20 px-2 py-1.5 text-[10px] leading-4 text-gray-500">
              {session.userAgent}
            </div>
          )}
        </div>
        <PanelButton
          onClick={onLogout}
          disabled={isLoggingOut}
          variant="danger"
          size="xs"
        >
          {isLoggingOut ? '退出中' : session.isCurrent ? '退出当前' : '退出设备'}
        </PanelButton>
      </div>

      <div className="mt-3 grid gap-2 text-[10px] text-gray-500 sm:grid-cols-2">
        <div className="flex items-center gap-1.5 rounded-lg bg-black/20 px-2 py-1.5">
          <Clock className="h-3 w-3" />
          登录 {formatSessionDate(session.createdAt)}
        </div>
        <div className="flex items-center gap-1.5 rounded-lg bg-black/20 px-2 py-1.5">
          <Clock className="h-3 w-3" />
          到期 {formatSessionDate(session.expiresAt)}
        </div>
      </div>
    </article>
  );
}
