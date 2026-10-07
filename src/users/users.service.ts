import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.guard.js';
import { hashPassword } from '../auth/password.js';
import { Prisma, type Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { canChangeRole, canManageUsers } from './user.policy.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: AuthUser) {
    assertAdmin(user);
    return this.prisma.user.findMany({
      where: { tenantId: user.tenantId },
      omit: { passwordHash: true },
      orderBy: { email: 'asc' },
    });
  }

  async create(user: AuthUser, body: CreateUserDto) {
    assertAdmin(user);
    const passwordHash = await hashPassword(body.password);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            tenantId: user.tenantId,
            email: body.email.toLowerCase(),
            name: body.name,
            passwordHash,
            role: body.role,
          },
          omit: { passwordHash: true },
        });
        await tx.auditLogEntry.create({
          data: {
            tenantId: user.tenantId,
            actorId: user.id,
            action: 'USER_CREATED',
            entityType: 'USER',
            entityId: created.id,
            changes: { before: null, after: created },
          },
        });
        return created;
      });
    } catch (error) {
      // The email is unique within the tenant.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email already in use');
      }
      throw error;
    }
  }

  changeRole(user: AuthUser, id: string, role: Role) {
    assertAdmin(user);
    return this.prisma.$transaction(async (tx) => {
      const where = { tenantId_id: { tenantId: user.tenantId, id } };
      const before = await tx.user.findUnique({
        where,
        omit: { passwordHash: true },
      });
      if (!before) throw new NotFoundException();
      if (!canChangeRole(user, id)) throw new ForbiddenException();
      const after = await tx.user.update({
        where,
        data: { role },
        omit: { passwordHash: true },
      });
      await tx.auditLogEntry.create({
        data: {
          tenantId: user.tenantId,
          actorId: user.id,
          action: 'USER_ROLE_CHANGED',
          entityType: 'USER',
          entityId: id,
          changes: { before, after },
        },
      });
      return after;
    });
  }
}

function assertAdmin(user: AuthUser) {
  if (!canManageUsers(user)) throw new ForbiddenException();
}
