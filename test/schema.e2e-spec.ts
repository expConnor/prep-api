import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

// The database is the last line of defence for tenant isolation and request
// invariants, so these tests write rows directly and expect Postgres to refuse
// anything inconsistent, whatever the application code does.
describe('Database constraints (e2e)', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let tenantA: string;
  let tenantB: string;
  let requesterA: string;
  let approverA: string;
  let userB: string;

  beforeAll(async () => {
    await prisma.auditLogEntry.deleteMany();
    await prisma.purchaseRequest.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tenant.deleteMany();

    tenantA = (
      await prisma.tenant.create({ data: { slug: 'acme', name: 'Acme' } })
    ).id;
    tenantB = (
      await prisma.tenant.create({ data: { slug: 'globex', name: 'Globex' } })
    ).id;
    requesterA = (await createUser(tenantA, 'requester@acme.test')).id;
    approverA = (await createUser(tenantA, 'approver@acme.test')).id;
    userB = (await createUser(tenantB, 'someone@globex.test')).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function createUser(tenantId: string, email: string) {
    return prisma.user.create({
      data: { tenantId, email, name: email, passwordHash: 'x' },
    });
  }

  function createRequest(data: Record<string, unknown> = {}) {
    return prisma.purchaseRequest.create({
      data: {
        tenantId: tenantA,
        requesterId: requesterA,
        title: 'Laptop',
        vendor: 'Dell',
        amount: 150000,
        currency: 'EUR',
        ...data,
      },
    });
  }

  const submitted = { status: 'SUBMITTED', submittedAt: new Date() } as const;
  // A function so it reads approverA after beforeAll has set it.
  const decided = () => ({
    submittedAt: new Date(),
    decidedAt: new Date(),
    decidedById: approverA,
  });

  describe('tenant isolation', () => {
    it('refuses a request whose requester belongs to another tenant', async () => {
      await expect(createRequest({ requesterId: userB })).rejects.toThrow(
        /PurchaseRequest_tenantId_requesterId_fkey/,
      );
    });

    it('refuses a request decided by a user from another tenant', async () => {
      await expect(
        createRequest({ ...decided(), status: 'APPROVED', decidedById: userB }),
      ).rejects.toThrow(/PurchaseRequest_tenantId_decidedById_fkey/);
    });

    it('refuses an audit entry whose actor belongs to another tenant', async () => {
      await expect(
        prisma.auditLogEntry.create({
          data: {
            tenantId: tenantA,
            actorId: userB,
            action: 'USER_CREATED',
            entityType: 'USER',
            entityId: requesterA,
            changes: { before: null, after: {} },
          },
        }),
      ).rejects.toThrow(/AuditLogEntry_tenantId_actorId_fkey/);
    });
  });

  describe('users and tenants', () => {
    it('refuses a duplicate email within a tenant', async () => {
      await expect(createUser(tenantA, 'requester@acme.test')).rejects.toThrow(
        /Unique constraint/,
      );
    });

    it('allows the same email in another tenant', async () => {
      await expect(
        createUser(tenantB, 'requester@acme.test'),
      ).resolves.toBeDefined();
    });

    it('refuses an email that is not lowercase', async () => {
      await expect(createUser(tenantA, 'Mixed@acme.test')).rejects.toThrow(
        /user_email_lowercase/,
      );
    });

    it('refuses a tenant slug that is not lowercase letters, digits and dashes', async () => {
      await expect(
        prisma.tenant.create({ data: { slug: 'Bad Slug', name: 'Bad' } }),
      ).rejects.toThrow(/tenant_slug_format/);
    });
  });

  describe('purchase requests', () => {
    it('accepts a consistent approved request', async () => {
      await expect(
        createRequest({ ...decided(), status: 'APPROVED' }),
      ).resolves.toBeDefined();
    });

    it('refuses a zero amount', async () => {
      await expect(createRequest({ amount: 0 })).rejects.toThrow(
        /pr_amount_positive/,
      );
    });

    it('refuses a currency that is not three uppercase letters', async () => {
      await expect(createRequest({ currency: 'eur' })).rejects.toThrow(
        /pr_currency_format/,
      );
    });

    it('refuses a submitted request without a submission time', async () => {
      await expect(createRequest({ status: 'SUBMITTED' })).rejects.toThrow(
        /pr_status_consistency/,
      );
    });

    it('refuses a submitted request that already has a decider', async () => {
      await expect(
        createRequest({ ...submitted, decidedById: approverA }),
      ).rejects.toThrow(/pr_status_consistency/);
    });

    it('refuses a rejected request without a reason', async () => {
      await expect(
        createRequest({ ...decided(), status: 'REJECTED' }),
      ).rejects.toThrow(/pr_status_consistency/);
    });

    it('refuses a rejected request with a blank reason', async () => {
      await expect(
        createRequest({
          ...decided(),
          status: 'REJECTED',
          rejectionReason: '  ',
        }),
      ).rejects.toThrow(/pr_status_consistency/);
    });

    it('refuses a request decided by its own requester', async () => {
      await expect(
        createRequest({
          ...decided(),
          status: 'APPROVED',
          decidedById: requesterA,
        }),
      ).rejects.toThrow(/pr_no_self_decision/);
    });
  });
});
