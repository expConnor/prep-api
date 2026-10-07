import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import type { Role, User } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let rita: User;
  let abe: User;
  let ada: User;
  let gus: User;

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

    const acme = (
      await prisma.tenant.create({ data: { slug: 'acme', name: 'Acme' } })
    ).id;
    const globex = (
      await prisma.tenant.create({ data: { slug: 'globex', name: 'Globex' } })
    ).id;
    rita = await createUser(acme, 'rita', 'REQUESTER');
    abe = await createUser(acme, 'abe', 'APPROVER');
    ada = await createUser(acme, 'ada', 'ADMIN');
    gus = await createUser(globex, 'gus', 'ADMIN');
  });

  afterAll(async () => {
    await app.close();
  });

  function createUser(tenantId: string, name: string, role: Role) {
    return prisma.user.create({
      data: {
        tenantId,
        email: `${name}@test`,
        name,
        passwordHash: 'unused',
        role,
      },
    });
  }

  // Signed directly rather than via login, which skips password hashing.
  function as(user?: User) {
    const server = request(app.getHttpServer());
    const auth = (req: request.Test) =>
      user
        ? req.set(
            'Authorization',
            `Bearer ${app.get(JwtService).sign({ sub: user.id, tenantId: user.tenantId })}`,
          )
        : req;
    return {
      get: (path: string) => auth(server.get(`/api/v1${path}`)),
      post: (path: string, body?: object) =>
        auth(server.post(`/api/v1${path}`)).send(body),
      patch: (path: string, body?: object) =>
        auth(server.patch(`/api/v1${path}`)).send(body),
    };
  }

  describe('GET /users', () => {
    it("lists the admin's tenant by email, without password hashes", async () => {
      const res = await as(ada).get('/users').expect(200);

      expect(res.body.map((u: User) => u.email)).toEqual([
        'abe@test',
        'ada@test',
        'rita@test',
      ]);
      expect(res.body[0]).toEqual({
        id: abe.id,
        tenantId: abe.tenantId,
        email: 'abe@test',
        name: 'abe',
        role: 'APPROVER',
        createdAt: abe.createdAt.toISOString(),
        updatedAt: abe.updatedAt.toISOString(),
      });
    });

    it.each(['rita', 'abe'])(
      'forbids %s, who is not an admin',
      async (name) => {
        const caller = { rita, abe }[name as 'rita' | 'abe'];
        await as(caller).get('/users').expect(403);
      },
    );

    it('requires a token', async () => {
      await as().get('/users').expect(401);
    });
  });

  describe('POST /users', () => {
    const newUser = {
      email: 'nina@acme.test',
      name: 'Nina',
      password: 'correct horse',
      role: 'APPROVER',
    };

    afterEach(async () => {
      await prisma.auditLogEntry.deleteMany();
      await prisma.user.deleteMany({ where: { name: 'Nina' } });
    });

    it("creates a user in the admin's tenant who can then log in", async () => {
      const res = await as(ada).post('/users', newUser).expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        tenantId: ada.tenantId,
        email: 'nina@acme.test',
        name: 'Nina',
        role: 'APPROVER',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          tenantSlug: 'acme',
          email: 'nina@acme.test',
          password: 'correct horse',
        })
        .expect(200);
    });

    it('stores the email in lowercase', async () => {
      const res = await as(ada)
        .post('/users', { ...newUser, email: 'Nina@ACME.test' })
        .expect(201);

      expect(res.body.email).toBe('nina@acme.test');
    });

    it('records the creation in the audit log, without the password hash', async () => {
      const res = await as(ada).post('/users', newUser).expect(201);

      const entries = await prisma.auditLogEntry.findMany({
        where: { entityId: res.body.id },
      });
      expect(entries).toEqual([
        expect.objectContaining({
          tenantId: ada.tenantId,
          actorId: ada.id,
          action: 'USER_CREATED',
          entityType: 'USER',
          changes: { before: null, after: res.body },
        }),
      ]);
    });

    it('refuses an email already used in the same tenant', async () => {
      await as(ada).post('/users', newUser).expect(201);

      await as(ada)
        .post('/users', { ...newUser, email: 'NINA@acme.test' })
        .expect(409);
    });

    it('allows an email already used in another tenant', async () => {
      await as(gus).post('/users', newUser).expect(201);

      await as(ada).post('/users', newUser).expect(201);
    });

    it.each([
      ['an invalid email', { email: 'nina' }],
      ['a blank name', { name: '   ' }],
      ['a short password', { password: 'short' }],
      ['an unknown role', { role: 'OWNER' }],
      [
        'an unknown field',
        { tenantId: '00000000-0000-0000-0000-000000000000' },
      ],
    ])('rejects %s', async (_, override) => {
      await as(ada)
        .post('/users', { ...newUser, ...override })
        .expect(400);
    });

    it.each(['rita', 'abe'])(
      'forbids %s, who is not an admin',
      async (name) => {
        const caller = { rita, abe }[name as 'rita' | 'abe'];
        await as(caller).post('/users', newUser).expect(403);
      },
    );
  });

  describe('PATCH /users/:id/role', () => {
    afterEach(async () => {
      await prisma.auditLogEntry.deleteMany();
      await prisma.purchaseRequest.deleteMany();
      await prisma.user.update({
        where: { id: abe.id },
        data: { role: 'APPROVER' },
      });
    });

    it('changes the role and records the before and after', async () => {
      const res = await as(ada)
        .patch(`/users/${abe.id}/role`, { role: 'REQUESTER' })
        .expect(200);

      expect(res.body).toMatchObject({ id: abe.id, role: 'REQUESTER' });
      expect(res.body).not.toHaveProperty('passwordHash');
      const entries = await prisma.auditLogEntry.findMany({
        where: { entityId: abe.id },
      });
      expect(entries).toEqual([
        expect.objectContaining({
          actorId: ada.id,
          action: 'USER_ROLE_CHANGED',
          entityType: 'USER',
          changes: {
            before: expect.objectContaining({ role: 'APPROVER' }),
            after: res.body,
          },
        }),
      ]);
      expect(entries[0].changes).not.toHaveProperty('before.passwordHash');
    });

    it("takes effect at once: a demoted approver can no longer see others' requests", async () => {
      const submitted = await prisma.purchaseRequest.create({
        data: {
          tenantId: rita.tenantId,
          requesterId: rita.id,
          title: 'Laptop',
          vendor: 'Dell',
          amount: 129900,
          currency: 'EUR',
          status: 'SUBMITTED',
          submittedAt: new Date(),
        },
      });

      await as(ada)
        .patch(`/users/${abe.id}/role`, { role: 'REQUESTER' })
        .expect(200);

      await as(abe)
        .post(`/purchase-requests/${submitted.id}/approve`)
        .expect(404);
    });

    it('forbids an admin from changing their own role', async () => {
      await as(ada)
        .patch(`/users/${ada.id}/role`, { role: 'REQUESTER' })
        .expect(403);
    });

    it.each(['rita', 'abe'])(
      'forbids %s, who is not an admin',
      async (name) => {
        const caller = { rita, abe }[name as 'rita' | 'abe'];
        await as(caller)
          .patch(`/users/${rita.id}/role`, { role: 'ADMIN' })
          .expect(403);
      },
    );

    it("hides another tenant's user", async () => {
      await as(ada)
        .patch(`/users/${gus.id}/role`, { role: 'REQUESTER' })
        .expect(404);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: gus.id } })).role,
      ).toBe('ADMIN');
    });

    it('rejects an id that is not a uuid', async () => {
      await as(ada)
        .patch('/users/not-a-uuid/role', { role: 'REQUESTER' })
        .expect(400);
    });

    it('rejects an unknown role', async () => {
      await as(ada)
        .patch(`/users/${abe.id}/role`, { role: 'OWNER' })
        .expect(400);
    });
  });
});
