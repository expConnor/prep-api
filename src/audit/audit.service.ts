import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.guard.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { canBrowseAuditLog } from './audit.policy.js';
import { ListAuditLogsQuery } from './dto/list-audit-logs.query.js';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, query: ListAuditLogsQuery) {
    if (!canBrowseAuditLog(user)) throw new ForbiddenException();
    const where: Prisma.AuditLogEntryWhereInput = { tenantId: user.tenantId };
    // One transaction so the total counts the same rows the page comes from.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLogEntry.findMany({
        where,
        // id breaks ties so entries with the same timestamp keep a stable
        // order across pages.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLogEntry.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }
}
