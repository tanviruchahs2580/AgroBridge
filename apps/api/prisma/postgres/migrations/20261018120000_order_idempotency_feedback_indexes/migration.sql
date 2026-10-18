-- AUD-125: idempotent checkout. clientRequestId is client-supplied; the
-- composite unique bounds it per user. NULL is distinct in PostgreSQL unique
-- indexes, so orders without a key may repeat freely.
ALTER TABLE "Order" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Order_userId_clientRequestId_key" ON "Order"("userId", "clientRequestId");

-- A7-07: advisory feedback lives on the query row (no new table).
ALTER TABLE "AdvisoryQuery" ADD COLUMN "feedbackReason" TEXT;
ALTER TABLE "AdvisoryQuery" ADD COLUMN "feedbackAt" TIMESTAMP(3);

-- D-09 evidence-based indexes (parity with the SQLite chain):
--  * User.region — the procurement queue/review, booking assignment and
--    payout authorization filter or assert on the user's region.
CREATE INDEX IF NOT EXISTS "User_region_idx" ON "User"("region");
--  * FarmEvent(farmId, occurredAt) — the farm timeline (farms/routes.ts
--    getEventsHandler) filters by farm and pages by occurredAt desc; the
--    [farmId] index alone cannot serve the ordering.
CREATE INDEX IF NOT EXISTS "FarmEvent_farmId_occurredAt_idx" ON "FarmEvent"("farmId", "occurredAt");
