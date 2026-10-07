import type { AuthUser } from '../auth/auth.guard.js';
import { listArgs } from './purchase-request.list.js';

const requester: AuthUser = { id: 'rita', tenantId: 'acme', role: 'REQUESTER' };
const approver: AuthUser = { id: 'abe', tenantId: 'acme', role: 'APPROVER' };
const admin: AuthUser = { id: 'ada', tenantId: 'acme', role: 'ADMIN' };

const defaults = {
  sort: 'createdAt',
  order: 'desc',
  page: 1,
  limit: 20,
} as const;

describe('listArgs', () => {
  it('limits a requester to their own requests in their tenant', () => {
    expect(listArgs(requester, defaults).where).toEqual({
      tenantId: 'acme',
      AND: [{ requesterId: 'rita' }, {}],
    });
  });

  it.each([approver, admin])(
    "shows an $role their own requests and other people's non-drafts",
    (user) => {
      expect(listArgs(user, defaults).where).toEqual({
        tenantId: 'acme',
        AND: [
          { OR: [{ requesterId: user.id }, { status: { not: 'DRAFT' } }] },
          {},
        ],
      });
    },
  );

  it('applies filters on top of visibility', () => {
    const { where } = listArgs(approver, {
      ...defaults,
      status: 'SUBMITTED',
      requesterId: 'rita',
      vendor: 'dell',
      q: 'laptop',
    });

    expect(where.AND).toEqual([
      expect.anything(),
      {
        status: 'SUBMITTED',
        requesterId: 'rita',
        vendor: { equals: 'dell', mode: 'insensitive' },
        title: { contains: 'laptop', mode: 'insensitive' },
      },
    ]);
  });

  it('sorts newest first by default, breaking ties by id', () => {
    expect(listArgs(requester, defaults).orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('sorts by amount in the requested direction', () => {
    expect(
      listArgs(requester, { ...defaults, sort: 'amount', order: 'asc' })
        .orderBy,
    ).toEqual([{ amount: 'asc' }, { id: 'asc' }]);
  });

  it('turns page and limit into an offset', () => {
    expect(
      listArgs(requester, { ...defaults, page: 3, limit: 25 }),
    ).toMatchObject({ skip: 50, take: 25 });
  });
});
