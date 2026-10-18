# Data Protection

Operational companion to `PRIVACY_POLICY.md` (user-facing). Scope: production PostgreSQL
+ local uploads + backups on the single-VM deployment.

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
