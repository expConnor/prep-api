# Purchase Requests API — Spec

## 1. Goal

A multi-tenant API where employees ask for approval to spend money, and authorized people approve or reject those requests.

A **purchase request** is an internal "may I spend this?" record. It comes before any purchase order, so purchase orders, invoices and payments are out of scope.

**Stack:** NestJS 12 (ESM) · PostgreSQL 18 · Prisma 7 · Vitest

## 2. Scope

**In scope**

- Tenants, users and roles
- Purchase request lifecycle (draft → submitted → approved / rejected)
- Filtering, sorting and pagination on request lists
- Audit log of all changes
- Automated tests

**Out of scope**

- Purchase orders, invoices and payments
- Multi-step approval chains
- Budgets and spending limits
- Notifications and attachments
- Currency conversion

## 3. Domain

| Concept          | Description                                                                           |
| ---------------- | ------------------------------------------------------------------------------------- |
| Tenant           | A company using the API. It owns all of its users and data.                           |
| User             | Belongs to exactly one tenant and has one role.                                       |
| Purchase request | What is being bought, from whom, how much, and why. Owned by the user who created it. |
| Audit log entry  | A record of who did what to which resource, when, and what changed.                   |

**Roles**

- **Requester:** creates and submits their own requests.
- **Approver:** can also approve or reject other people's requests.
- **Admin:** can also manage users and view the full audit log for the tenant.

**Entities**

- **Tenant:** id, slug (unique; identifies the tenant at login), name
- **User:** id, tenantId, email (lowercase, unique within the tenant), name, passwordHash, role
- **PurchaseRequest:** id, tenantId, requesterId, title, description, vendor, amount, currency, status, rejectionReason, decidedById, submittedAt, decidedAt, createdAt, updatedAt
- **AuditLogEntry:** id, tenantId, actorId, action, entityType, entityId (no foreign key, so history outlives deleted drafts), changes (before/after), createdAt

## 4. Request lifecycle

```
DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED
                      │
                      └──reject──▶ REJECTED
```

- A draft can be edited or deleted by its owner. After submission the request is locked.
- Only approvers and admins can approve or reject.
- Rejecting requires a reason.
- Approved and rejected are final. To try again after a rejection, the requester creates a new request.
- Any other transition is refused.

## 5. Business rules

1. **Tenant isolation:** users only ever see and act on data from their own tenant. The tenant comes from the authenticated user, never from client input.
2. **Separation of duties:** nobody approves or rejects their own request.
3. **Visibility:**
   - Requesters see their own requests.
   - Approvers also see other people's submitted, approved and rejected requests.
   - Admins see everything in their tenant.
   - Drafts are private to their owner.
4. **No information leaks:** resources in another tenant, and resources the caller can't see, look like they don't exist.
5. **Everything is audited:** every change is recorded, and it's recorded atomically with the change itself.
6. **Concurrency safety:** two people acting on the same request at once can't both succeed.

## 6. API surface

The API is REST and JSON, versioned under `/api/v1`.

| Area              | Capabilities                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Auth              | Log in with tenant slug, email and password to get a token; get the current user              |
| Purchase requests | Create, list, view, edit (draft), delete (draft)                                              |
| Transitions       | Submit, approve and reject, each as its own action endpoint rather than a status field update |
| Audit             | View the history of one request; admins can browse the whole tenant's log                     |
| Users             | Admins list users, create users and change roles                                              |

**Endpoints**

```
POST   /auth/login
GET    /auth/me

GET    /purchase-requests
POST   /purchase-requests
GET    /purchase-requests/:id
PATCH  /purchase-requests/:id
DELETE /purchase-requests/:id
POST   /purchase-requests/:id/submit
POST   /purchase-requests/:id/approve
POST   /purchase-requests/:id/reject
GET    /purchase-requests/:id/audit

GET    /audit-logs

GET    /users
POST   /users
PATCH  /users/:id/role
```

## 7. Listing

Request lists support:

- **Filtering** by status, requester, vendor and a text search on the title.
- **Sorting** by amount or creation date, ascending or descending. The default is newest first.
- **Pagination** with page and limit, a capped page size, and a total count in the response.

Filters always apply on top of the caller's visibility rules.

## 8. Key decisions

| Decision            | Choice                                           | Why                                                      |
| ------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| Authentication      | JWT, with seeded users                           | Realistic but small                                      |
| Pagination          | Offset (page/limit)                              | Simple, and works with any sort                          |
| Line items          | No, one amount per request                       | Keeps the model and filtering simple                     |
| Rejection           | Terminal                                         | Matches the task; a new request is the retry             |
| State changes       | Dedicated action endpoints                       | Each transition has its own rules, input and audit entry |
| Money               | Integer minor units (e.g. cents)                 | Exact arithmetic, no floating-point errors               |
| Hidden vs forbidden | Not visible → 404; visible but not allowed → 403 | Doesn't reveal whether other tenants' data exists        |

## 9. Architecture

- Feature modules: auth, users, purchase requests and audit, plus shared Prisma and common modules.
- Auth is applied globally, so every route requires a token unless it's explicitly marked public.
- Permission and transition rules live in **pure functions**, separate from controllers and the database, so they're easy to unit-test.
- Writes and their audit entries share one database transaction.
- Input is validated at the edge with DTOs; unknown fields are rejected.

## 10. Testing

**Unit tests**

- State machine transitions
- The permission matrix (role × ownership × action)
- Query parsing for filters and sorting

**End-to-end tests** (against a real Postgres test database)

- Full lifecycle and the audit trail it produces
- Invalid transitions and locked requests
- Role checks, including self-approval
- Tenant isolation
- Draft visibility
- Filtering, sorting and pagination
- Concurrent approve/reject on the same request

**Seed data:** two tenants with one user of each role, so isolation is easy to test.
