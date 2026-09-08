-- Data migration: retire the provisional FIN-<zero-padded 序> account codes
-- in favour of the real Excel A欄「序號」as `code` (see
-- src/lib/demo/constants.ts / demoAccountCode()). Idempotent and narrowly
-- scoped: only touches rows whose `code` still matches the exact
-- FIN-<sourceSeq zero-padded to 3 digits> pattern this system ever
-- generated itself, so it is a no-op on a database that has already been
-- migrated (or never had FIN-xxx codes in the first place), and it never
-- touches any other account's code. The Account `id` (and therefore every
-- BudgetLine/AuditLog/etc. foreign key referencing it) is left untouched -
-- this only ever updates `code` and `isProvisionalCode` in place.
UPDATE "Account"
SET "code" = "sourceSeq"::text,
    "isProvisionalCode" = false
WHERE "sourceSeq" IS NOT NULL
  AND "code" = 'FIN-' || LPAD("sourceSeq"::text, 3, '0');

-- CreateIndex
CREATE UNIQUE INDEX "Account_sourceSeq_key" ON "Account"("sourceSeq");
