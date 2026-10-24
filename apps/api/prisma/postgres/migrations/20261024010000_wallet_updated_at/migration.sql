-- Parity with the SQLite chain (20261024010000): Wallet gains updatedAt.
-- Nullable + backfilled so this can be applied BEFORE the code deploy: the
-- still-running old client omits the column on INSERT, which a NOT NULL
-- column would reject — this ordering is what makes the release
-- zero-downtime (migrate first, then deploy).
ALTER TABLE "Wallet" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "Wallet" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;
