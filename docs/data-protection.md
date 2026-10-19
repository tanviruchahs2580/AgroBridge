# Data Protection

Operational companion to `PRIVACY_POLICY.md` (user-facing). Scope: production PostgreSQL
+ local uploads + backups on the single-VM deployment.

Current production reality (2026-10-19): the API runs as Vercel Functions and writes to PostgreSQL
on Neon, and uploads use `STORAGE_PROVIDER=db` (durable rows in the database), not instance-local
disk (`docs/runbooks/live-deployment.md`; `docs/runtime-contract.md`). The "backups on the
single-VM deployment" scope below describes the docker-compose deployment path; where it differs
from the Vercel+Neon path (notably backup ownership), the platform configuration is authoritative
and the gap is tracked in `.audit/v2/DECISIONS.md`. Related: `docs/threat-model.md` (AC-09, AC-14)
for upload and log-exposure controls.

## Retention schedule

| Data | Where | Retention | Mechanism |
|---|---|---|---|
| Account & profile data | PostgreSQL | account lifetime | deleted/anonymized at account deletion (incl. `region`, address fields) |
| Auth refresh tokens | PostgreSQL | 7 days (TTL) | expiry + rotation + revoked at deletion |
| OTP challenges | PostgreSQL | 5 minutes / until consumed | expiry; **deleted at account deletion** |
| Crop/disease photos (files) | storage provider (`uploads/` or S3) | account lifetime | **purged at deletion** (best-effort per file; failures logged) |
| Disease-case metadata rows | PostgreSQL | account lifetime | retained after deletion (no file bytes; advisory record) |
| Transaction/wallet ledger rows | PostgreSQL | **5 years** | legal retention — never anonymized early |
| Application logs (pino stdout) | log platform | operator-configured (suggest 30d) | log platform retention |
| Backups (`pg_dump`, snapshots) | backup storage | **30 days**, then auto-expire | backup job retention policy |
| Upload backups | secondary storage | 30 days | same |

## Account deletion mechanics

Triggered by in-app **Settings → Delete Account** (`DELETE /api/v1/auth/me`).
**What the code actually does** (verified against the handler on 2026-10-18; an earlier
revision of this document described behaviour that was never built):

1. **Blocks** deletion while the account has unpaid/pending orders or open withdrawals
   (the response asks the user to resolve them first).
2. Revokes all refresh tokens for the user (rows are retained, marked revoked).
3. **Deletes the OTP challenges** for the user's pre-anonymization phone (pure auth
   secrets, no retention value).
4. **Anonymizes the user row**: name → `Deleted User`, email → null, phone → `DEL-<userId>`,
   password hash replaced with random bytes, status → `DISABLED`, notification preferences
   cleared, `region` cleared.
5. **Clears the address-like profile fields the schema actually has** on `FarmerProfile`:
   `address`, `district`, `upazila`, `nidLast4`.
6. **Purges uploaded disease photos** from the configured storage provider (local disk or
   S3). This is **best-effort per file**: a storage failure is logged with the affected key
   and counted, but the deletion still succeeds — the DB row is already anonymized and
   re-running deletion is not possible, so failing the request would strand the account in a
   half-deleted state. (Verified by tests: files disappear from the uploads dir; a forced
   storage failure still returns `{deleted:true}`.)
7. **Financial/ledger rows are retained unmodified** (orders, payments, wallet entries,
   procurement orders, bookings) for legal integrity and accounting audit — they reference
   the anonymized user id only.
8. Backup interaction: deletion is *not* propagated into existing dumps. Backups expire on
   their own **30-day** schedule — worst case, a pre-deletion copy survives ≤30 days.
   This is disclosed in the privacy policy ("up to 30 days in backups").

**Known residuals** (verified against the code on 2026-10-18 — do not claim more):

- **Disease-case metadata rows survive deletion** (diagnosis text, storage key). The photo
  *bytes* are purged (step 6); the advisory record itself is retained with the anonymized
  user id. If policy later requires removing these, the cascade is one `deleteMany`.
- **PNG/WebP metadata is not stripped.** Only JPEG APP1 (EXIF/GPS/XMP) is removed at
  upload; PNG text chunks and WebP EXIF pass through unchanged.
- **Marketplace listings: not applicable.** `Product.supplier` is free text with **no owner
  relation** in the schema — there is no user-owned listing to withdraw. Farmers' own rows
  (`ProcurementOrder`, `Order`, `Booking`) are retained as business records (step 7).
- **Backups are not rewritten** (step 8).

## Data export — `GET /api/v1/auth/me/export`

Added 2026-10-18 (AUD-130). Authenticated, rate-limited to **5 requests/hour per user**,
returns `Content-Disposition: attachment; filename="agrobridge-export-<userId>.json"` with
**only the caller's data**:

- profile (every `User` field **except `passwordHash`**), farmer profile;
- farms + plots + crop cycles + farm events;
- orders + items, payments (status/amount/reference fields), wallet + wallet transactions;
- bookings, procurement offers, disease-case metadata (storage key only — never file bytes);
- notifications (latest 200), advisory history (latest 200, refs re-filtered against the
  live knowledge base), organization memberships.

