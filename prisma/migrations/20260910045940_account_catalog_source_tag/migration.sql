-- Shipped as a separate migration from 20260910030325_stage2b2_department_and_
-- confirmation_fields rather than amending it in place: that migration was
-- already applied to this local dev/test database while this one was being
-- designed, and editing an already-applied migration's SQL in place would
-- create a checksum mismatch the next time `prisma migrate deploy` runs
-- against those same databases. Both migrations are pre-Preview-deployment
-- additions to the same Stage 2B-2 feature - neither has been applied to
-- Preview/Neon yet.
--
-- Purpose: give Account an explicit, permanent "which chart of accounts"
-- tag (AccountCatalog) instead of relying on the incidental fact that
-- sourceSeq happens, today, to be set only by the one code path
-- (seedDemoMasterData.ts) that imports the separate 62-item M-class-only
-- demo chart. See prisma/schema.prisma's AccountCatalog/Account.catalog doc
-- comments and src/lib/budget/accountSelection.ts for the single place this
-- field is read.

-- CreateEnum
CREATE TYPE "AccountCatalog" AS ENUM ('OFFICIAL', 'FINANCE_DEMO');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "catalog" "AccountCatalog" NOT NULL DEFAULT 'OFFICIAL';

-- CreateIndex
CREATE INDEX "Account_catalog_idx" ON "Account"("catalog");

-- Backfill: sourceSeq IS NOT NULL is, by construction of this codebase, an
-- exact, deterministic partition - grep confirms `sourceSeq` is written
-- ONLY by seedDemoMasterData.ts's DEMO_ACCOUNTS upsert (ON CONFLICT
-- ("sourceSeq") DO UPDATE ...); no other seed or import path
-- (stage2aSeed.ts, masterDataImport.ts) ever sets it. This is a verified
-- code-level fact, not a name/code-shape guess - see prisma/schema.prisma's
-- pre-existing doc comment on Account.sourceSeq: "a real, non-demo
-- imported account simply leaves this null." Every other Account row
-- (majorCategory M/S/R/P alike) keeps the column default of 'OFFICIAL'.
-- Does not touch any BudgetLine row or its accountId - only classifies the
-- Account rows those existing BudgetLine rows already point at.
UPDATE "Account" SET "catalog" = 'FINANCE_DEMO' WHERE "sourceSeq" IS NOT NULL;
