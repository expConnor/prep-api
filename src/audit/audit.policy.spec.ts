import type { AuthUser } from '../auth/auth.guard.js';
import { canBrowseAuditLog } from './audit.policy.js';

const admin: AuthUser = { id: 'ada', tenantId: 'acme', role: 'ADMIN' };

describe('canBrowseAuditLog', () => {
  it("lets an admin browse the tenant's audit log", () => {
    expect(canBrowseAuditLog(admin)).toBe(true);
  });

  it.each(['REQUESTER', 'APPROVER'] as const)(
    "forbids the %s role from browsing the tenant's audit log",
    (role) => {
      expect(canBrowseAuditLog({ ...admin, role })).toBe(false);
    },
  );
});
