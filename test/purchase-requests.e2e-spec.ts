import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import type {
  PurchaseRequestStatus,
  Role,
  User,
} from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Purchase requests (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let acme: string;
  let rita: User;
  let rob: User;
  let abe: User;
  let ada: User;
  let gus: User;

  const validBody = {
    title: 'Laptop',
    description: 'For the new hire',
    vendor: 'Dell',
    amount: 129900,
    currency: 'EUR',
  };

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
    const globex = (
      await prisma.tenant.create({ data: { slug: 'globex', name: 'Globex' } })
    ).id;
    rita = await createUser(acme, 'rita', 'REQUESTER');
    rob = await createUser(acme, 'rob', 'REQUESTER');
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
      delete: (path: string) => auth(server.delete(`/api/v1${path}`)),
    };
  }

  function createRequest(owner: User, status: PurchaseRequestStatus = 'DRAFT') {
    return prisma.purchaseRequest.create({
      data: {
        ...validBody,
        tenantId: owner.tenantId,
        requesterId: owner.id,
        status,
        submittedAt: status === 'DRAFT' ? null : new Date(),
      },
    });
  }

  describe('POST /purchase-requests', () => {
    it('creates a draft owned by the caller', async () => {
      const res = await as(rita)
        .post('/purchase-requests', validBody)
        .expect(201);

      expect(res.body).toMatchObject({
        ...validBody,
        id: expect.any(String),
        tenantId: acme,
        requesterId: rita.id,
        status: 'DRAFT',
        rejectionReason: null,
        decidedById: null,
        submittedAt: null,
        decidedAt: null,
      });
    });

    it('records the creation in the audit log', async () => {
      const res = await as(rita)
        .post('/purchase-requests', validBody)
        .expect(201);

      const entries = await prisma.auditLogEntry.findMany({
        where: { entityId: res.body.id },
      });
      expect(entries).toEqual([
        expect.objectContaining({
          tenantId: acme,
          actorId: rita.id,
          action: 'PURCHASE_REQUEST_CREATED',
          entityType: 'PURCHASE_REQUEST',
          changes: { before: null, after: res.body },
        }),
      ]);
    });

    it('allows leaving out the description', async () => {
      const { description: _, ...body } = validBody;

      const res = await as(rita).post('/purchase-requests', body).expect(201);

      expect(res.body.description).toBeNull();
    });

    it.each([
      ['a client-supplied tenant id', { tenantId: '0' }],
      ['a client-supplied requester id', { requesterId: '0' }],
      ['a client-supplied status', { status: 'APPROVED' }],
      ['a missing title', { title: undefined }],
      ['a blank title', { title: '   ' }],
      ['a blank vendor', { vendor: '' }],
      ['an over-long title', { title: 'x'.repeat(201) }],
      ['a fractional amount', { amount: 12.5 }],
      ['a zero amount', { amount: 0 }],
      ['an amount as a string', { amount: '100' }],
      ['an amount too large to store', { amount: 2 ** 31 }],
      ['a lowercase currency', { currency: 'eur' }],
      ['an unknown currency', { currency: 'XYZ' }],
    ])('rejects %s', async (_, override) => {
      await as(rita)
        .post('/purchase-requests', {
          ...validBody,
          ...override,
        })
        .expect(400);
    });

    it('requires a token', async () => {
      await as().post('/purchase-requests', validBody).expect(401);
    });
  });

  describe('GET /purchase-requests/:id', () => {
    it('returns the owner their own draft', async () => {
      const draft = await createRequest(rita);

      const res = await as(rita)
        .get(`/purchase-requests/${draft.id}`)
        .expect(200);

      expect(res.body).toMatchObject({ id: draft.id, status: 'DRAFT' });
    });

    it.each(['approver', 'admin'])(
      "hides someone else's draft from an %s",
      async (role) => {
        const draft = await createRequest(rita);

        await as(role === 'approver' ? abe : ada)
          .get(`/purchase-requests/${draft.id}`)
          .expect(404);
      },
    );

    it("hides another requester's submitted request from a requester", async () => {
      const submitted = await createRequest(rita, 'SUBMITTED');

      await as(rob).get(`/purchase-requests/${submitted.id}`).expect(404);
    });

    it("shows an approver someone else's submitted request", async () => {
      const submitted = await createRequest(rita, 'SUBMITTED');

      await as(abe).get(`/purchase-requests/${submitted.id}`).expect(200);
    });

    it("hides another tenant's request, even from its admin", async () => {
      const submitted = await createRequest(rita, 'SUBMITTED');

      await as(gus).get(`/purchase-requests/${submitted.id}`).expect(404);
    });

    it('returns 404 for an id that does not exist', async () => {
      await as(rita)
        .get('/purchase-requests/00000000-0000-7000-8000-000000000000')
        .expect(404);
    });

    it('rejects an id that is not a uuid', async () => {
      await as(rita).get('/purchase-requests/not-a-uuid').expect(400);
    });
  });

  describe('PATCH /purchase-requests/:id', () => {
    it('lets the owner edit their draft', async () => {
      const draft = await createRequest(rita);

      const res = await as(rita)
        .patch(`/purchase-requests/${draft.id}`, { amount: 99900 })
        .expect(200);

      expect(res.body).toMatchObject({ ...validBody, amount: 99900 });
    });

    it('clears the description when it is set to null', async () => {
      const draft = await createRequest(rita);

      const res = await as(rita)
        .patch(`/purchase-requests/${draft.id}`, { description: null })
        .expect(200);

      expect(res.body.description).toBeNull();
    });

    it('records the before and after in the audit log', async () => {
      const draft = await createRequest(rita);
      const before = (
        await as(rita).get(`/purchase-requests/${draft.id}`).expect(200)
      ).body;

      const after = (
        await as(rita)
          .patch(`/purchase-requests/${draft.id}`, { title: 'Monitor' })
          .expect(200)
      ).body;

      const entries = await prisma.auditLogEntry.findMany({
        where: { entityId: draft.id },
      });
      expect(entries).toEqual([
        expect.objectContaining({
          actorId: rita.id,
          action: 'PURCHASE_REQUEST_UPDATED',
          changes: { before, after },
        }),
      ]);
    });

    it("forbids editing someone else's request", async () => {
      const submitted = await createRequest(rita, 'SUBMITTED');

      await as(abe)
        .patch(`/purchase-requests/${submitted.id}`, { title: 'Mine now' })
        .expect(403);
    });

    it('refuses to edit a request that is no longer a draft', async () => {
      const submitted = await createRequest(rita, 'SUBMITTED');

      await as(rita)
        .patch(`/purchase-requests/${submitted.id}`, { title: 'Changed' })
        .expect(409);
    });

    it("hides another tenant's request", async () => {
      const draft = await createRequest(rita);

      await as(gus)
        .patch(`/purchase-requests/${draft.id}`, { title: 'Changed' })
        .expect(404);
    });

    it.each([
      ['a status', { status: 'APPROVED' }],
      ['a requester id', { requesterId: '0' }],
      ['a zero amount', { amount: 0 }],
      ['a blank title', { title: ' ' }],
    ])('rejects %s', async (_, body) => {
      const draft = await createRequest(rita);

      await as(rita).patch(`/purchase-requests/${draft.id}`, body).expect(400);
    });

    it('leaves the request unchanged when it refuses', async () => {
      const submitted = await createRequest(rita, 'SUBMITTED');

      await as(rita)
        .patch(`/purchase-requests/${submitted.id}`, { title: 'Changed' })
        .expect(409);

      expect(
        await prisma.purchaseRequest.findUnique({
          where: { id: submitted.id },
        }),
      ).toEqual(submitted);
      expect(
        await prisma.auditLogEntry.count({ where: { entityId: submitted.id } }),
      ).toBe(0);
    });
  });

  describe('DELETE /purchase-requests/:id', () => {
    it('lets the owner delete their draft and records it', async () => {
      const draft = await createRequest(rita);
      const before = (
        await as(rita).get(`/purchase-requests/${draft.id}`).expect(200)
      ).body;

      await as(rita).delete(`/purchase-requests/${draft.id}`).expect(204);

      await as(rita).get(`/purchase-requests/${draft.id}`).expect(404);
      const entries = await prisma.auditLogEntry.findMany({
        where: { entityId: draft.id },
      });
      expect(entries).toEqual([
        expect.objectContaining({
          actorId: rita.id,
          action: 'PURCHASE_REQUEST_DELETED',
          changes: { before, after: null },
        }),
      ]);
    });

    it("forbids deleting someone else's request", async () => {
      const submitted = await createRequest(rita, 'SUBMITTED');

      await as(ada).delete(`/purchase-requests/${submitted.id}`).expect(403);
    });

    it('refuses to delete a request that is no longer a draft', async () => {
      const submitted = await createRequest(rita, 'SUBMITTED');

      await as(rita).delete(`/purchase-requests/${submitted.id}`).expect(409);
    });

    it("hides someone else's draft", async () => {
      const draft = await createRequest(rita);

      await as(ada).delete(`/purchase-requests/${draft.id}`).expect(404);
    });
  });
});
