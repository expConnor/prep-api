import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { hashPassword } from '../src/auth/password.js';
import { Role } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let acme: string;
  let globex: string;
  let alice: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.auditLogEntry.deleteMany();
    await prisma.purchaseRequest.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tenant.deleteMany();

    acme = (
      await prisma.tenant.create({ data: { slug: 'acme', name: 'Acme' } })
    ).id;
    globex = (
      await prisma.tenant.create({ data: { slug: 'globex', name: 'Globex' } })
    ).id;
    alice = (await createUser(acme, 'alice@acme.test', 'acme-password')).id;
    // Same email in another tenant, so login has to pick the tenant by slug.
    await createUser(globex, 'alice@acme.test', 'globex-password');
  });

  afterAll(async () => {
    await app.close();
  });

  async function createUser(
    tenantId: string,
    email: string,
    password: string,
    role: Role = 'APPROVER',
  ) {
    return prisma.user.create({
      data: {
        tenantId,
        email,
        name: 'Alice',
        passwordHash: await hashPassword(password),
        role,
      },
    });
  }

  function login(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/api/v1/auth/login').send(body);
  }

  async function tokenFor(
    tenantSlug: string,
    email: string,
    password: string,
  ): Promise<string> {
    const res = await login({ tenantSlug, email, password }).expect(200);
    return res.body.accessToken;
  }

  function me(token?: string) {
    const req = request(app.getHttpServer()).get('/api/v1/auth/me');
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  describe('POST /auth/login', () => {
    it('returns an access token for valid credentials', async () => {
      const res = await login({
        tenantSlug: 'acme',
        email: 'alice@acme.test',
        password: 'acme-password',
      }).expect(200);

      expect(res.body).toEqual({ accessToken: expect.any(String) });
    });

    it('accepts the email in any case', async () => {
      await login({
        tenantSlug: 'acme',
        email: 'Alice@ACME.test',
        password: 'acme-password',
      }).expect(200);
    });

    it('logs into the tenant named by the slug when the email exists in several tenants', async () => {
      const token = await tokenFor(
        'globex',
        'alice@acme.test',
        'globex-password',
      );

      const res = await me(token).expect(200);
      expect(res.body.tenantId).toBe(globex);
    });

    it('rejects a password that belongs to the same email in another tenant', async () => {
      await login({
        tenantSlug: 'acme',
        email: 'alice@acme.test',
        password: 'globex-password',
      }).expect(401);
    });

    it('gives the same 401 for a wrong password, unknown email or unknown tenant', async () => {
      const wrongPassword = await login({
        tenantSlug: 'acme',
        email: 'alice@acme.test',
        password: 'nope',
      }).expect(401);
      const unknownEmail = await login({
        tenantSlug: 'acme',
        email: 'nobody@acme.test',
        password: 'acme-password',
      }).expect(401);
      const unknownTenant = await login({
        tenantSlug: 'initech',
        email: 'alice@acme.test',
        password: 'acme-password',
      }).expect(401);

      expect(unknownEmail.body).toEqual(wrongPassword.body);
      expect(unknownTenant.body).toEqual(wrongPassword.body);
    });

    // Password hashing dominates login time, so skipping it for unknown users
    // would make them answer several times faster than a wrong password. The
    // threshold is loose so normal timing noise doesn't fail the test.
    it('takes about as long for an unknown email or tenant as for a wrong password', async () => {
      async function medianMs(body: Record<string, unknown>) {
        const times: number[] = [];
        for (let i = 0; i < 5; i++) {
          const start = performance.now();
          await login(body).expect(401);
          times.push(performance.now() - start);
        }
        return times.sort((a, b) => a - b)[2];
      }

      const wrongPassword = await medianMs({
        tenantSlug: 'acme',
        email: 'alice@acme.test',
        password: 'nope',
      });
      const unknownEmail = await medianMs({
        tenantSlug: 'acme',
        email: 'nobody@acme.test',
        password: 'nope',
      });
      const unknownTenant = await medianMs({
        tenantSlug: 'initech',
        email: 'alice@acme.test',
        password: 'nope',
      });

      expect(unknownEmail).toBeGreaterThan(wrongPassword / 2);
      expect(unknownTenant).toBeGreaterThan(wrongPassword / 2);
    });

    it('rejects a request with missing fields', async () => {
      await login({ tenantSlug: 'acme', email: 'alice@acme.test' }).expect(400);
    });

    it('rejects unknown fields such as a client-supplied tenant id', async () => {
      await login({
        tenantSlug: 'acme',
        email: 'alice@acme.test',
        password: 'acme-password',
        tenantId: globex,
      }).expect(400);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the current user without the password hash', async () => {
      const token = await tokenFor('acme', 'alice@acme.test', 'acme-password');

      const res = await me(token).expect(200);

      expect(res.body).toEqual({
        id: alice,
        tenantId: acme,
        email: 'alice@acme.test',
        name: 'Alice',
        role: 'APPROVER',
      });
    });

    it('reflects a role change without logging in again', async () => {
      const bob = await createUser(acme, 'bob@acme.test', 'bob-password');
      const token = await tokenFor('acme', 'bob@acme.test', 'bob-password');

      await prisma.user.update({
        where: { id: bob.id },
        data: { role: 'REQUESTER' },
      });

      const res = await me(token).expect(200);
      expect(res.body.role).toBe('REQUESTER');
    });

    it('rejects a request without a token', async () => {
      await me().expect(401);
    });

    it('rejects a malformed token', async () => {
      await me('not-a-jwt').expect(401);
    });

    it('rejects a token signed with another secret', async () => {
      const forged = await new JwtService({
        secret: 'not-the-secret',
      }).signAsync({ sub: alice, tenantId: acme });

      await me(forged).expect(401);
    });

    it('rejects an expired token', async () => {
      const expired = await new JwtService({
        secret: process.env.JWT_SECRET,
      }).signAsync({
        sub: alice,
        tenantId: acme,
        exp: Math.floor(Date.now() / 1000) - 60,
      });

      await me(expired).expect(401);
    });

    it('rejects a token whose tenant does not match the user', async () => {
      const crossTenant = await new JwtService({
        secret: process.env.JWT_SECRET,
      }).signAsync({ sub: alice, tenantId: globex });

      await me(crossTenant).expect(401);
    });

    it('rejects a token whose user no longer exists', async () => {
      const carol = await createUser(acme, 'carol@acme.test', 'carol-password');
      const token = await tokenFor('acme', 'carol@acme.test', 'carol-password');

      await prisma.user.delete({ where: { id: carol.id } });

      await me(token).expect(401);
    });
  });
});
