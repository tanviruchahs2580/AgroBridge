-- Parity with the SQLite chain (20261024020000): one live OTP challenge per
-- user and purpose, with duplicates retired before the index is created.
UPDATE "OtpChallenge" SET "consumedAt" = CURRENT_TIMESTAMP
WHERE "consumedAt" IS NULL
  AND "id" NOT IN (
    SELECT MAX("id") FROM "OtpChallenge" WHERE "consumedAt" IS NULL GROUP BY "userId", "purpose"
  );
CREATE UNIQUE INDEX IF NOT EXISTS "OtpChallenge_user_purpose_live_key" ON "OtpChallenge"("userId", "purpose") WHERE "consumedAt" IS NULL;
