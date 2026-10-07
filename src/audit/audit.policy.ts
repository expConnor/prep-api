import type { AuthUser } from '../auth/auth.guard.js';

export function canBrowseAuditLog(user: AuthUser): boolean {
  return user.role === 'ADMIN';
}
