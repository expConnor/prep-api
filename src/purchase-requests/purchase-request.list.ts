import type { AuthUser } from '../auth/auth.guard.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { ListPurchaseRequestsQuery } from './dto/list-purchase-requests.query.js';

// The visibility part mirrors canSee: drafts are private to their owner, and
// requesters only see their own requests. Filters narrow it but never widen it.
export function listArgs(user: AuthUser, query: ListPurchaseRequestsQuery) {
  const visible: Prisma.PurchaseRequestWhereInput =
    user.role === 'REQUESTER'
      ? { requesterId: user.id }
      : { OR: [{ requesterId: user.id }, { status: { not: 'DRAFT' } }] };

  const filters: Prisma.PurchaseRequestWhereInput = {};
  if (query.status) filters.status = query.status;
  if (query.requesterId) filters.requesterId = query.requesterId;
  if (query.vendor) {
    filters.vendor = { equals: query.vendor, mode: 'insensitive' };
  }
  if (query.q) filters.title = { contains: query.q, mode: 'insensitive' };

  return {
    where: { tenantId: user.tenantId, AND: [visible, filters] },
    // id breaks ties so rows with the same sort value keep a stable order
    // across pages.
    orderBy: [{ [query.sort]: query.order }, { id: query.order }],
    skip: (query.page - 1) * query.limit,
    take: query.limit,
  } satisfies Prisma.PurchaseRequestFindManyArgs;
}
