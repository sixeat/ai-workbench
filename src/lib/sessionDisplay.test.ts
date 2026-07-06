import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSessionDate, formatSessionDevice, formatSessionIp, sortSessionsForDisplay } from './sessionDisplay';
import type { ProxySession } from './apiProxy';

test('session display handles browser, OS, IP, and invalid dates safely', () => {
  const session = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
    ipAddress: '203.0.113.8',
  };

  assert.equal(formatSessionDevice(session), 'Chrome / Windows');
  assert.equal(formatSessionIp(session), '203.0.113.8');
  assert.equal(formatSessionDate('not-a-date'), '-');
});

test('session display falls back for missing user agent and sorts current session first', () => {
  const sessions: ProxySession[] = [
    {
      id: 'old',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z',
      isCurrent: false,
    },
    {
      id: 'current',
      userAgent: '',
      ipAddress: '',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      expiresAt: '2025-01-02T00:00:00.000Z',
      isCurrent: true,
    },
  ];

  assert.equal(formatSessionDevice(sessions[1]), '未知设备');
  assert.equal(formatSessionIp(sessions[1]), '未知 IP');
  assert.deepEqual(sortSessionsForDisplay(sessions).map((session) => session.id), ['current', 'old']);
});
