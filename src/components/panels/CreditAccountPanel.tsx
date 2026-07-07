import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Coins, Loader2, RefreshCw, X } from 'lucide-react';
import {
  proxyGetMyCredits,
  proxyListMyCreditTransactions,
  type ProxyCreditAccount,
  type ProxyCreditTransaction,
  type ProxyUser,
} from '../../lib/apiProxy';
import {
  creditTransactionTone,
  formatCreditAmount,
  formatCreditDate,
  formatCreditTransactionType,
} from '../../lib/creditDisplay';
import { cn } from '../../lib/utils';
import { FloatingWindow } from '../layout/FloatingWindow';

const PAGE_SIZE = 40;

interface CreditAccountPanelProps {
  currentUser?: ProxyUser | null;
  isOpen: boolean;
  onAccountLoaded?: (account: ProxyCreditAccount) => void;
  onClose: () => void;
}

export function CreditAccountPanel({ currentUser, isOpen, onAccountLoaded, onClose }: CreditAccountPanelProps) {
  const [account, setAccount] = useState<ProxyCreditAccount | null>(null);
  const [transactions, setTransactions] = useState<ProxyCreditTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const hasMore = transactions.length < total;
  const userLabel = useMemo(
    () => currentUser?.name || currentUser?.email || currentUser?.username || '当前账号',
    [currentUser]
  );

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [accountResult, transactionResult] = await Promise.all([
        proxyGetMyCredits(),
        proxyListMyCreditTransactions({ limit: PAGE_SIZE, offset: 0 }),
      ]);
      setAccount(accountResult.account);
      setTransactions(transactionResult.transactions);
      setTotal(transactionResult.total);
      onAccountLoaded?.(accountResult.account);
    } catch (err) {
      setError(err instanceof Error ? err.message : '积分信息加载失败');
    } finally {
      setLoading(false);
    }
  }, [onAccountLoaded]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    setError('');
    try {
      const data = await proxyListMyCreditTransactions({
        limit: PAGE_SIZE,
        offset: transactions.length,
      });
      setTransactions((current) => mergeTransactions(current, data.transactions));
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '积分流水加载失败');
    } finally {
      setLoadingMore(false);
    }
  }, [transactions.length]);

  useEffect(() => {
    if (!isOpen) return;
    void loadFirstPage();
  }, [isOpen, loadFirstPage]);

  if (!isOpen) return null;

  return (
    <FloatingWindow placement="right" contentClassName="h-full w-full max-w-[460px] flex-col">
      <div className="border-b border-panel-border p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
            <Coins className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-white">我的积分</h2>
            <p className="mt-1 truncate text-xs text-gray-500">{userLabel}</p>
          </div>
          <button
            onClick={() => void loadFirstPage()}
            disabled={loading}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-700/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            title="刷新积分"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-700/60 hover:text-white" title="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-4 flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-4 overflow-auto p-4">
        <section className="rounded-2xl border border-panel-border bg-canvas-bg/60 p-4">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">当前余额</div>
          <div className="mt-2 text-3xl font-semibold text-white">{account?.balance ?? 0}</div>
          <div className="mt-1 text-xs text-gray-500">积分不足时，服务器托管 Key 的任务会被后端拒绝。</div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-[10px]">
            <Metric label="累计获得" value={account?.totalGranted ?? 0} />
            <Metric label="累计消耗" value={account?.totalUsed ?? 0} />
            <Metric label="冻结中" value={account?.reservedBalance ?? 0} />
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">积分流水</h3>
            <span className="text-[10px] text-gray-500">已加载 {transactions.length}/{total || transactions.length}</span>
          </div>

          {loading && transactions.length === 0 ? (
            <div className="flex h-36 items-center justify-center gap-2 rounded-2xl border border-panel-border text-xs text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载积分流水...
            </div>
          ) : transactions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-panel-border p-6 text-center text-xs text-gray-500">
              暂时没有积分流水。
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-panel-border">
              {transactions.map((transaction) => (
                <CreditTransactionRow key={transaction.id} transaction={transaction} />
              ))}
            </div>
          )}

          {hasMore && (
            <div className="mt-3 flex justify-center">
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-lg border border-panel-border px-3 py-1.5 text-xs text-gray-300 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                加载更多流水
              </button>
            </div>
          )}
        </section>
      </div>
    </FloatingWindow>
  );
}

function mergeTransactions(current: ProxyCreditTransaction[], next: ProxyCreditTransaction[]): ProxyCreditTransaction[] {
  const items = new Map<string, ProxyCreditTransaction>();
  for (const item of current) items.set(item.id, item);
  for (const item of next) items.set(item.id, item);
  return Array.from(items.values());
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-panel-bg/70 px-3 py-2">
      <div className="text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-gray-100">{value}</div>
    </div>
  );
}

function CreditTransactionRow({ transaction }: { transaction: ProxyCreditTransaction }) {
  const tone = creditTransactionTone(transaction);
  return (
    <article className="grid grid-cols-[1fr_auto] gap-3 border-b border-panel-border bg-canvas-bg/50 px-3 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-white">{formatCreditTransactionType(transaction.type)}</span>
          {transaction.taskId && (
            <span className="max-w-[180px] truncate rounded bg-panel-bg px-1.5 py-0.5 text-[10px] text-gray-500" title={transaction.taskId}>
              任务 {transaction.taskId}
            </span>
          )}
        </div>
        <div className="mt-1 truncate text-[10px] text-gray-500" title={transaction.description || ''}>
          {transaction.description || '无备注'} · {formatCreditDate(transaction.createdAt)}
        </div>
      </div>
      <div className="text-right">
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
    </article>
  );
}
