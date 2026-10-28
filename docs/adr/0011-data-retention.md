# ADR-0011 — Data retention: financial rows are retained, deletion anonymizes identity

- Status: accepted
- Date: 2026-10-18
- Deciders: engineering + product owner; recorded from the implemented behaviour during the 2026-10-18 audit

## Context

Users can delete their account in-app (Settings → Account), and Google Play requires that path to
exist and to be honest about what it does. At the same time the platform moves money (wallet,
payments, procurement payouts) and Bangladesh bookkeeping norms expect transaction records to
survive the account that created them. A "delete everything" implementation would destroy the
ledger; a "soft delete only" implementation would misrepresent deletion to the user.

The implemented behaviour was audited against the code on 2026-10-18 (an earlier revision of
`docs/data-protection.md` described mechanics that had never been built — that drift is why this
ADR records the decision next to the implementation).

## Decision

1. **Two data classes, two rules.** Identity data belongs to the user and is deleted/anonymized on
   request. Financial/ledger rows (orders, payments, wallet transactions, withdrawals) are
   retained unmodified; they reference only the anonymized user id. The retention schedule and
   lawful basis are the table in `docs/data-protection.md` §"Retention schedule" (financial rows
   **5 years**, logs operator-configured, backups **30 days**).
2. **Deletion is fail-safe while money is in flight.** `DELETE /api/v1/auth/me`
   (`apps/api/src/modules/auth/routes.ts`) refuses (422) while the user has an order that is not
   CANCELLED/DELETED or a withdrawal in PENDING/APPROVED. The check runs **inside the same
   transaction** as the mutation so a concurrent withdrawal request cannot race past it into an
   anonymized account.
3. **What deletion does:** revokes every refresh token (rows retained, marked revoked), then
   anonymizes the user row — `fullName: "Deleted User"`, `email: null`, `phone: DEL-<userId>`,
   random password hash, `status: DISABLED`, notification preferences cleared. Support cannot
   "un-delete"; re-registration with the same phone number creates a fresh id.
4. **Backups are not rewritten.** Deletion does not propagate into existing dumps. On the compose
   deployment those dumps expire on their own 30-day schedule; on the live deployment (managed
   PostgreSQL) the snapshot window belongs to the provider. The privacy policy states the second
   case, and promises no fixed day-count ("as long as our database provider retains its snapshots
   (platform-managed); we do not operate our own backup jobs").
5. **Known gaps are named, not implied.** As of this ADR the implementation does **not** purge
   uploaded disease photos from `uploads/`/object storage, does not clear profile
   address/location fields, does not withdraw marketplace listings, and offers no data-export
   endpoint. These are recorded in `docs/data-protection.md` §"Not implemented yet" and remain
   open work; until they ship, the retention table is stated as policy for the mechanisms it
   names.
6. **Financial corrections are compensating entries, never edits.** This follows from retention:
   a retained ledger is only auditable if rows are immutable in practice. Operational consequence
   documented in `docs/runbooks/failed-transaction-recovery.md`.

## Consequences

- The user-facing claim ("your account is deleted, transaction records are kept for accounting")
  matches what the code does — verified by walking the handler, which is the standard this
  document sets for itself.
- Data-subject requests needing "everything": there is no export tool yet; the honest answer today
  is a manual extract, and that gap is tracked rather than promised away.
- Erasure beyond anonymization (e.g. purging photos) is deferred work with a named owner in the
  data-protection document; when it lands it changes the retention table, not this decision.

## Addendum (2026-10-24)

The residuals this ADR left open are now closed by code and this addendum is
that record: photo purging retries through the durable purge queue with a
daily drain (the retention job), profile-field clearing shipped with the
anonymizing deletion handler, and — the enforcement gap AUD-V3 flagged — the
policy is no longer dependent on a manual invocation: it runs daily as a
Vercel cron (`GET /api/v1/ops/retention`, CRON_SECRET-guarded) from the shared
executor in `apps/api/src/shared/retention.ts`, and the window now also covers
the four tables that previously grew without bound (AnalyticsEvent,
Notification, AiUsageLog, AdvisoryQuery). Backup expiry remains
platform-managed and the privacy policy says so.
