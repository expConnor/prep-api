import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Point the whole e2e run at the test database. Loaded into process.env here
// (not via `test.env`) so globalSetup's migrate step sees it too.
config({ path: '.env.test', override: true, quiet: true });

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // e2e files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
