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
npm run db:seed        # add the development tenants and users
npm run start:dev      # http://localhost:3000/api/v1/health
```

## Seed data

`npm run db:seed` creates two tenants with one user of each role. Every seeded user has the password `password`.

| Tenant slug | Requester               | Approver               | Admin               |
| ----------- | ----------------------- | ---------------------- | ------------------- |
| `acme`      | `requester@acme.test`   | `approver@acme.test`   | `admin@acme.test`   |
| `globex`    | `requester@globex.test` | `approver@globex.test` | `admin@globex.test` |

The seed only adds what is missing, so it is safe to run again and leaves other data alone.

## Environment

Copy `.env.example` to `.env`. The e2e tests read `.env.test` instead.

| Variable       | What it is                                                                   |
| -------------- | ---------------------------------------------------------------------------- |
| `PORT`         | Port the API listens on (default 3000)                                       |
| `DATABASE_URL` | PostgreSQL connection string                                                 |
| `JWT_SECRET`   | Secret that signs access tokens; use a long random value outside development |

## Authentication

Log in with the tenant slug, email and password. The email is matched case-insensitively. Every login failure returns the same 401, so it doesn't reveal whether the tenant, email or password was wrong.

```sh
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"tenantSlug":"acme","email":"approver@acme.test","password":"password"}'
# {"accessToken":"eyJ..."}
```

Send the token as a bearer token. It expires after one hour.

```sh
curl http://localhost:3000/api/v1/auth/me -H 'Authorization: Bearer eyJ...'
# {"id":"...","tenantId":"...","email":"approver@acme.test","name":"Acme Approver","role":"APPROVER"}
```

The user is reloaded on every request, so a deleted user is locked out and a role change applies straight away. A missing, invalid or expired token gets a 401. Protected handlers opt in with `@UseGuards(AuthGuard)`; `/health` and `/auth/login` are public.

## Purchase requests

Every endpoint needs a bearer token and only ever touches the caller's tenant.

| Endpoint                              | What it does                                                       |
| ------------------------------------- | ------------------------------------------------------------------ |
| `POST /purchase-requests`             | Create a draft owned by the caller                                 |
| `GET /purchase-requests/:id`          | Get one request                                                    |
| `PATCH /purchase-requests/:id`        | Edit your own draft; `description: null` clears it                 |
| `DELETE /purchase-requests/:id`       | Delete your own draft                                              |
| `POST /purchase-requests/:id/submit`  | Submit your own draft for approval                                 |
| `POST /purchase-requests/:id/approve` | Approve someone else's submitted request (approvers and admins)    |
| `POST /purchase-requests/:id/reject`  | Reject someone else's submitted request with `{ "reason": "..." }` |

`amount` is an integer in minor units (cents for EUR) and `currency` an uppercase ISO 4217 code:

```sh
curl -X POST http://localhost:3000/api/v1/purchase-requests \
  -H 'Authorization: Bearer eyJ...' -H 'Content-Type: application/json' \
  -d '{"title":"Laptop","vendor":"Dell","amount":129900,"currency":"EUR"}'
```

Drafts are visible only to their owner. Requesters see only their own requests; approvers and admins also see everyone else's submitted, approved and rejected ones. A request the caller can't see, including one in another tenant, returns 404 as if it didn't exist. Acting on a visible request that isn't yours returns 403, and editing or deleting one that is no longer a draft returns 409.

A request moves `DRAFT → SUBMITTED → APPROVED | REJECTED`, and approved and rejected are final. Nobody can approve or reject their own request (403). Any other transition returns 409, including the loser when two people decide the same request at once. Every change is written to the audit log in the same transaction.

## Scripts

| Script               | What it does                                        |
| -------------------- | --------------------------------------------------- |
| `npm run start:dev`  | Run the API in watch mode                           |
| `npm run check`      | Typecheck, lint, format check, unit and e2e tests   |
| `npm test`           | Unit tests (`*.spec.ts`)                            |
| `npm run test:e2e`   | E2E tests (`*.e2e-spec.ts`) against `prep_api_test` |
| `npm run db:migrate` | Create and apply a migration in development         |
| `npm run db:deploy`  | Apply pending migrations                            |
| `npm run db:seed`    | Add the development tenants and users               |
| `npm run lint`       | Lint with oxlint                                    |

The e2e run loads `.env.test` and applies migrations to the test database before the suite starts.
