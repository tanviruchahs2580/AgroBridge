# Data Protection

Operational companion to `PRIVACY_POLICY.md` (user-facing). Scope: production PostgreSQL
+ local uploads + backups on the single-VM deployment.

## Retention schedule

| Data | Where | Retention | Mechanism |
|---|---|---|---|
| Account & profile data | PostgreSQL | account lifetime | deleted/anonymized at account deletion |
| Auth refresh tokens | PostgreSQL | 7 days (TTL) | expiry + rotation |
| Crop/disease photos | `uploads/` volume | account lifetime | removed with account deletion |
| Transaction/wallet ledger rows | PostgreSQL | **5 years** | legal retention — never anonymized early |
| Application logs (pino stdout) | log platform | operator-configured (suggest 30d) | log platform retention |
| Backups (`pg_dump`, snapshots) | backup storage | **30 days**, then auto-expire | backup job retention policy |
| Upload backups | secondary storage | 30 days | same |

## Account deletion mechanics

Triggered by in-app **Settings → Delete Account** (API endpoint under `/api/v1`), matching
the planned API behavior:

1. **Anonymize identity fields** on the user row: name → `Deleted User <hash8>`, phone →
   deterministic tombstone (e.g., `deleted:<userIdHash>`), address/location cleared,
   photo URLs purged from object storage.
2. Sessions/tokens revoked; auth records deleted immediately.
3. **Financial/ledger rows are retained unmodified** (orders, payments, wallet entries) for
   legal integrity and accounting audit — they reference the anonymized user id only.
4. Marketplace listings/offers belonging to the user are withdrawn.
5. Backup interaction: deletion is *not* propagated into existing dumps. Backups expire on
   their own **30-day** schedule — worst case, a pre-deletion copy survives ≤30 days.
   This is disclosed in the privacy policy ("up to 30 days in backups").

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
| Photos (crop images) | Yes | App functionality (disease detection) | Yes | Yes |
| Financial info (payment/wallet transactions) | Yes | App functionality (payments, payouts) | Yes | **No** — retained 5y per bookkeeping norms |
| Device or other IDs | Yes | Analytics (self-hosted), crash reporting | Yes | No (aggregated, non-identifying) |
| Contacts / SMS / gallery | **No** | — | — | — |
| Precise location beyond farm plot input | **No** (only plot coordinates the user enters) | — | — | — |

All network traffic is TLS via the nginx edge (`docker/web.nginx.prod.conf`). No ads SDKs,
no third-party analytics — crash/analytics are self-hosted.
