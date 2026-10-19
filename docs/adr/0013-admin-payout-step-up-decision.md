# ADR-0013: Step-up authentication for admin and money-moving roles — decision

- **Status:** accepted (2026-10-19) — risk acceptance, review trigger below
- **Deciders:** engineering; upgrade trigger is an owner call
- **Related:** ADR-0003 (token storage), audit criterion SEC-02 ("admin/payout roles have step-up or documented risk acceptance")

## Context

Admin actions (role changes, user suspension, procurement oversight) and
payout approval can move money or privilege. Today they are protected by
role checks, a SUPER-only grant path with self-edit blocking, session
revocation on role change, an audit trail, and per-route rate limits — but by
a single credential: no second factor and no re-authentication step. The audit
asked for an explicit decision rather than an implicit omission.

## Decision

**Defer MFA/step-up during the pilot; record the acceptance and its
compensating controls; re-decide at the trigger points below.**

Compensating controls in force today (all tested):

1. Role grants are SUPER-only, cannot target self, and revoke the target's
   refresh tokens (`admin/routes.ts`) — privilege changes are loud in the
   audit log and end existing sessions.
2. RequireAuth re-reads the user's status on every request, so a suspension
   takes effect immediately for sessions already in flight.
3. Refresh tokens rotate with reuse detection (a replayed token kills the
   whole family), which bounds how long a stolen credential survives.
4. Payouts additionally require `phoneVerified` in production and are
   territory-scoped; withdrawals hold funds under the wallet row lock.
5. Every admin/payout action is audited with actor, target and request id.

## Trigger points (re-decide; do not silently drift)

- Before live payments are enabled (owner gate OD-07), or
- when a second admin/payout operator is added, or
- before Play store submission if any admin account is seeded on a shared
  device, or
- at the next annual review, whichever comes first.

Upgrade path (already supported by the data model): TOTP enrolment on the
User row plus a `requireStepUp` middleware on `/admin/*` and payout routes,
reusing the existing OTP challenge table with a `STEP_UP` purpose.

## Consequences

- The pilot keeps a one-credential admin path, accepted here explicitly
  rather than by omission.
- The compensating controls are pinned by existing tests; the next audit can
  verify them without re-deriving the decision.
