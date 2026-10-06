import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execSync } from 'node:child_process';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Seed (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const seededUsers = ['acme', 'globex'].flatMap((tenantSlug) =>
    (['REQUESTER', 'APPROVER', 'ADMIN'] as const).map((role) => ({
      tenantSlug,
      email: `${role.toLowerCase()}@${tenantSlug}.test`,
      role,
    })),
  );

  // Runs the real `prisma db seed` command, against the test database because
  // DATABASE_URL comes from .env.test.
  function seed() {
    execSync('npx prisma db seed', { stdio: 'inherit', env: process.env });
  }

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

    seed();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates two tenants with one user of each role', async () => {
    const users = await prisma.user.findMany({
      select: { email: true, role: true, tenant: { select: { slug: true } } },
    });

    expect(
      users.map((u) => ({
        tenantSlug: u.tenant.slug,
        email: u.email,
        role: u.role,
      })),
    ).toEqual(expect.arrayContaining(seededUsers));
    expect(users).toHaveLength(seededUsers.length);
    expect(await prisma.tenant.count()).toBe(2);
  });

  it('lets every seeded user log in with the dev password', async () => {
    for (const { tenantSlug, email, role } of seededUsers) {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantSlug, email, password: 'password' })
        .expect(200);

      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
      expect(me.body.role).toBe(role);
    }
  });

  it('can be run again without duplicating anything', async () => {
    seed();

    expect(await prisma.tenant.count()).toBe(2);
    expect(await prisma.user.count()).toBe(seededUsers.length);
  });
});
