import type { AuthUser } from '../auth/auth.guard.js';
import type { PurchaseRequest } from '../generated/prisma/client.js';

// Tenant isolation is not checked here: every query is scoped by tenantId, so
// another tenant's request never reaches these functions.

type RequestState = Pick<PurchaseRequest, 'requesterId' | 'status'>;

export type Action = 'submit' | 'edit' | 'delete' | 'approve' | 'reject';

export function canSee(user: AuthUser, request: RequestState): boolean {
  if (request.requesterId === user.id) return true;
  return request.status !== 'DRAFT' && user.role !== 'REQUESTER';
}

// Callers check canSee first; this assumes the request is visible. Who may act
// is checked before the state so that a forbidden action never reports a
// conflict.
export function checkAction(
  user: AuthUser,
  request: RequestState,
  action: Action,
): 'ok' | 'forbidden' | 'conflict' {
  const isOwner = request.requesterId === user.id;

  if (action === 'approve' || action === 'reject') {
    if (user.role === 'REQUESTER' || isOwner) return 'forbidden';
    return request.status === 'SUBMITTED' ? 'ok' : 'conflict';
  }

  if (!isOwner) return 'forbidden';
  return request.status === 'DRAFT' ? 'ok' : 'conflict';
}
