import type { AuthUser } from '../auth/auth.guard.js';
import { canChangeRole, canManageUsers } from './user.policy.js';

const admin: AuthUser = { id: 'ada', tenantId: 'acme', role: 'ADMIN' };

describe('canManageUsers', () => {
  it('lets an admin manage users', () => {
    expect(canManageUsers(admin)).toBe(true);
  });

  it.each(['REQUESTER', 'APPROVER'] as const)(
    'forbids the %s role from managing users',
    (role) => {
      expect(canManageUsers({ ...admin, role })).toBe(false);
    },
  );
});

describe('canChangeRole', () => {
  it("lets an admin change someone else's role", () => {
    expect(canChangeRole(admin, 'rita')).toBe(true);
  });

  it('forbids an admin from changing their own role', () => {
    expect(canChangeRole(admin, 'ada')).toBe(false);
  });
});
