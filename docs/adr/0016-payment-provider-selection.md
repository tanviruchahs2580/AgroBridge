# ADR-0016: Payment provider — SSLCommerz for live payments, hosted checkout

- **Status:** accepted (2026-10-19) — the adapter is selected and built; **activation is an owner action** (OD-07 in `docs/STATUS.md`), gated below
- **Deciders:** engineering selects and maintains the adapter; the owner provisions the merchant account and flips the environment
- **Related:** ADR-0005 (provider adapters), `docs/runbooks/secret-rotation.md`, `docs/runbooks/failed-transaction-recovery.md`

## Context

The marketplace collects money for orders, bookings, procurement and membership.
The codebase ships two providers behind one interface:

- `sandbox` — deterministic, simulated; every response is labelled
  `mode: "sandbox"`, and a production deployment refuses to complete a
  simulated payment unless the operator explicitly accepts it via
  `ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION=1` (pilots/demos only).
- `sslcommerz` — the live adapter (`providers/payment/sslcommerz.ts`):
  session creation against the SSLCommerz gateway, hosted checkout via
  `redirectUrl`, verification through the validator API with a transaction-query
  fallback, and the signed IPN webhook below.

Alternative providers were evaluated and rejected:

| Provider | Why not |
|---|---|
| bKash/Nagad direct merchant APIs | Reach one wallet each; two integrations, two reconciliations, both requiring merchant-agreement paperwork the owner has not completed; SSLCommerz already fronts both. |
| Stripe / international PSPs | Not generally available to Bangladesh-registered merchants for local card/wallet settlement; fees and FX add cost for a BDT-only pilot. |
| Manual bank transfer + admin confirmation | Unreconcilable at any volume; every confirmation becomes a human write into the money ledger. |

## Decision

**SSLCommerz is the live payment provider.** It gives Bangladesh-market reach
(bKash, Nagad, Rocket, cards, bank) through one hosted-checkout integration.
Hosted checkout is the decisive property: the buyer enters card/wallet details on
the gateway's page, so cardholder data never touches this API and the product
stays out of PCI-DSS scope. The store-credential + IPN model also matches what
the adapter already implements.

### Adapter contract (all providers)

```ts
interface PaymentProvider {
  readonly name: string;
  readonly mode: "sandbox" | "live";
  createPayment(input: CreatePaymentInput): Promise<PaymentIntent>;   // -> redirectUrl for hosted checkout
  verifyPayment(providerRef: string): Promise<{ status: "SUCCEEDED" | "FAILED" | "PENDING"; amountPaisa?: number }>;
}
```

Business logic never talks to a gateway: `modules/payments/**` depends on the
interface, `getPaymentProvider()` instantiates SSLCommerz only when
`PAYMENT_PROVIDER=sslcommerz` and both credentials are present (otherwise the
sandbox is used), and provider errors surface as typed API errors
(`paymentGatewayUnconfigured`, `paymentGatewayUnavailable`).

### Money-safety invariants (implemented, each pinned by a test)

1. **Webhook authenticity** — `POST /payments/webhook/sslcommerz` is
   unauthenticated by contract; every request must carry a valid `verify_sign`
   checked in constant time against the documented signature algorithm.
   (`tests/payments-webhook-amount.test.ts`, `payments-integrity.test.ts`)
2. **Amount and currency binding** — a valid signature proves the IPN came from
   the gateway, not that it belongs to this charge; the posted amount must equal
   `Payment.amountPaisa` and the currency must be BDT, or the payment stays
   PENDING for reconciliation.
3. **Exactly-once confirmation** — the PENDING→SUCCEEDED claim
   (`updateMany … status: PENDING`) is the idempotency gate; a lost claim is a
   race or a superseded intent, both answered without re-applying side effects.
   (`tests/payment-confirm-webhook-race.test.ts`)
4. **The browser return trusts nothing** — `/payments/gateway/return/:outcome`
   only decides where to redirect; whether money moved is decided by asking the
   provider. `GET /payments/:id/status` reconciles idempotently and only a
   provider `SUCCEEDED` moves a payment forward.
5. **One live intent per user and purpose** — enforced by a partial unique index
   plus the application check, so a double-submit cannot create two payable
   intents. (`tests/checkout-idempotency.test.ts`,
   `checkout-idempotency-key.test.ts`)
6. **Refunds are recorded, not fabricated** — with a live provider the refund is
   issued in the gateway dashboard first and this API records the operator's
   `gatewayRef`; without it the route refuses, so a REFUNDED row can never
   precede real money movement. Sandbox refunds move the simulated ledger only.

   (`tests/payments-refund-provider-mode.test.ts`)

### Activation gates (all green before `PAYMENT_PROVIDER=sslcommerz` in production)

1. **Signature + replay window** — IPN enabled in the merchant dashboard and
   pointed at `/api/v1/payments/webhook/sslcommerz`; signature verification,
   amount/currency checks and the replay-safe claim proven against a gateway
   sandbox IPN (currently covered by unit/integration tests, not yet a live
   sandbox IPN — the one step that needs the owner's merchant account).
2. **Reconciliation** — the PENDING-payment procedure in
   `docs/runbooks/failed-transaction-recovery.md` rehearsed on a sandbox
   transaction: status poll settles it, or the documented manual steps do; the
   `/payments` admin list shows the state.
3. **Refunds** — dashboard-first procedure documented and rehearsed once;
   the operator knows the route requires the gateway reference.
4. **Credentials** — store id/password provisioned and rotatable per
   `docs/runbooks/secret-rotation.md` (the password is part of every signature,
   so rotation invalidates in-flight IPNs and must follow the runbook).
5. **Simulation off** — `ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION` unset, and
   `PAYMENT_PROVIDER`/credentials set in the deployment environment.

**Activation is an owner action**: engineering cannot complete gates 1–3
without the merchant account. Until the owner flips the environment, the
deployment serves simulated payments and says so on every response.

## Consequences

- Hosted checkout keeps PCI scope out of this codebase; the API only ever
  handles amounts, references, and signed status events.
- The adapter interface stays two-method; adding a second gateway later means a
  new file plus a selection branch, not a payments-module refactor.
- Replay protection and reconciliation live in our code, not in the gateway
  contract, so they must keep their tests as the provider integration matures
  (a real sandbox IPN is the remaining evidence gap).
