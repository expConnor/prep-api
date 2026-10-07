import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import type {
  AuditAction,
  AuditLogEntry,
  Role,
  User,
} from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Audit logs (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let rita: User;
  let abe: User;
  let ada: User;
  // acme's entries, oldest first
  let entries: AuditLogEntry[];

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
    const gus = await createUser(globex, 'gus', 'ADMIN');

    // Explicit timestamps so the expected order doesn't depend on how fast
    // the inserts run. globex's entry is the newest, so it would come first
    // if it leaked.
    entries = [
      await createEntry(rita, 'PURCHASE_REQUEST_CREATED', '2026-01-01'),
      await createEntry(ada, 'USER_CREATED', '2026-01-02'),
      await createEntry(rita, 'PURCHASE_REQUEST_SUBMITTED', '2026-01-03'),
    ];
    await createEntry(gus, 'USER_CREATED', '2026-01-04');
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

  function createEntry(actor: User, action: AuditAction, createdAt: string) {
    return prisma.auditLogEntry.create({
      data: {
        tenantId: actor.tenantId,
        actorId: actor.id,
        action,
        entityType: action.startsWith('USER') ? 'USER' : 'PURCHASE_REQUEST',
        entityId: randomUUID(),
        changes: { before: null, after: { title: 'Laptop' } },
        createdAt: new Date(createdAt),
      },
    });
  }

  // Signed directly rather than via login, which skips password hashing.
  function as(user?: User) {
    return {
      get: (query = '') => {
        const req = request(app.getHttpServer()).get(
          `/api/v1/audit-logs${query}`,
        );
        return user
          ? req.set(
              'Authorization',
              `Bearer ${app.get(JwtService).sign({ sub: user.id, tenantId: user.tenantId })}`,
            )
          : req;
      },
    };
  }

  function ids(body: { items: AuditLogEntry[] }) {
    return body.items.map((entry) => entry.id);
  }

  it("lists the admin's tenant's audit entries, newest first", async () => {
    const res = await as(ada).get().expect(200);

    expect(res.body).toEqual({
      items: [...entries].reverse().map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
      })),
      total: 3,
      page: 1,
      limit: 20,
    });
  });

  it('pages through the entries with a total count', async () => {
    const first = await as(ada).get('?limit=2').expect(200);
    const second = await as(ada).get('?limit=2&page=2').expect(200);

    expect(first.body).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect(ids(first.body)).toEqual([entries[2].id, entries[1].id]);
    expect(second.body).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(ids(second.body)).toEqual([entries[0].id]);
  });

  it.each(['?limit=101', '?limit=0', '?page=0', '?page=two', '?foo=1'])(
    'rejects the query %s',
    async (query) => {
      await as(ada).get(query).expect(400);
    },
  );

  it.each(['rita', 'abe'])('forbids %s, who is not an admin', async (name) => {
    const caller = { rita, abe }[name as 'rita' | 'abe'];
    await as(caller).get().expect(403);
  });

  it('requires a token', async () => {
    await as().get().expect(401);
  });
});
