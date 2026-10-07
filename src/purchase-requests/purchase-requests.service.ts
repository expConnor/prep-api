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
import { ListPurchaseRequestsQuery } from './dto/list-purchase-requests.query.js';
import { UpdatePurchaseRequestDto } from './dto/update-purchase-request.dto.js';
import { listArgs } from './purchase-request.list.js';
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

  async list(user: AuthUser, query: ListPurchaseRequestsQuery) {
    const { where, orderBy, skip, take } = listArgs(user, query);
    // One transaction so the total counts the same rows the page comes from.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.purchaseRequest.findMany({ where, orderBy, skip, take }),
      this.prisma.purchaseRequest.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  findOne(user: AuthUser, id: string) {
    return findVisible(this.prisma, user, id);
  }

  async history(user: AuthUser, id: string) {
    await findVisible(this.prisma, user, id);
    return this.prisma.auditLogEntry.findMany({
      where: {
        tenantId: user.tenantId,
        entityType: 'PURCHASE_REQUEST',
        entityId: id,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  update(user: AuthUser, id: string, body: UpdatePurchaseRequestDto) {
    return this.change(user, id, 'edit', 'PURCHASE_REQUEST_UPDATED', body);
  }

  submit(user: AuthUser, id: string) {
    return this.change(user, id, 'submit', 'PURCHASE_REQUEST_SUBMITTED', {
      status: 'SUBMITTED',
      submittedAt: new Date(),
    });
  }

  approve(user: AuthUser, id: string) {
    return this.change(user, id, 'approve', 'PURCHASE_REQUEST_APPROVED', {
      status: 'APPROVED',
      decidedById: user.id,
      decidedAt: new Date(),
    });
  }

  reject(user: AuthUser, id: string, reason: string) {
    return this.change(user, id, 'reject', 'PURCHASE_REQUEST_REJECTED', {
      status: 'REJECTED',
      decidedById: user.id,
      decidedAt: new Date(),
      rejectionReason: reason,
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

  private change(
    user: AuthUser,
    id: string,
    action: Action,
    auditAction: AuditAction,
    data: Prisma.PurchaseRequestUncheckedUpdateManyInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await findActionable(tx, user, id, action);
      // Conditional on the status just read: if someone else changed it in
      // the meantime, this matches nothing and the caller gets a 409.
      const [after] = await tx.purchaseRequest.updateManyAndReturn({
        where: { id, tenantId: user.tenantId, status: before.status },
        data,
      });
      if (!after) throw new ConflictException();
      await audit(tx, user, auditAction, id, { before, after });
      return after;
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
