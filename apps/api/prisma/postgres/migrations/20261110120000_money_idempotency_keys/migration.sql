-- Parity with the SQLite chain (20261110120000): client idempotency keys become
-- real, indexed columns on Payment (intentKey) and Withdrawal (clientRequestId).
-- See the SQLite twin for the full rationale, blast radius and rollback path.
--
-- The backfill is written as CASE ... WHEN "metaStr" IS JSON so the `::jsonb`
-- cast is only evaluated for valid JSON: PostgreSQL is free to reorder plain
-- WHERE conjuncts, and a bare cast of a legacy non-JSON metaStr would abort the
-- migration. CASE guarantees the evaluation order. `IS JSON` needs PG 16+; this
-- project pins PostgreSQL 17 in CI and production.
--
-- Pre-flight (optional — the retirement step below handles collisions):
--   SELECT "userId", "metaStr"::jsonb ->> 'idempotencyKey', COUNT(*)
--   FROM "Payment"
--   WHERE "metaStr" IS JSON AND jsonb_typeof("metaStr"::jsonb) = 'object'
--     AND jsonb_typeof("metaStr"::jsonb -> 'idempotencyKey') = 'string'
--   GROUP BY 1, 2 HAVING COUNT(*) > 1;
ALTER TABLE "Payment" ADD COLUMN "intentKey" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN "clientRequestId" TEXT;

-- Survivor-only backfill (see the SQLite twin: a plain backfill collides with
-- the unique index when the F-03 race already produced duplicates; MAX(id)
-- picks the survivor, extras keep their row and stay NULL).
UPDATE "Payment"
SET "intentKey" = CASE
  WHEN "metaStr" IS JSON
   AND jsonb_typeof("metaStr"::jsonb) = 'object'
   AND jsonb_typeof("metaStr"::jsonb -> 'idempotencyKey') = 'string'
  THEN "metaStr"::jsonb ->> 'idempotencyKey'
END
WHERE "metaStr" IS NOT NULL
  AND "intentKey" IS NULL
  AND "id" IN (
    SELECT max("id") FROM "Payment"
    WHERE "metaStr" IS JSON
      AND jsonb_typeof("metaStr"::jsonb) = 'object'
      AND jsonb_typeof("metaStr"::jsonb -> 'idempotencyKey') = 'string'
    GROUP BY "userId", "metaStr"::jsonb ->> 'idempotencyKey'
  );

CREATE UNIQUE INDEX "Withdrawal_userId_clientRequestId_key" ON "Withdrawal"("userId", "clientRequestId");
CREATE UNIQUE INDEX "Payment_userId_intentKey_key" ON "Payment"("userId", "intentKey");
