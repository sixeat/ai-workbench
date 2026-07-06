export interface AuthDisplayUser {
  name?: string;
  email?: string;
  username?: string;
  role?: string;
}

export function deploymentLabel(mode?: string): string {
  if (mode === 'server') return '服务器模式';
  if (mode === 'local') return '本地模式';
  return mode || '';
}

export function roleLabel(role?: string): string {
  if (role === 'admin') return '管理员';
  if (role === 'user') return '普通用户';
  if (role === 'local') return '本地用户';
  return role || '';
}

export function accountDisplayName(user?: AuthDisplayUser | null, deploymentMode?: string): string {
  if (user) return user.name || user.email || user.username || '当前账号';
  if (deploymentMode === 'server') return '令牌访问';
  if (deploymentMode === 'local') return '本地访问';
  return '未登录';
}
