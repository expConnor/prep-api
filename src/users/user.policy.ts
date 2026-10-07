import type { AuthUser } from '../auth/auth.guard.js';

export function canManageUsers(user: AuthUser): boolean {
  return user.role === 'ADMIN';
}

// Admins can't change their own role, so the last admin can never demote
// themselves and leave the tenant without one.
export function canChangeRole(admin: AuthUser, targetId: string): boolean {
  return admin.id !== targetId;
}
