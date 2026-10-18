# Data Protection

Operational companion to `PRIVACY_POLICY.md` (user-facing). Scope: production PostgreSQL
+ local uploads + backups on the single-VM deployment.

## Retention schedule

| Data | Where | Retention | Mechanism |
|---|---|---|---|
| Account & profile data | PostgreSQL | account lifetime | deleted/anonymized at account deletion |
| Auth refresh tokens | PostgreSQL | 7 days (TTL) | expiry + rotation |
| Crop/disease photos | `uploads/` volume | account lifetime | *not yet purged at deletion (see below)* |
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
3. **Anonymizes the user row**: name → `Deleted User`, email → null, phone → `DEL-<userId>`,
   password hash replaced with random bytes, status → `DISABLED`, notification preferences cleared.
4. **Financial/ledger rows are retained unmodified** (orders, payments, wallet entries) for
   legal integrity and accounting audit — they reference the anonymized user id only.
5. Backup interaction: deletion is *not* propagated into existing dumps. Backups expire on
   their own **30-day** schedule — worst case, a pre-deletion copy survives ≤30 days.
   This is disclosed in the privacy policy ("up to 30 days in backups").

**Not implemented yet** (recorded as audit findings; owner must prioritise):

- Uploaded disease photos are **not** purged from the uploads volume or object storage.
- Profile address/location fields are not explicitly cleared.
- Marketplace listings/offers are not withdrawn.
- There is **no data-export endpoint** — users cannot obtain a copy of their data.

Support cannot "un-delete". Re-registration with the same phone number creates a fresh user id.

Until the items above ship, treat the retention table as *policy* for the mechanisms it
names and check this section before making user-facing deletion claims.

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
| Photos (crop images) | Yes | App functionality (disease detection) | Yes | Yes |
| Financial info (payment/wallet transactions) | Yes | App functionality (payments, payouts) | Yes | **No** — retained 5y per bookkeeping norms |
| Device or other IDs | Yes | Analytics (self-hosted), crash reporting | Yes | No (aggregated, non-identifying) |
| Contacts / SMS / gallery | **No** | — | — | — |
| Precise location beyond farm plot input | **No** (only plot coordinates the user enters) | — | — | — |

All network traffic is TLS via the nginx edge (`docker/web.nginx.prod.conf`). No ads SDKs,
no third-party analytics — crash/analytics are self-hosted.
