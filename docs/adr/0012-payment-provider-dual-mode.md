# ADR-0012: Payment provider abstraction and the sandbox/live boundary

Status: Accepted · Date: 2026-10-21 · Deciders: engineering; owner sign-off for live credentials

## Context

Bangladesh PSPs (SSLCommerz, bKash, Nagad) have integration timelines that would
block the product launch if payment were a hard dependency. The same flow must
work in development (no credentials), in a pilot (sandbox), and in production
(live gateway) without code changes — and the differences between "simulated
money" and "gateway money" must NEVER be invisible to the caller.

## Decision

1. All payment side effects go through a `PaymentProvider` interface
   (`apps/api/src/providers/payment/`) with two implementations: `sandbox` and
   `sslcommerz`. Selected via `PAYMENT_PROVIDER`; no other component may branch
   on the provider.
2. Every payment response carries the effective `providerMode`. Sandbox
   operations are labelled in Bangla AND English in the response — a buyer must
   always be able to see that no real money moved.
3. **Fail-closed on money**: a production deployment without a configured live
   gateway refuses to create payable intents (no simulate-and-succeed), guarded
   by `payments-integrity` tests. Flipping to "simulated payments allowed in
   production" needs the explicit `ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION=1` plus
   an audit note — an owner-gated action by design.
4. Webhook/intent flows are idempotent on `clientRequestId` / claim-once
   semantics (ADR-0014); amount is always server-derived from the purpose row.

## Consequences

- Launching without a PSP contract is possible (memberships, COD orders, wallet),
  with clearly-labelled simulated payment paths for pilots only.
- Adding a new PSP = adding one adapter + tests, no route changes.
- The audit's `payments-integrity`/`payments-webhook-amount` suites enforce the
  boundary; the live credential itself remains owner-bound (`launch-checklist`).