The response is generated on demand and **never persisted server-side**; each export writes
a `USER_DATA_EXPORTED` audit row. Scoping (no cross-user rows) is covered by
`apps/api/tests/auth-export.test.ts`.

Support cannot "un-delete". Re-registration with the same phone number creates a fresh user id.

## Breach notification runbook (72h internal escalation)

| T | Action |
|---|---|
| T+0 | Detect (alert/log/user report). Open incident channel `#inc-<date>`. |
| T+1h | On-call confirms scope: which data, how many users, still ongoing? |
| T+4h | Contain: rotate JWT secrets / revoke sessions / patch or isolate. Snapshot evidence (logs, timestamps) before cleanup. |
| T+24h | Draft impact statement (data categories × affected count × exposure window). Legal/regulatory assessment vs Bangladesh ICT/privacy guidance. |
| T+48h | Notify affected users **in-app + SMS** if personal data exposed. Prepare regulator notice if required. |
| T+72h | Hard deadline: internal post-mortem circulated to [Company] management with root cause + fix ETA. |

Template fields for the incident doc: detection time, discovery source, data categories
(auth? photos? financial?), affected-user estimate, containment steps + times, comms sent,
root cause, corrective actions w/ owners.

## Play Console — Data Safety form mapping

Source of truth: `apps/api/prisma/schema.prisma` + this document.

| Data type | Collected? | Purpose | Encrypted in transit | Deletable by user |
|---|---|---|---|---|
| Phone number | Yes | Account mgmt, app functionality (OTP) | Yes (TLS) | Yes (account deletion; financial refs retained) |
| Name | Yes | App functionality (profile, orders) | Yes | Yes (anonymized) |
| Physical address (farm location/GPS) | Yes | App functionality (advisories, logistics) | Yes | Yes |
| Photos (crop images) | Yes | App functionality (disease detection) | Yes | Yes (files purged at account deletion; JPEG EXIF stripped at upload) |
| Financial info (payment/wallet transactions) | Yes | App functionality (payments, payouts) | Yes | **No** — retained 5y per bookkeeping norms |
| Device or other IDs | Yes | Analytics (self-hosted), crash reporting | Yes | No (aggregated, non-identifying) |
| Contacts / SMS / gallery | **No** | — | — | — |
| Precise location beyond farm plot input | **No** (only plot coordinates the user enters) | — | — | — |

All network traffic is TLS via the nginx edge (`docker/web.nginx.prod.conf`). No ads SDKs,
no third-party analytics — crash/analytics are self-hosted.

## Retention enforcement job (2026-10-19, SEC-06 / ADR-0011)

`npm run retention --workspace apps/api` (cron: `0 5 * * *`) hard-deletes only rows past
their documented window and is safe to re-run. Implementation: `apps/api/scripts/retention.mjs`,
covered by `apps/api/tests/retention-job.test.ts` (old rows go, window rows survive).

| Data | Window after expiry/consumption/creation | Rationale |
|---|---|---|
| Auth refresh tokens (expired or revoked) | **30 days** | session-archaeology value ends with the token; rotation already revokes |
| OTP challenges (consumed or expired) | **24 hours** | dead auth secrets, stored hashed — no retention value |
| `AuditLog` rows | **180 days** | security-trail window (security events only; no message bodies) |
| `PendingUploadPurge` rows | **30 days, after one final drain attempt** | the queue is retried through the existing purge job before the row is dropped, so the last failure reason is not discarded without trying |

The job runs an idempotent purge-queue drain first, then deletes the aged queue rows; a failed
drain is logged and exits non-zero (the deletion still proceeds by policy).

## Consent capture at registration (2026-10-19, PRD-05 / AUD-150)

Registering requires accepting the published Terms of Service and Privacy Policy:
`POST /api/v1/auth/register` refuses a body without `consent: true` (400 `BAD_REQUEST`,
older clients included — intended), and on success writes an append-only `CONSENT_CAPTURED`
audit row against the new user whose `meta.policyVersion` records the accepted document
version (mirrored by `POLICY_VERSION` in the auth module and `LEGAL_META.version` in
`apps/web/src/features/legal/content.ts`; a parity test pins the two together). The audit
row's `createdAt` is the consent timestamp. The web Register form shows the checkbox with
links to `/terms` and `/privacy` and blocks submit until it is checked.

## Demo seed separation (2026-10-19, API-06)

`prisma db seed` is split into **reference data** (membership plans, product and service
catalogue — always seeded, every environment; the code splits it as `seedReferenceData`)
and **demo data** (demo users with the public password `Demo@1234`, wallets, farm, demo
service providers — `seedDemoData`). In production the demo layer is refused unless BOTH
`ALLOW_DEMO_SEED=1` AND `ALLOW_DEMO_CREDENTIALS_IN_PRODUCTION=1` are set; with both set it
logs a loud warning listing every demo phone before writing. Both flags are seed-time only
(read by `apps/api/prisma/seed.ts`, never by the API at runtime), which is why they do not
appear in the API's `.env.example` (whose parity gate covers variables the API reads).
