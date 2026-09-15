-- Wallet withdrawal holds: reserve funds under the wallet row's write lock
-- instead of re-aggregating PENDING withdrawals (which raced under
-- concurrency: two parallel requests could both pass the availability check).
ALTER TABLE "Wallet" ADD COLUMN "heldPaisa" INTEGER NOT NULL DEFAULT 0;

-- Backfill: held = sum of PENDING withdrawal amounts. (APPROVED withdrawals
-- have already debited balancePaisa, so they must NOT be counted as holds.)
UPDATE "Wallet" SET "heldPaisa" = COALESCE((
  SELECT SUM(w."amountPaisa") FROM "Withdrawal" w
  WHERE w."userId" = "Wallet"."userId" AND w."status" = 'PENDING'
), 0);
