import assert from 'node:assert/strict';
import test from 'node:test';
import {
  creditTransactionTone,
  formatCreditAmount,
  formatCreditDate,
  formatCreditTransactionType,
  summarizeCreditTransaction,
} from './creditDisplay';
import type { ProxyCreditTransaction } from './apiProxy';

test('credit display labels transaction types in Chinese', () => {
  assert.equal(formatCreditTransactionType('debit'), '扣费');
  assert.equal(formatCreditTransactionType('refund'), '退款');
  assert.equal(formatCreditTransactionType('admin_adjustment'), '管理员调整');
  assert.equal(formatCreditTransactionType('free_usage'), '用户 Key 免费');
});

test('credit display formats signed amounts and tones', () => {
  assert.equal(formatCreditAmount(100), '+100 积分');
  assert.equal(formatCreditAmount(-10), '-10 积分');
  assert.equal(formatCreditAmount(0), '0 积分');
  assert.equal(creditTransactionTone({ amount: -10, type: 'debit' }), 'danger');
  assert.equal(creditTransactionTone({ amount: 10, type: 'refund' }), 'success');
  assert.equal(creditTransactionTone({ amount: 0, type: 'free_usage' }), 'neutral');
});

test('credit display summarizes transactions without leaking metadata', () => {
  const transaction: ProxyCreditTransaction = {
    id: 'tx_1',
    userId: 'user_1',
    taskId: 'task_1',
    type: 'debit',
    amount: -10,
    balanceAfter: 90,
    reservedAfter: 0,
    description: 'image task queued.',
    metadata: { apiKey: 'should-not-render' },
    createdAt: '2026-07-07T12:00:00.000Z',
  };

  const summary = summarizeCreditTransaction(transaction);
  assert.match(summary, /扣费/);
  assert.match(summary, /-10 积分/);
  assert.match(summary, /task_1/);
  assert.doesNotMatch(summary, /should-not-render/);
  assert.notEqual(formatCreditDate(transaction.createdAt), '-');
});
