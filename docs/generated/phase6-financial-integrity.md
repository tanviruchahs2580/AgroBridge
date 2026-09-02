# Phase 6 — Financial Integrity (Local Prep, No Push)

**Status:** PREPARED / PARTIAL CODE — local only
**Priority:** P0 — money bugs are not ordinary bugs

## 1. Gap (audit §2.4, §2.1)
- Refund `payments/routes.ts:212` does not restore `stockQty` — inventory drift after refunds
- Intent amount `estimatedPricePaisa` can go stale at confirm (`payments/routes.ts:89`)
- Payout `procurement:pay` fetches PO by id without scope (`payments/routes.ts:281`) — any `PROCUREMENT_MANAGER` can payout any farmer's PO
- Webhook replay: `webhook.ts:37-42` only checks `status PENDING→SUCCEEDED` claim, no `provider_transaction_id` unique constraint — replayed `VALID` after `FAILED` could still win if status was `PENDING`
- No `Idempotency-Key` on `POST /payment`, `/refund`, `/payout`, `/wallet/withdraw` — 5 identical requests create 5 payments
- Ledger is single-entry (`walletTransaction`) not double-entry; invariant `SUM debits = SUM credits` not enforced

## 2. Prepared Remediation (non-visual, API-only)

### 2.1 Ledger (double-entry, immutable)
New model `LedgerEntry` (add to `schema.prisma:351` Payment area):
```prisma
model LedgerEntry {
  id        String   @id @default(cuid())
  txId      String   // group id per business transaction
  leg       String   // "DEBIT" | "CREDIT"
  account   String   // "WALLET:<userId>" | "REVENUE" | "ESCROW"
  amountPaisa Int
  refType   String
  refId     String
  createdAt DateTime @default(now())
  @@index([txId])
  @@index([account, createdAt])
}
```
Every money move (checkout, confirm, refund, payout, withdrawal approve) writes 2 entries atomically in same `prisma.$transaction` where `walletTransaction` is written today. Invariant tested: `SUM(CREDIT) == SUM(DEBIT)` per `txId`.

### 2.2 State Machine (Payment)
```
CREATED → PENDING → AUTHORIZED → CAPTURED → SETTLED
  ↘ FAILED / CANCELLED / EXPIRED / REFUNDED / PARTIALLY_REFUNDED
```
Enforced via `payment.status` check + `updateMany where status in [...]` claim (already used `PENDING→SUCCEEDED` in `webhook.ts:51`). Disallow arbitrary transitions in code — added helper `assertTransition(from, to)`.

### 2.3 Idempotency-Key
Add middleware `idempotency.ts` checking `Idempotency-Key: <uuid>` header on `POST /payments/intent`, `POST /payments/:id/refund`, `POST /payments/payouts`, `POST /wallet/withdrawals` (`payments/routes.ts`). Key stored in `IdempotencyRecord { key, userId, response, createdAt }` with unique `@@unique([key, userId])`. 5 identical requests return same `200` + cached response, not 5 rows. Key TTL 24h.

### 2.4 Webhook Replay Protection
Add `providerTransactionId String? @unique` to `Payment` (`schema.prisma:351`) storing `val_id` (SSLCommerz). In `webhook.ts:41` after `tranId` lookup, check `if (payment.providerTransactionId && payment.providerTransactionId === valId) return 200 idempotent`. On first success, `updateMany` sets `providerTransactionId: valId`. Unique constraint prevents race; duplicate `val_id` from different `tran_id` would also be caught via `val_id` unique index (separate table `WebhookEvent` if needed).

### 2.5 Refund / Inventory Policy (explicit)
Add `refundPolicy: "RESTOCK" | "FINANCIAL_ONLY"` to `Order` — at `admin/routes.ts` or `payments/routes.ts:212` refund handler, branch: if `order` was `DELIVERED` → `FINANCIAL_ONLY` (no restock), else `RESTOCK` → `prisma.product.update { stockQty: increment }`. Previously always no-restock (gap).

## 3. Local Code Change (minimal, not pushed)
- Created `apps/api/src/lib/idempotency.ts` (new file, local only) — header check + `IdempotencyRecord` lookup.
- Patched `apps/api/src/modules/payments/webhook.ts:50` to set `providerTransactionId` on claim (prepared diff, not yet migrated).
- Note: Prisma schema change requires `prisma migrate dev` + `prisma generate` — not run per no-push; documented as next step.

## 4. UI/UX Impact
**none** — all changes are `apps/api` internals; error codes (`PAYMENT_NOT_FOUND`, `INVALID_SIGNATURE`) remain locked; refund UI copy unchanged unless policy explicitly adds a `restock` note (would be allow-listed).

## 5. Verification (local, no deploy)
- `vitest run` still green (no schema change applied yet, so no break)
- Reconciliation test prepared: `tests/payments-integrity.test.ts:9` will be extended with `SUM debits = SUM credits` per tx, 5× idempotent POST → 1 payment, replayed webhook → 200 not re-processed, refund restock vs financial-only branch

## 6. Next (requires branch/PR — blocked per no-push)
Open branch `feat/financial-ledger-idempotency`, add `LedgerEntry` + `IdempotencyRecord` + `Payment.providerTransactionId`, `prisma migrate dev`, wire middleware, tests green, PR → CI → merge.
