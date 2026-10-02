import { execSync } from 'node:child_process';

// Applies migrations to the test database once before the e2e suite runs.
// DATABASE_URL is set from .env.test by vitest.config.e2e.ts.
export default function setup() {
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}
