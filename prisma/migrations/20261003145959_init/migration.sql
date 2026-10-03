-- CreateEnum
CREATE TYPE "Role" AS ENUM ('REQUESTER', 'APPROVER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('PURCHASE_REQUEST', 'USER');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('PURCHASE_REQUEST_CREATED', 'PURCHASE_REQUEST_UPDATED', 'PURCHASE_REQUEST_DELETED', 'PURCHASE_REQUEST_SUBMITTED', 'PURCHASE_REQUEST_APPROVED', 'PURCHASE_REQUEST_REJECTED', 'USER_CREATED', 'USER_ROLE_CHANGED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'REQUESTER',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "requesterId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "vendor" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" TEXT,
    "decidedById" UUID,
    "submittedAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLogEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_id_key" ON "User"("tenantId", "id");

-- CreateIndex
CREATE INDEX "PurchaseRequest_tenantId_createdAt_idx" ON "PurchaseRequest"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseRequest_tenantId_status_createdAt_idx" ON "PurchaseRequest"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseRequest_tenantId_requesterId_createdAt_idx" ON "PurchaseRequest"("tenantId", "requesterId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseRequest_tenantId_amount_idx" ON "PurchaseRequest"("tenantId", "amount");

-- CreateIndex
CREATE INDEX "PurchaseRequest_tenantId_vendor_idx" ON "PurchaseRequest"("tenantId", "vendor");

-- CreateIndex
CREATE INDEX "AuditLogEntry_tenantId_createdAt_idx" ON "AuditLogEntry"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLogEntry_tenantId_entityType_entityId_createdAt_idx" ON "AuditLogEntry"("tenantId", "entityType", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_tenantId_requesterId_fkey" FOREIGN KEY ("tenantId", "requesterId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_tenantId_decidedById_fkey" FOREIGN KEY ("tenantId", "decidedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLogEntry" ADD CONSTRAINT "AuditLogEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLogEntry" ADD CONSTRAINT "AuditLogEntry_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants Prisma can't express in the schema. Keep these when editing the
-- affected columns: Prisma doesn't know about them.
ALTER TABLE "Tenant" ADD CONSTRAINT "tenant_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "User" ADD CONSTRAINT "user_email_lowercase" CHECK ("email" = lower("email"));

ALTER TABLE "PurchaseRequest"
  ADD CONSTRAINT "pr_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "pr_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  -- Timestamps, decider and reason must match the lifecycle stage.
  ADD CONSTRAINT "pr_status_consistency" CHECK (
    ("status" = 'DRAFT'     AND "submittedAt" IS NULL     AND "decidedAt" IS NULL     AND "decidedById" IS NULL     AND "rejectionReason" IS NULL) OR
    ("status" = 'SUBMITTED' AND "submittedAt" IS NOT NULL AND "decidedAt" IS NULL     AND "decidedById" IS NULL     AND "rejectionReason" IS NULL) OR
    ("status" = 'APPROVED'  AND "submittedAt" IS NOT NULL AND "decidedAt" IS NOT NULL AND "decidedById" IS NOT NULL AND "rejectionReason" IS NULL) OR
    ("status" = 'REJECTED'  AND "submittedAt" IS NOT NULL AND "decidedAt" IS NOT NULL AND "decidedById" IS NOT NULL AND "rejectionReason" IS NOT NULL AND length(trim("rejectionReason")) > 0)
  ),
  -- Separation of duties: nobody decides their own request.
  ADD CONSTRAINT "pr_no_self_decision" CHECK ("decidedById" IS NULL OR "decidedById" <> "requesterId");
