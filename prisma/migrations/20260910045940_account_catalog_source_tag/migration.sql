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

-- Backfill: sourceSeq IS NOT NULL is, by construction of THIS codebase at
-- the time this migration was authored, an exact, deterministic partition -
-- grep confirms `sourceSeq` is written ONLY by seedDemoMasterData.ts's
-- DEMO_ACCOUNTS upsert (ON CONFLICT ("sourceSeq") DO UPDATE ...); no other
-- seed or import path (stage2aSeed.ts, masterDataImport.ts) ever sets it.
-- That fact is true of the code in this repository, but it says nothing
-- about what a target database (in particular Preview/Neon, which this
-- migration has never yet been applied to) might actually contain - a
-- database that picked up extra sourceSeq-tagged "official" rows through
-- some other path (a manual fix, a different import run, etc.) would be
-- silently misclassified by a bare UPDATE with no way to notice. The guard
-- below re-verifies, against the ACTUAL target database, every property the
-- backfill's correctness depends on, and aborts the whole migration (inside
-- the same transaction Prisma already wraps this file in - one failed
-- statement anywhere in this file rolls back everything above, including
-- the CREATE TYPE/ALTER TABLE/CREATE INDEX) rather than silently applying a
-- wrong classification. Every check is a pure read (no UPDATE/DELETE/INSERT
-- happens before this point), and every RAISE EXCEPTION message reports
-- only computed row counts - never a connection string, credential, or any
-- column value from the data itself.
DO $$
DECLARE
  v_total_tagged integer;
  v_wrong_class integer;
  v_dup_seq integer;
  v_stage2a_collision integer;
  -- Snapshot of STAGE2A_ACCOUNTS' M-class `code` values (src/lib/testdata/
  -- stage2aAccounts.ts) at the time this migration was authored - the
  -- canonical Stage 2B-1/2B-2 OFFICIAL chart for 17203's own class. These
  -- are real 4-7 digit accounting codes (e.g. "6110010"), structurally
  -- disjoint from DEMO_ACCOUNTS' plain "3".."67" sequential codes; this
  -- list exists purely as a defensive tripwire so a future/foreign dataset
  -- that happens to reuse one of these exact codes on a sourceSeq-tagged
  -- row can never be silently reclassified as FINANCE_DEMO.
  v_stage2a_codes text[] := ARRAY[
    '6110010','6110020','6110030','6110040','6110050','6110060','6110061',
    '6110070','6110080','6110090','6110091','6117020','6119010','6127',
    '6128','6131','6133','6134','6114','6120','6130','6137','6138','6140',
    '6141','6113010','6113020','6113030','6117010','6132010','6132020',
    '6132030','6111','6112','6115','6116','6118','6121','6122','6135',
    '6136','6139','6143','6119020','6142010','6142020','6123','6124',
    '6125','6144','6189','6145','6187','6188010','6188020','6188030',
    '6188040','6188050','6188060','6188061','6188070','6188080'
  ];
BEGIN
  -- (1) either 0 (this database has never run the DEMO master-data seed yet
  -- - a legitimate, safe state: nothing to backfill, the UPDATE below is a
  -- no-op) or exactly 62 sourceSeq-tagged rows. Any other count is neither
  -- of those two known-safe shapes and must not be guessed at.
  SELECT count(*) INTO v_total_tagged FROM "Account" WHERE "sourceSeq" IS NOT NULL;
  IF v_total_tagged NOT IN (0, 62) THEN
    RAISE EXCEPTION 'account_catalog_source_tag 部署前防呆失敗：預期 sourceSeq 非空的科目為 0 筆（尚未初始化 DEMO 主檔）或恰為 62 筆，實際偵測到 % 筆，migration 已全數中止、未套用任何變更（含 CREATE TYPE/ALTER TABLE/CREATE INDEX），請人工確認科目主檔內容後再重試', v_total_tagged;
  END IF;

  -- (2) all 62 are majorCategory = 'M'.
  SELECT count(*) INTO v_wrong_class FROM "Account" WHERE "sourceSeq" IS NOT NULL AND "majorCategory" <> 'M';
  IF v_wrong_class <> 0 THEN
    RAISE EXCEPTION 'account_catalog_source_tag 部署前防呆失敗：發現 % 筆 sourceSeq 非空但 majorCategory 不是 M 的科目，migration 已全數中止、未套用任何變更，請人工確認科目主檔內容後再重試', v_wrong_class;
  END IF;

  -- (3) sourceSeq has no duplicate values among the tagged rows.
  SELECT count(*) INTO v_dup_seq FROM (
    SELECT "sourceSeq" FROM "Account" WHERE "sourceSeq" IS NOT NULL GROUP BY "sourceSeq" HAVING count(*) > 1
  ) dup;
  IF v_dup_seq <> 0 THEN
    RAISE EXCEPTION 'account_catalog_source_tag 部署前防呆失敗：發現 % 個重複的 sourceSeq 值，migration 已全數中止、未套用任何變更，請人工確認科目主檔內容後再重試', v_dup_seq;
  END IF;

  -- (4) none of the tagged rows' `code` collides with a known Stage 2A OFFICIAL code.
  SELECT count(*) INTO v_stage2a_collision FROM "Account" WHERE "sourceSeq" IS NOT NULL AND "code" = ANY(v_stage2a_codes);
  IF v_stage2a_collision <> 0 THEN
    RAISE EXCEPTION 'account_catalog_source_tag 部署前防呆失敗：發現 % 筆 sourceSeq 非空的科目，其 code 與 Stage 2A 正式科目代碼重疊，migration 已全數中止、未套用任何變更，請人工確認科目主檔內容後再重試', v_stage2a_collision;
  END IF;
END $$;

-- Only reached when every guard above passed. `sourceSeq IS NOT NULL` is,
-- by construction of this codebase, an exact, deterministic partition (see
-- the comment above the guard block) - never a name/code-shape guess. Every
-- other Account row (majorCategory M/S/R/P alike) keeps the column default
-- of 'OFFICIAL'. Does not touch any BudgetLine row or its accountId - only
-- classifies the Account rows those existing BudgetLine rows already point
-- at.
UPDATE "Account" SET "catalog" = 'FINANCE_DEMO' WHERE "sourceSeq" IS NOT NULL;
