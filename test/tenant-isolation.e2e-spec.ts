import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import type { PurchaseRequest, User } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Calls every guarded endpoint in the Swagger document as another tenant's
// admin, so a query that forgets its tenantId filter fails here even if
// nobody wrote a cross-tenant test for that endpoint. Admin passes every role
// check, so a missing filter shows up as 200, 403 or 409 instead of 404.
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let rita: User;
  let submitted: PurchaseRequest;
  let gus: User;

  const newRequest = {
    title: 'Laptop',
    vendor: 'Dell',
    amount: 129900,
    currency: 'EUR',
  };

  // A valid body for every endpoint that takes one, since validation runs
  // before the tenant check and a 400 would prove nothing.
  const bodies: Record<string, object> = {
    'post /purchase-requests': newRequest,
    'patch /purchase-requests/{id}': { title: 'Changed' },
    'post /purchase-requests/{id}/reject': { reason: 'No' },
    'post /users': {
      email: 'nina@globex.test',
      name: 'Nina',
      password: 'correct horse',
      role: 'REQUESTER',
    },
    'patch /users/{id}/role': { role: 'ADMIN' },
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

    const acme = (
      await prisma.tenant.create({ data: { slug: 'acme', name: 'Acme' } })
    ).id;
    const globex = (
      await prisma.tenant.create({ data: { slug: 'globex', name: 'Globex' } })
    ).id;
    rita = await prisma.user.create({
      data: {
        tenantId: acme,
        email: 'rita@test',
        name: 'rita',
        passwordHash: 'unused',
        role: 'REQUESTER',
      },
    });
    gus = await prisma.user.create({
      data: {
        tenantId: globex,
        email: 'gus@test',
        name: 'gus',
        passwordHash: 'unused',
        role: 'ADMIN',
      },
    });
    // Submitted rather than a draft, so an admin in its own tenant could see
    // it and only the tenant filter hides it.
    submitted = await prisma.purchaseRequest.create({
      data: {
        ...newRequest,
        tenantId: acme,
        requesterId: rita.id,
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });
    // Gives the audit log endpoints acme data that could leak.
    await prisma.auditLogEntry.create({
      data: {
        tenantId: acme,
        actorId: rita.id,
        action: 'PURCHASE_REQUEST_SUBMITTED',
        entityType: 'PURCHASE_REQUEST',
        entityId: submitted.id,
        changes: { before: null, after: submitted },
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("never lets another tenant see or change a tenant's data", async () => {
    // Every resource with {id} routes needs an id from the other tenant here.
    const fixtureIds: Record<string, string> = {
      'purchase-requests': submitted.id,
      users: rita.id,
    };
    const acmeIds = [rita.tenantId, rita.id, submitted.id];
    const token = app.get(JwtService).sign({
      sub: gus.id,
      tenantId: gus.tenantId,
    });
    const server = request(app.getHttpServer());
    const doc = (await server.get('/api/docs-json').expect(200)).body;

    const swept: string[] = [];
    const failures: string[] = [];
    for (const [docPath, operations] of Object.entries(doc.paths)) {
      const path = docPath.replace(/^\/api\/v1/, '');
      for (const [method, operation] of Object.entries(
        operations as Record<string, { security?: unknown }>,
      )) {
        if (!operation.security) continue;
        const route = `${method} ${path}`;
        swept.push(route);

        const fixtureId = fixtureIds[path.split('/')[1]];
        if (path.includes('{id}') && !fixtureId) {
          failures.push(`${route}: no fixture id for this resource`);
          continue;
        }
        const res = await server[method as 'get' | 'post' | 'patch' | 'delete'](
          `/api/v1${path.replace('{id}', fixtureId)}`,
        )
          .set('Authorization', `Bearer ${token}`)
          .send(bodies[route]);

        if (path.includes('{id}') && res.status !== 404) {
          failures.push(`${route}: expected 404, got ${res.status}`);
        }
        const body = JSON.stringify(res.body);
        if (acmeIds.some((id) => body.includes(id))) {
          failures.push(`${route}: response contains the other tenant's data`);
        }
      }
    }

    expect(failures).toEqual([]);
    expect(swept).toEqual(
      expect.arrayContaining([
        'post /purchase-requests/{id}/approve',
        'patch /users/{id}/role',
        'get /audit-logs',
      ]),
    );
    expect(
      await prisma.purchaseRequest.findUniqueOrThrow({
        where: { id: submitted.id },
      }),
    ).toEqual(submitted);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: rita.id } }),
    ).toEqual(rita);
  });
});
