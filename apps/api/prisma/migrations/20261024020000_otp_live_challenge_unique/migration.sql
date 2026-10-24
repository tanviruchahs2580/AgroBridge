-- AUD-V3: at most ONE live (unconsumed) OTP challenge per user and purpose,
-- enforced by the database. The supersede-then-create flow could race two
-- concurrent requests into two live challenges, and verification then picked
-- a row nondeterministically. Any pre-existing duplicates are retired first
-- so the index can always be created (MAX(id) keeps one arbitrary survivor —
-- every duplicate is by definition a challenge the supersede meant to retire).
UPDATE "OtpChallenge" SET "consumedAt" = CURRENT_TIMESTAMP
WHERE "consumedAt" IS NULL
  AND "id" NOT IN (
    SELECT MAX("id") FROM "OtpChallenge" WHERE "consumedAt" IS NULL GROUP BY "userId", "purpose"
  );
CREATE UNIQUE INDEX IF NOT EXISTS "OtpChallenge_user_purpose_live_key" ON "OtpChallenge"("userId", "purpose") WHERE "consumedAt" IS NULL;
