import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from './auth.guard.js';
import { LoginDto } from './dto/login.dto.js';
import { hashPassword, verifyPassword } from './password.js';

// Checked against when no user matches, so a miss costs as much as a wrong password.
const dummyHash = hashPassword('no-such-user');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login({ tenantSlug, email, password }: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), tenant: { slug: tenantSlug } },
    });
    // One error for every failure, and a password check even when there is no
    // user, so neither the response nor its timing reveals which part was wrong.
    const valid = await verifyPassword(
      password,
      user?.passwordHash ?? (await dummyHash),
    );
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      tenantId: user.tenantId,
    });
    return { accessToken };
  }

  me({ tenantId, id }: AuthUser) {
    return this.prisma.user.findUniqueOrThrow({
      where: { tenantId_id: { tenantId, id } },
      select: { id: true, tenantId: true, email: true, name: true, role: true },
    });
  }
}
