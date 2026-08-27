-- Partial unique guard: at most one PENDING payment per purpose
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_purpose_pending_key" ON "Payment"("purposeType", "purposeId") WHERE status = 'PENDING';
