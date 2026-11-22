# ADR-0023 — The SSLCommerz IPN signature is the documented `verify_key` algorithm, and settlement is validator-authoritative

- Status: accepted
- Date: 2026-11-23
- Deciders: engineering (closes audit findings PAY-01, TST-01; the webhook limiter half of PAY-03 landed 2026-11-22 in PR #108)

## Context

The 2026-11-21 audit found the webhook's `verify_sign` check unprovable: the code hashed **every
posted parameter** with a store-password-prefixed MD5 recipe invented in-house, and every test
signed payloads with that same function — so the suite proved self-consistency, never gateway
compatibility. A real SSLCommerz IPN would have failed the check, and conversely nothing bounded
what layout the check would accept.

The official documentation was retrieved and recorded at execution time:

- Source: <https://developer.sslcommerz.com/docs.html> — IPN section ("IPN Verify Sign") and the
  Order Validation API section. Retrieved **2026-11-22**.
- The documented signature algorithm: collect **only** the POST parameters named in `verify_key`
  (comma-separated), add `store_passwd` as the **lowercase MD5 of the store password**, sort the
  keys, join as `key=value` with `&`, and MD5 the string; compare against `verify_sign`. The PHP
  reference (`_ipn_hash_varify`) `ksort`s and returns false when `verify_key` is missing.
- The docs make the **Order Validation API mandatory for every transaction** ("You must be required
  to validate each transaction by Order Validation API"). Endpoint
  `validator/api/validationserverAPI.php` with `val_id`, `store_id`, `store_passwd`; success
  statuses `VALID` (first validation) and `VALIDATED` (same `val_id` validated again);
  `INVALID_TRANSACTION` for a bad `val_id`; the response carries `tran_id`, `amount`, `currency`,
  `risk_level` (0 safe / 1 risky) and `risk_title`.

## Decision

1. **The webhook verifies exactly the documented signature.** `sslcommerzSignature`
   (`modules/payments/routes.ts`) hashes the `verify_key`-named fields plus
   `store_passwd=<md5(store_passwd)>`, key-sorted, `key=value&…`-joined; a missing `verify_key` is
   the documented `false` (the function returns `""`, which can never pass the length-checked
   compare). The comparison stays constant-time. The retired all-parameters recipe is rejected — a
   regression test mints a legacy signature and asserts `401`.
2. **Conformance tests do not sign with the production function.**
   `tests/payments-webhook-signature-conformance.test.ts` signs with a test-local mirror of the
   documented PHP recipe plus one frozen vector computed by hand outside the codebase (2026-11-22),
   so a shared bug cannot hide. Docs-shaped fixtures live in `tests/fixtures/sslcommerz/` with
   provenance headers; the real captured-sandbox-IPN contract test is an explicit `it.todo` until
   OA-01 delivers captures (`docs/runbooks/sslcommerz-sandbox-capture.md`).
3. **Settlement is validator-authoritative.** The webhook settles a payment through an adapter that
   exposes `validateOrder` **only** after a server-to-server Order Validation call agrees: status
   `VALID`/`VALIDATED`, `tran_id` equal to the IPN's, amount equal to the stored
   `Payment.amountPaisa`, currency BDT, and `risk_level` 0. Every other outcome — invalid
   transaction, unreachable gateway, undocumented status, missing `val_id`, risk flag — leaves the
   payment `PENDING`, is audited (`PAYMENT_VALIDATOR_REJECTED`) and metered
   (`paymentIntentsTotal{status="webhook_<reason>"}`), and is answered `processed: false` over HTTP
   200 so the gateway's IPN retry schedule keeps running while reconciliation catches up. The
   sandbox adapter does not expose `validateOrder` and keeps the pre-existing checks as its
   contract.
4. **Existing checks are unchanged and still apply in order:** signature → gateway `status` gate →
   payment lookup → already-final idempotency → IPN amount/currency cross-check → validator gate →
   the PENDING→SUCCEEDED claim (`claimPendingPayment`, which preserves the client idempotency key).
5. **The Validation API is also the primary verification path for the return/status flow**
   (`verifyPayment` consumes `validateOrder`; the Transaction Query API stays the documented
   fallback resolved by `orderNo`). The MD5 usage in `SECURITY_WAIVERS.md` is unchanged in
   substance — MD5 remains the gateway-mandated protocol, now citing the documented algorithm.

## Consequences

- Real IPNs verify for the first time; the circular test suite is replaced by docs-derived vectors.
- A validator outage delays settlement (payments stay `PENDING`) instead of mis-settling: money
  correctness is preferred over latency, and the gateway retries deliver the eventual verdict.
- Risk-flagged transactions land in the reconciliation queue rather than auto-settling — an
  operator reviews them (the alert series `PaymentFailures` and the audit action make the queue
  observable).
- `verify_key` participates in what is hashed, so tests and callers must sign exactly what they
  post; four pre-existing suites had helpers that hashed a different set than they sent, and were
  corrected in the same change.
- Live-gateway go-live (gate G2) still requires the owner's captured sandbox IPNs replayed as
  fixtures (OA-01) and the ৳10 end-to-end run.

## References

- `apps/api/src/providers/payment/sslcommerz.ts` (`validateOrder`, `parseOrderValidation`)
- `apps/api/src/modules/payments/webhook.ts` (`settleOnlyWhenValidatorAgrees`)
- `apps/api/src/modules/payments/routes.ts` (`sslcommerzSignature`)
- `apps/api/tests/payments-webhook-signature-conformance.test.ts`, `apps/api/tests/payments-webhook-validator.test.ts`
- `docs/runbooks/sslcommerz-sandbox-capture.md`
