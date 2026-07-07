import type { ProxyCreditTransaction } from './apiProxy';

export function formatCreditTransactionType(type: string): string {
  if (type === 'grant') return '充值';
  if (type === 'debit') return '扣费';
  if (type === 'refund') return '退款';
  if (type === 'admin_adjustment') return '管理员调整';
  if (type === 'free_usage') return '用户 Key 免费';
  return type || '未知流水';
}

export function formatCreditAmount(amount: number): string {
  const value = Number.isFinite(amount) ? Math.trunc(amount) : 0;
  if (value > 0) return `+${value} 积分`;
  if (value < 0) return `${value} 积分`;
  return '0 积分';
}

export function creditTransactionTone(transaction: Pick<ProxyCreditTransaction, 'amount' | 'type'>): 'success' | 'danger' | 'neutral' {
  if (transaction.type === 'debit' || transaction.amount < 0) return 'danger';
  if (transaction.amount > 0 || transaction.type === 'refund' || transaction.type === 'grant') return 'success';
  return 'neutral';
}

export function formatCreditDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN');
}

export function summarizeCreditTransaction(transaction: ProxyCreditTransaction): string {
  const parts = [
    formatCreditTransactionType(transaction.type),
    formatCreditAmount(transaction.amount),
  ];
  if (transaction.taskId) parts.push(`任务 ${transaction.taskId}`);
  if (transaction.description) parts.push(transaction.description);
  return parts.join(' · ');
}
