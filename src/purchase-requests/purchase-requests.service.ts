import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto.js';
import { canSee } from './purchase-request.policy.js';

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
      await tx.auditLogEntry.create({
        data: {
          tenantId: user.tenantId,
          actorId: user.id,
          action: 'PURCHASE_REQUEST_CREATED',
          entityType: 'PURCHASE_REQUEST',
          entityId: created.id,
          changes: { before: null, after: created },
        },
      });
      return created;
    });
  }

  async findOne(user: AuthUser, id: string) {
    const request = await this.prisma.purchaseRequest.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!request || !canSee(user, request)) throw new NotFoundException();
    return request;
  }
}
