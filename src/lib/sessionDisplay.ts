import type { ProxySession } from './apiProxy';

function detectBrowser(userAgent: string): string {
  if (/Edg\//.test(userAgent)) return 'Edge';
  if (/Firefox\//.test(userAgent)) return 'Firefox';
  if (/Chrome\//.test(userAgent) || /CriOS\//.test(userAgent)) return 'Chrome';
  if (/Safari\//.test(userAgent)) return 'Safari';
  return '未知浏览器';
}

function detectOs(userAgent: string): string {
  if (/Windows NT/i.test(userAgent)) return 'Windows';
  if (/Mac OS X/i.test(userAgent) && /Mobile/i.test(userAgent)) return 'iOS';
  if (/Mac OS X/i.test(userAgent)) return 'macOS';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return '未知系统';
}

export function formatSessionDevice(session: Pick<ProxySession, 'userAgent'>): string {
  const userAgent = session.userAgent?.trim();
  if (!userAgent) return '未知设备';
  return `${detectBrowser(userAgent)} / ${detectOs(userAgent)}`;
}

export function formatSessionIp(session: Pick<ProxySession, 'ipAddress'>): string {
  return session.ipAddress?.trim() || '未知 IP';
}

export function formatSessionDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN');
}

export function sortSessionsForDisplay(sessions: ProxySession[]): ProxySession[] {
  return [...sessions].sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}
