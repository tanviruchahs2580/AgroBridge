-- SEC-04 (FIX-14): TOTP enrolment for privileged logins and the STEP_UP
-- purpose vocabulary for SMS re-auth gates. Additive, nullable — no backfill.
ALTER TABLE "User" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "totpEnabledAt" DATETIME;
