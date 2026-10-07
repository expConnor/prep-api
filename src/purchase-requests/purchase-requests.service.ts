import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.guard.js';
import type {
  AuditAction,
  Prisma,
  PurchaseRequest,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto.js';
import { UpdatePurchaseRequestDto } from './dto/update-purchase-request.dto.js';
import { type Action, canSee, checkAction } from './purchase-request.policy.js';

type Tx = Prisma.TransactionClient;

@Injectable()
export class PurchaseRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  create(user: AuthUser, body: CreatePurchaseRequestDto) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.purchaseRequest.create({
        data: {
          tenantId: user.tenantId,
          requesterId: user.id,
          title: body.title,
          description: body.description,
          vendor: body.vendor,
          amount: body.amount,
          currency: body.currency,
        },
      });
      await audit(tx, user, 'PURCHASE_REQUEST_CREATED', created.id, {
        before: null,
        after: created,
      });
      return created;
    });
  }

  findOne(user: AuthUser, id: string) {
    return findVisible(this.prisma, user, id);
  }

  update(user: AuthUser, id: string, body: UpdatePurchaseRequestDto) {
    return this.prisma.$transaction(async (tx) => {
      const before = await findActionable(tx, user, id, 'edit');
      // Conditional on the status just read, so a concurrent submit makes
      // this match nothing instead of editing a submitted request.
      const [after] = await tx.purchaseRequest.updateManyAndReturn({
        where: { id, tenantId: user.tenantId, status: before.status },
        data: body,
      });
      if (!after) throw new ConflictException();
      await audit(tx, user, 'PURCHASE_REQUEST_UPDATED', id, { before, after });
      return after;
    });
  }

  remove(user: AuthUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await findActionable(tx, user, id, 'delete');
      const { count } = await tx.purchaseRequest.deleteMany({
        where: { id, tenantId: user.tenantId, status: before.status },
      });
      if (count === 0) throw new ConflictException();
      await audit(tx, user, 'PURCHASE_REQUEST_DELETED', id, {
        before,
        after: null,
      });
    });
  }
}

async function findVisible(tx: Tx, user: AuthUser, id: string) {
  const request = await tx.purchaseRequest.findFirst({
    where: { id, tenantId: user.tenantId },
  });
  if (!request || !canSee(user, request)) throw new NotFoundException();
  return request;
}

async function findActionable(
  tx: Tx,
  user: AuthUser,
  id: string,
  action: Action,
) {
  const request = await findVisible(tx, user, id);
  const result = checkAction(user, request, action);
  if (result === 'forbidden') throw new ForbiddenException();
  if (result === 'conflict') throw new ConflictException();
  return request;
}

async function audit(
  tx: Tx,
  user: AuthUser,
  action: AuditAction,
  entityId: string,
  changes: { before: PurchaseRequest | null; after: PurchaseRequest | null },
) {
  await tx.auditLogEntry.create({
    data: {
      tenantId: user.tenantId,
      actorId: user.id,
      action,
      entityType: 'PURCHASE_REQUEST',
      entityId,
      changes,
    },
  });
}
