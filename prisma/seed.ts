// Development seed: two tenants with one user of each role, all with the
// password `password`. Upserts only, so it is safe to run again and never
// touches other data.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../src/auth/password.js';
import { PrismaClient, Role } from '../src/generated/prisma/client.js';

const tenants = [
  { slug: 'acme', name: 'Acme' },
  { slug: 'globex', name: 'Globex' },
];
const roles: Role[] = ['REQUESTER', 'APPROVER', 'ADMIN'];

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  const passwordHash = await hashPassword('password');

  for (const { slug, name } of tenants) {
    const tenant = await prisma.tenant.upsert({
      where: { slug },
      update: {},
      create: { slug, name },
    });

    for (const role of roles) {
      const email = `${role.toLowerCase()}@${slug}.test`;
      await prisma.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email } },
        update: {},
        create: {
          tenantId: tenant.id,
          email,
          name: `${name} ${role.charAt(0)}${role.slice(1).toLowerCase()}`,
          passwordHash,
          role,
        },
      });
    }
  }

  console.log(
    `Seeded tenants ${tenants.map((t) => t.slug).join(', ')} with one user per role.`,
  );
} finally {
  await prisma.$disconnect();
}
