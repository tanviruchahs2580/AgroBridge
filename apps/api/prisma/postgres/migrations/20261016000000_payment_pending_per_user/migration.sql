-- Parity with the SQLite chain: one live PENDING payment intent per USER and
-- purpose. purposeId is a shared business key for MEMBERSHIP (the tier name),
-- so a purpose-global partial unique would block the second user ever to open
-- a checkout for the same tier.
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_user_purpose_pending_key" ON "Payment"("userId", "purposeType", "purposeId") WHERE status = 'PENDING';
