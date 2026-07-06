import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

export function joinUrl(baseUrl: string, path: string): string {
  const base = (baseUrl || '').trim().replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (!base) return normalizedPath;

  if (base.endsWith(normalizedPath)) {
    return base;
  }

  const duplicatePrefix = normalizedPath.match(/^\/(v\d+)(\/.*)$/i);
  if (duplicatePrefix && base.endsWith(`/${duplicatePrefix[1]}`)) {
    return `${base}${duplicatePrefix[2]}`;
  }

  return `${base}${normalizedPath}`;
}
