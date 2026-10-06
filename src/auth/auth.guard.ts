import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type AuthUser = Pick<User, 'id' | 'tenantId' | 'role'>;

export type AuthenticatedRequest = Request & { user: AuthUser };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException();
    }

    let payload: { sub: string; tenantId: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException();
    }

    // Looked up on every request, by tenant and id together, so a deleted
    // user, a changed role or a token whose tenant doesn't own the user takes
    // effect immediately instead of when the token expires.
    const user = await this.prisma.user.findUnique({
      where: { tenantId_id: { tenantId: payload.tenantId, id: payload.sub } },
      select: { id: true, tenantId: true, role: true },
    });
    if (!user) {
      throw new UnauthorizedException();
    }

    request.user = user;
    return true;
  }
}
