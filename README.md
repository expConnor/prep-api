# prep-api

Purchase Requests API. See [SPEC.md](SPEC.md) for scope, domain and architecture.

**Stack:** NestJS 12 (ESM) · PostgreSQL 18 · Prisma 7 · Vitest

## Setup

Requires Node 22+ and PostgreSQL. Either run Postgres with Docker:

```sh
docker compose up -d   # creates prep_api and prep_api_test, user/password prep/prep
```

or use a local Postgres and create the same role and databases:

```sh
psql -d postgres -c "CREATE ROLE prep LOGIN PASSWORD 'prep' CREATEDB" \
  -c "CREATE DATABASE prep_api OWNER prep" \
  -c "CREATE DATABASE prep_api_test OWNER prep"
```

Then:

```sh
cp .env.example .env
npm install            # also runs `prisma generate`
npm run db:deploy      # apply migrations to the dev database
npm run start:dev      # http://localhost:3000/api/v1/health
```

## Scripts

| Script               | What it does                                        |
| -------------------- | --------------------------------------------------- |
| `npm run start:dev`  | Run the API in watch mode                           |
| `npm run check`      | Typecheck, lint, format check, unit and e2e tests   |
| `npm test`           | Unit tests (`*.spec.ts`)                            |
| `npm run test:e2e`   | E2E tests (`*.e2e-spec.ts`) against `prep_api_test` |
| `npm run db:migrate` | Create and apply a migration in development         |
| `npm run db:deploy`  | Apply pending migrations                            |
| `npm run lint`       | Lint with oxlint                                    |

The e2e run loads `.env.test` and applies migrations to the test database before the suite starts.
