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

  describe('POST /purchase-requests/:id/submit', () => {
    it('lets the owner submit their draft and records it', async () => {
      const draft = await createRequest(rita);
      const before = (
        await as(rita).get(`/purchase-requests/${draft.id}`).expect(200)
      ).body;

      const after = (
        await as(rita).post(`/purchase-requests/${draft.id}/submit`).expect(200)
      ).body;

      expect(after).toMatchObject({
        status: 'SUBMITTED',
        submittedAt: expect.any(String),
      });
      const entries = await prisma.auditLogEntry.findMany({
        where: { entityId: draft.id },
      });
      expect(entries).toEqual([
        expect.objectContaining({
          actorId: rita.id,
          action: 'PURCHASE_REQUEST_SUBMITTED',
          changes: { before, after },
        }),
      ]);
    });

    it("forbids submitting someone else's request", async () => {
      const submitted = await createRequest(rita, 'SUBMITTED');

      await as(abe)
        .post(`/purchase-requests/${submitted.id}/submit`)
        .expect(403);
    });

    it('refuses to submit a request twice', async () => {
      const submitted = await createRequest(rita, 'SUBMITTED');

      await as(rita)
        .post(`/purchase-requests/${submitted.id}/submit`)
        .expect(409);
    });

    it("hides someone else's draft", async () => {
      const draft = await createRequest(rita);

      await as(ada).post(`/purchase-requests/${draft.id}/submit`).expect(404);
    });
  });

  describe('POST /purchase-requests/:id/approve', () => {
    it("lets an approver approve someone else's request and records it", async () => {
      const submitted = await createRequest(rita, 'SUBMITTED');
      const before = (
        await as(abe).get(`/purchase-requests/${submitted.id}`).expect(200)
      ).body;

      const after = (
        await as(abe)
          .post(`/purchase-requests/${submitted.id}/approve`)
          .expect(200)
      ).body;

      expect(after).toMatchObject({
        status: 'APPROVED',
        decidedById: abe.id,
        decidedAt: expect.any(String),
        rejectionReason: null,
      });
      const entries = await prisma.auditLogEntry.findMany({
        where: { entityId: submitted.id },
      });
      expect(entries).toEqual([
        expect.objectContaining({
          actorId: abe.id,
          action: 'PURCHASE_REQUEST_APPROVED',
          changes: { before, after },
        }),
      ]);
    });

    it("lets an admin approve someone else's request", async () => {
      const submitted = await createRequest(rita, 'SUBMITTED');

      await as(ada)
        .post(`/purchase-requests/${submitted.id}/approve`)
        .expect(200);
    });

    it.each([
      ['a requester', 'rita'],
      ['an approver', 'abe'],
      ['an admin', 'ada'],
    ])('forbids %s from approving their own request', async (_, name) => {
      const owner = { rita, abe, ada }[name]!;
      const submitted = await createRequest(owner, 'SUBMITTED');

      await as(owner)
        .post(`/purchase-requests/${submitted.id}/approve`)
        .expect(403);
    });

    it('refuses to approve a draft', async () => {
      const draft = await createRequest(abe);

      await as(abe).post(`/purchase-requests/${draft.id}/approve`).expect(403);
      await as(ada).post(`/purchase-requests/${draft.id}/approve`).expect(404);
    });

    it.each(['approve', 'reject'])(
      'refuses to %s a request that is already decided',
      async (action) => {
        const submitted = await createRequest(rita, 'SUBMITTED');
        await as(abe)
          .post(`/purchase-requests/${submitted.id}/approve`)
          .expect(200);

        await as(ada)
          .post(`/purchase-requests/${submitted.id}/${action}`, {
            reason: 'Too late',
          })
          .expect(409);
      },
    );

    it("hides another tenant's request", async () => {
      const submitted = await createRequest(rita, 'SUBMITTED');

      await as(gus)
        .post(`/purchase-requests/${submitted.id}/approve`)
        .expect(404);
    });
  });

  describe('POST /purchase-requests/:id/reject', () => {
    it('rejects with a reason and records it', async () => {
      const submitted = await createRequest(rita, 'SUBMITTED');
      const before = (
        await as(abe).get(`/purchase-requests/${submitted.id}`).expect(200)
      ).body;

      const after = (
        await as(abe)
          .post(`/purchase-requests/${submitted.id}/reject`, {
            reason: 'Over budget',
          })
          .expect(200)
      ).body;

      expect(after).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'Over budget',
        decidedById: abe.id,
        decidedAt: expect.any(String),
      });
      const entries = await prisma.auditLogEntry.findMany({
        where: { entityId: submitted.id },
      });
      expect(entries).toEqual([
        expect.objectContaining({
          actorId: abe.id,
          action: 'PURCHASE_REQUEST_REJECTED',
          changes: { before, after },
        }),
      ]);
    });

    it.each([
      ['a missing reason', {}],
      ['a blank reason', { reason: '  ' }],
      ['an over-long reason', { reason: 'x'.repeat(2001) }],
    ])('rejects %s', async (_, body) => {
      const submitted = await createRequest(rita, 'SUBMITTED');

      await as(abe)
        .post(`/purchase-requests/${submitted.id}/reject`, body)
        .expect(400);
    });

    it('forbids rejecting your own request', async () => {
      const submitted = await createRequest(abe, 'SUBMITTED');

      await as(abe)
        .post(`/purchase-requests/${submitted.id}/reject`, { reason: 'No' })
        .expect(403);
    });
  });

  describe('concurrent decisions', () => {
    // Holding a row lock lets both requests read SUBMITTED and pass the policy
    // check, then queue on their UPDATE. Releasing it lets them write one after
    // the other, which is the race the conditional update has to survive.
    it('lets only one of an approve and a reject at the same time succeed', async () => {
      const submitted = await createRequest(rita, 'SUBMITTED');

      let both!: Promise<request.Response[]>;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "PurchaseRequest" WHERE id = ${submitted.id}::uuid FOR UPDATE`;
        both = Promise.all([
          as(abe).post(`/purchase-requests/${submitted.id}/approve`),
          as(ada).post(`/purchase-requests/${submitted.id}/reject`, {
            reason: 'Over budget',
          }),
        ]);
        await waitForLockWaiters(2);
      });
      const [approve, reject] = await both;

      expect([approve.status, reject.status].sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      const winner = approve.status === 200 ? approve : reject;
      const stored = await prisma.purchaseRequest.findUniqueOrThrow({
        where: { id: submitted.id },
      });
      expect(stored.status).toBe(winner.body.status);
      expect(
        await prisma.auditLogEntry.count({ where: { entityId: submitted.id } }),
      ).toBe(1);
    });

    async function waitForLockWaiters(count: number) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`;
        if (waiting >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Expected ${count} queries waiting on a lock`);
    }
  });

  describe('GET /purchase-requests/:id/audit', () => {
    it('returns the full lifecycle, oldest first', async () => {
      const created = (
        await as(rita).post('/purchase-requests', validBody).expect(201)
      ).body;
      const path = `/purchase-requests/${created.id}`;
      await as(rita).patch(path, { amount: 99900 }).expect(200);
      await as(rita).post(`${path}/submit`).expect(200);
      await as(abe).post(`${path}/approve`).expect(200);

      const res = await as(abe).get(`${path}/audit`).expect(200);

      expect(
        res.body.map((entry: { action: string; actorId: string }) => [
          entry.action,
          entry.actorId,
        ]),
      ).toEqual([
        ['PURCHASE_REQUEST_CREATED', rita.id],
        ['PURCHASE_REQUEST_UPDATED', rita.id],
        ['PURCHASE_REQUEST_SUBMITTED', rita.id],
        ['PURCHASE_REQUEST_APPROVED', abe.id],
      ]);
      expect(res.body[3]).toMatchObject({
        entityType: 'PURCHASE_REQUEST',
        entityId: created.id,
        changes: {
          before: { status: 'SUBMITTED' },
          after: { status: 'APPROVED', decidedById: abe.id },
        },
        createdAt: expect.any(String),
      });
    });

    it('shows the owner the history of their own draft', async () => {
      const created = (
        await as(rita).post('/purchase-requests', validBody).expect(201)
      ).body;

      const res = await as(rita)
        .get(`/purchase-requests/${created.id}/audit`)
        .expect(200);

      expect(res.body).toHaveLength(1);
    });

    it.each([
      ['an approver', 'abe', 'DRAFT'],
      ['another requester', 'rob', 'SUBMITTED'],
      ['another tenant', 'gus', 'SUBMITTED'],
    ] as const)(
      'hides the history from %s who cannot see the request',
      async (_, name, status) => {
        const hidden = await createRequest(rita, status);

        await as({ abe, rob, gus }[name])
          .get(`/purchase-requests/${hidden.id}/audit`)
          .expect(404);
      },
    );
  });
});
