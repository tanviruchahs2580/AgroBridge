-- F-03/F-01: client idempotency keys become real, indexed columns.
--
-- Payment.intentKey: the client `Idempotency-Key` that created an intent lived
-- only inside metaStr, so the lookup was an un-indexable containment scan and
-- two concurrent same-key requests could each create a payable intent under
-- PostgreSQL READ COMMITTED. The column + unique index is the database
-- backstop; the route replays the winner on a P2002 conflict.
-- Withdrawal.clientRequestId: the withdrawal route had no idempotency mechanism
-- at all; the unique index makes a retried submission replay the original row
-- instead of reserving a second hold.
--
-- Order of operations matters: add nullable columns, then backfill the key out
-- of metaStr, and only THEN create the unique indexes. Creating them first
-- would fail on any environment where the race this change closes had already
-- produced two rows carrying the same key (the `crop_cycle_active_unique` trap,
-- F-59) — and a PLAIN backfill update would fail the same way, because SQLite
-- and PostgreSQL both enforce the unique index row-by-row as the UPDATE runs;
-- the probe for this migration reproduced exactly that collision. So the
-- backfill lifts the key only for the surviving row of each (userId, key)
-- group (following the sibling 20261024020000_otp_live_challenge_unique
-- pattern of choosing MAX(id)); the extras keep their Payment row and simply
-- keep intentKey NULL, and remain visible to reconciliation.
--
-- Blast radius: `ADD COLUMN` is metadata-only in SQLite; the backfill is one
-- bounded UPDATE over Payment (live payments were not enabled before this
-- change, so the table is small); each CREATE UNIQUE INDEX takes the table's
-- write lock while it builds. No row is deleted — a non-surviving duplicate
-- only loses the ability to be the key's replay target.
--
-- Rollback: DROP INDEX "Payment_userId_intentKey_key"; DROP INDEX
-- "Withdrawal_userId_clientRequestId_key"; the two columns are nullable and
-- ignored by code without this migration, so leaving them in place is safe
-- (SQLite 3.35+ can also drop them, at a table-rebuild cost).
--
-- Pre-flight for the operator (the backfill handles collisions, but this is
-- what to run if you want the duplicate count BEFORE deploying):
--   SELECT "userId", json_extract("metaStr", '$.idempotencyKey'), COUNT(*)
--   FROM "Payment"
--   WHERE "metaStr" IS NOT NULL AND json_valid("metaStr")
--     AND json_type("metaStr", '$.idempotencyKey') = 'text'
--   GROUP BY 1, 2 HAVING COUNT(*) > 1;
-- Withdrawal needs no pre-flight: the column is new, so every existing row is
-- NULL and NULLs never collide in a unique index.
ALTER TABLE "Payment" ADD COLUMN "intentKey" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN "clientRequestId" TEXT;

-- Backfill: lift a legacy `metaStr.idempotencyKey` string into the new column,
-- for one survivor per (userId, key) only. The json_valid/json_type guards mean
-- a corrupt or non-object metaStr cannot abort the migration (the runtime
-- parser, paymentMetaOf, tolerates those too); such rows are recovered by the
-- read path's metaStr fallback at replay time.
UPDATE "Payment"
SET "intentKey" = json_extract("metaStr", '$.idempotencyKey')
WHERE "intentKey" IS NULL
  AND "metaStr" IS NOT NULL
  AND json_valid("metaStr")
  AND json_type("metaStr", '$.idempotencyKey') = 'text'
  AND "id" IN (
    SELECT MAX("id") FROM "Payment"
    WHERE "metaStr" IS NOT NULL
      AND json_valid("metaStr")
      AND json_type("metaStr", '$.idempotencyKey') = 'text'
    GROUP BY "userId", json_extract("metaStr", '$.idempotencyKey')
  );

CREATE UNIQUE INDEX "Withdrawal_userId_clientRequestId_key" ON "Withdrawal"("userId", "clientRequestId");
CREATE UNIQUE INDEX "Payment_userId_intentKey_key" ON "Payment"("userId", "intentKey");
