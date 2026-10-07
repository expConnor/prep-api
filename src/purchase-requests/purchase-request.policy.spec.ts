import type { AuthUser } from '../auth/auth.guard.js';
import { canSee, checkAction } from './purchase-request.policy.js';

const requester: AuthUser = { id: 'rita', tenantId: 'acme', role: 'REQUESTER' };
const approver: AuthUser = { id: 'abe', tenantId: 'acme', role: 'APPROVER' };
const admin: AuthUser = { id: 'ada', tenantId: 'acme', role: 'ADMIN' };

describe('canSee', () => {
  it('shows an owner their own draft', () => {
    expect(canSee(requester, { requesterId: 'rita', status: 'DRAFT' })).toBe(
      true,
    );
  });

  it('hides a draft from everyone but its owner', () => {
    expect(canSee(admin, { requesterId: 'rita', status: 'DRAFT' })).toBe(false);
  });

  it("hides other people's submitted requests from a requester", () => {
    expect(canSee(requester, { requesterId: 'abe', status: 'SUBMITTED' })).toBe(
      false,
    );
  });

  it.each(['SUBMITTED', 'APPROVED', 'REJECTED'] as const)(
    'shows a requester their own %s request',
    (status) => {
      expect(canSee(requester, { requesterId: 'rita', status })).toBe(true);
    },
  );

  it.each(['SUBMITTED', 'APPROVED', 'REJECTED'] as const)(
    "shows an approver other people's %s requests",
    (status) => {
      expect(canSee(approver, { requesterId: 'rita', status })).toBe(true);
    },
  );

  it("shows an admin other people's non-draft requests", () => {
    expect(canSee(admin, { requesterId: 'rita', status: 'SUBMITTED' })).toBe(
      true,
    );
  });
});

describe('checkAction', () => {
  describe.each(['submit', 'edit', 'delete'] as const)('%s', (action) => {
    it.each([requester, approver, admin])(
      'lets the owner $role act on their draft',
      (owner) => {
        expect(
          checkAction(
            owner,
            { requesterId: owner.id, status: 'DRAFT' },
            action,
          ),
        ).toBe('ok');
      },
    );

    it("forbids acting on someone else's request", () => {
      expect(
        checkAction(
          admin,
          { requesterId: 'rita', status: 'SUBMITTED' },
          action,
        ),
      ).toBe('forbidden');
    });

    it('refuses a request that is no longer a draft', () => {
      expect(
        checkAction(
          requester,
          { requesterId: 'rita', status: 'SUBMITTED' },
          action,
        ),
      ).toBe('conflict');
    });
  });

  describe.each(['approve', 'reject'] as const)('%s', (action) => {
    it("lets an approver decide someone else's submitted request", () => {
      expect(
        checkAction(
          approver,
          { requesterId: 'rita', status: 'SUBMITTED' },
          action,
        ),
      ).toBe('ok');
    });

    it("lets an admin decide someone else's submitted request", () => {
      expect(
        checkAction(
          admin,
          { requesterId: 'rita', status: 'SUBMITTED' },
          action,
        ),
      ).toBe('ok');
    });

    it('forbids a requester from deciding', () => {
      expect(
        checkAction(
          requester,
          { requesterId: 'abe', status: 'SUBMITTED' },
          action,
        ),
      ).toBe('forbidden');
    });

    it('forbids deciding your own request', () => {
      expect(
        checkAction(admin, { requesterId: 'ada', status: 'SUBMITTED' }, action),
      ).toBe('forbidden');
    });

    it.each(['APPROVED', 'REJECTED'] as const)(
      'refuses a request that is already %s',
      (status) => {
        expect(
          checkAction(approver, { requesterId: 'rita', status }, action),
        ).toBe('conflict');
      },
    );

    it('reports forbidden before conflict', () => {
      expect(
        checkAction(admin, { requesterId: 'ada', status: 'APPROVED' }, action),
      ).toBe('forbidden');
    });
  });
});
