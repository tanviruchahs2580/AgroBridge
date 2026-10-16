-- One live PENDING payment intent per USER and purpose (not per purpose
-- globally): purposeId is a shared business key for MEMBERSHIP (the tier
-- name), so the previous global partial unique blocked the second user ever
-- to open a checkout for the same tier. The app-layer supersede in
-- payments/routes.ts has been scoped to the acting user; this index matches
-- that invariant. Replaces Payment_purpose_pending_key (20260826140000).
DROP INDEX IF EXISTS "Payment_purpose_pending_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_user_purpose_pending_key" ON "Payment"("userId", "purposeType", "purposeId") WHERE status = 'PENDING';
