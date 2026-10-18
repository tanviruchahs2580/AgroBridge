# Runbook — Failed Transaction Recovery

Money-touching failures are handled by the API's own claim-then-apply logic first; this runbook is
for the cases that leak through: a payment that stayed PENDING, a wallet whose ledger no longer
adds up, a withdrawal stuck mid-decision, or a migration gap that makes the above unreadable.
**Rule zero: never edit financial rows by hand.** Corrections are compensating ledger entries or a
re-run of the documented recovery path — `docs/data-protection.md` keeps financial rows retained
and unmodified for exactly this reason.

## Triggers

- `apps/api/scripts/reconcile-wallet.mjs` exits **1** (daily cron; see below).
- Prometheus `PaymentFailures` alert (`monitoring/alert_rules.yml`: > 5 failed intents / 10 min).
- User report: order paid but still PENDING; withdrawal APPROVED but money absent; duplicate debit.
- `/ready` `schema.latest` older than the newest directory in `apps/api/prisma/postgres/migrations`
  (ADR-0007 — the deploy gate should have caught this, and now fails the push when it does not).

## Step 1 — Establish the facts (read-only, no writes)

```bash
# Daily reconciliation (cron on the VM: 0 4 * * * cd /srv/agrobridge/apps/api && node scripts/reconcile-wallet.mjs)
cd apps/api && node scripts/reconcile-wallet.mjs
# exit 0 → "reconcile-wallet: OK — N wallets verified"
# exit 1 → prints up to 10 mismatches: {userId, stored, computed} for balances and heldPaisa

# Deployment/schema facts (does the running code match the repo's migration chain?)
curl -s https://agro-bridge-api-vantiq-systems.vercel.app/ready
ls apps/api/prisma/postgres/migrations | sort | tail -3     # newest applied-name to compare

# The payment in question (status + whether the provider actually took the money)
curl -s -H "Authorization: Bearer <admin-token>" \
  https://agro-bridge-api-vantiq-systems.vercel.app/api/v1/payments/<paymentId>/status
```

`GET /payments/:id/status` is the reconciliation probe: for a PENDING payment it re-asks the live
provider and settles the payment if the money moved. It is safe to call repeatedly — settlement is
claimed atomically, and a second call cannot apply the side effects twice.

## Step 2 — Stuck PENDING payment

1. Run the status probe above for each affected payment. `{status:"SUCCEEDED", reconciled:true}`
   means the missing side effects (order confirmation, wallet credit) were applied — resolve the
   user report.
2. Still PENDING after the probe: the gateway says unpaid. In **sandbox** mode
   (`PAYMENT_PROVIDER=sandbox`) a payment is completed via `POST /payments/:id/confirm`; in live
   mode, do not simulate — ask the gateway dashboard, and if the buyer's money moved without webhook
   settlement, capture the gateway reference in the incident log and treat it as a provider dispute.
3. Webhook signature failures (`sslcommerzSignature`, `apps/api/src/modules/payments/routes.ts`)
   reject at the edge. If the `SSLCOMMERZ_*` credentials were rotated wrongly, fix the credential
   (secret-rotation.md) and re-run the status probe for the affected window.

## Step 3 — Wallet mismatch (reconcile-wallet exit 1)

The script compares, per wallet, `SUM(ledger CREDIT − DEBIT)` against `balancePaisa`, and
`heldPaisa` against the sum of PENDING withdrawals.

1. Capture the mismatch JSON verbatim in the incident record (it is the evidence).
2. Classify:
   - **balance ≠ ledger**: a write applied without its counterpart row (crash between the two
     halves of a transaction that should have been atomic — which is why checkout/payout run in a
     single `prisma.$transaction`; a mismatch means something bypassed it).
   - **heldPaisa ≠ PENDING sum**: a withdrawal was decided without releasing/consuming its hold —
     check the withdrawal's current status in `GET /admin/withdrawals?status=PENDING|APPROVED|REJECTED|PAID`.
3. Recovery for a stuck withdrawal: finish the decision through the admin path
   `POST /admin/withdrawals/:id/decision` with `{action: "APPROVE" | "REJECT" | "MARK_PAID", note}`
   (permission `finance:withdrawals`). APPROVE debits the wallet and releases the hold atomically;
   REJECT releases the hold; MARK_PAID completes an already-APPROVED manual transfer. Never UPDATE
   the wallet row directly.
4. If no admin action can produce the correct ledger state, the fix is a **compensating
   `WalletTransaction`** with an explicit reason (and an `audit` entry), applied through the same
   service/transaction path as production writes — or a restore (Step 5). A hand-written row with
   no counterpart is how the next mismatch is born.
5. Re-run `node scripts/reconcile-wallet.mjs` and require exit **0** before closing.

## Step 4 — Refunds (sandbox / platform-initiated)

`POST /payments/:id/refund` (`payments:refund`) exists for ORDER payments under the **sandbox**
provider: it moves the payment `SUCCEEDED → REFUNDED` atomically and records a platform-wallet
debit. For live-gateway payments the endpoint refuses — the real refund must be issued in the
gateway dashboard (marking a payment REFUNDED while the buyer's money sits with the gateway would
be a lie). Membership purchases are non-refundable while active.

## Step 5 — Schema gap or unrecoverable state

```bash
# Apply any missing migrations — idempotent, baseline-aware (safe to re-run)
cd apps/api && DATABASE_URL="$DATABASE_URL_UNPOOLED" node scripts/deploy-migrations.mjs
# then compare /ready schema.latest with the repo's newest migration again
```

If data itself is wrong beyond compensation: stop, take a backup, and follow
`docs/disaster-recovery.md` §"Restore procedure". Rehearse first on scratch:

```bash
npm run pg:rehearse-backup -w apps/api     # backup → destroy scratch → restore → row-count verify
```

## Verification (all required to close an incident)

- [ ] `node apps/api/scripts/reconcile-wallet.mjs` → exit 0, "OK — N wallets verified"
- [ ] The affected user's journey retried in the app: order state, wallet balance, ledger row visible
- [ ] `/ready` → `db:true` and `schema.latest` equals the newest repo migration
- [ ] No duplicate ledger rows for the original transaction (idempotency held)
- [ ] Incident written up with the transaction refs (never credentials)

## Rollback

Financial writes made in Step 3/4 are compensations, not edits: to undo one, apply the inverse
compensation — the same way, with a reason. Restore-from-backup (Step 5) is the only true rollback
and must be rehearsed per disaster-recovery.md before use. Irreparable drift that the team decides
to live with gets a **`SECURITY_WAIVERS.md`-style accepted-risk row** (reason, compensating
control, expiry) — money behaviour is never silently declared fine.

## Owner

Finance operations (withdrawal decisions: `finance:withdrawals`) + engineering for schema/restore
paths. Currently a single maintainer holds both — record the dual role in the incident timeline so
the lack of separation of duties is visible, not implied.

## Evidence record

| Date | Payment/Withdrawal ref | Symptom | Root cause | Recovery path used | reconcile exit | Owner |
|---|---|---|---|---|---|---|
| | | | | | | |
