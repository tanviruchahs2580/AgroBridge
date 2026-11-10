# Business rules

Rules the code enforces, each with its source location and the test that pins it. Where a rule is
visible in code but has no test, that is stated explicitly ("documented from code; no test"). Where
the schema declares a state that no code path writes, that is stated too. Paths are relative to the
repository root; money is integer paisa unless noted.

## 1. Marketplace pricing

| # | Rule | Source | Test |
|---|---|---|---|
| BR-1 | Delivery fee is BDT 50 (`5_000` paisa), and it is 0 when the subtotal is at least BDT 5,000 (`500_000` paisa) | `orderTotals` in `apps/api/src/shared/utils/money.ts`, called by the `POST /orders/checkout` handler in `apps/api/src/modules/marketplace/routes.ts` | `apps/api/tests/journey-marketplace.test.ts` (the full-checkout test asserts the fee), and the delivery-fee rule is named in `docs/testing.md` suite 5 |
| BR-2 | Membership discount is `round(subtotalPaisa × discountPct / 100)` and is applied before the delivery fee | `orderTotals` in `apps/api/src/shared/utils/money.ts` (applied by the `POST /orders/checkout` handler) | `apps/api/tests/journey-marketplace.test.ts` (silver-member checkout) |
| BR-3 | `totalPaisa = subtotalPaisa − discountPaisa + deliveryFeePaisa`; line items snapshot name, SKU and unit price at checkout | `orderTotals` in `apps/api/src/shared/utils/money.ts`; line-item snapshots in the `POST /orders/checkout` handler (`apps/api/src/modules/marketplace/routes.ts`) | `apps/api/tests/journey-marketplace.test.ts` |
| BR-4 | Catalog listing is paginated (`pageSize` 1–50, default 12) and only shows active products; cart add refuses `qty` above current stock but does not reserve it | `GET /products` list query and `POST /cart/items` in `apps/api/src/modules/marketplace/routes.ts` | `apps/api/tests/journey-marketplace.test.ts` (pagination and over-stock cases) |

## 2. Membership tiers

The enforced discount engine is `TIER_DISCOUNT_PCT` in `apps/api/src/shared/utils/money.ts`:
BRONZE 0%, SILVER 3%, GOLD 5%. The `MembershipPlan` table is the configurable source of plan
prices/durations/benefits; the percentage that checkout applies comes from this map.

| # | Rule | Source | Test |
|---|---|---|---|
| BR-5 | Discount by tier: BRONZE 0, SILVER 3, GOLD 5; an unknown tier gets 0 | `tierDiscountPct` / `TIER_DISCOUNT_PCT` in `apps/api/src/shared/utils/money.ts` | `apps/api/tests/unit-core.test.ts` (membership-discount block) |
| BR-6 | An expired membership degrades to BRONZE (0%) without mutating the stored profile; renewal refreshes the row | `apps/api/src/modules/membership/service.ts` (`getActiveMembership`) | `apps/api/tests/unit-core.test.ts` covers the map; expiry degradation has no dedicated test |
| BR-7 | Buying a plan extends from the current expiry when still active, otherwise from now; duration is the plan's `durationDays` or 365 days when unknown | membership-activation branch of the payment-confirmation handler (`apps/api/src/modules/payments/routes.ts`, the `durationDays` read) | `apps/api/tests/journey-services-procurement.test.ts` covers sandbox activation for bookings; extension arithmetic has no dedicated test |
| BR-8 | Membership purchases are non-refundable while the membership is active | `POST /payments/:id/refund` (`apps/api/src/modules/payments/routes.ts`) | `apps/api/tests/payments-integrity.test.ts` (membership-refund case) |

## 3. Order state machine

Schema comment declares `PENDING|CONFIRMED|PAID|SHIPPED|DELIVERED|CANCELLED`
(`apps/api/prisma/schema.prisma`, the `Order.status` comment); `paymentStatus` is `UNPAID|PAID|REFUNDED` (same model) — note `REFUNDED` is also written to
`Order.status` by the refund path, which the status comment does not list.

| From | Trigger | To | Source |
|---|---|---|---|
| — | Checkout creates the order directly | `CONFIRMED` (payment `UNPAID`) | `POST /orders/checkout` (`apps/api/src/modules/marketplace/routes.ts`) |
| `PENDING`/`CONFIRMED` | Payment success side effect sets `PAID` + `paymentStatus PAID` | `PAID` | `claimAndApplyPayment` (`apps/api/src/modules/payments/routes.ts`) |
| `CONFIRMED` + `UNPAID` | Owner cancels | `CANCELLED` (stock restocked once) | `POST /orders/:id/cancel` (`apps/api/src/modules/marketplace/routes.ts`) |
| `PAID` | Platform refund | `REFUNDED` + `paymentStatus REFUNDED` | `POST /payments/:id/refund` (`apps/api/src/modules/payments/routes.ts`) |

Rules:

| # | Rule | Source | Test |
|---|---|---|---|
| BR-9 | Cancel is claim-atomic on `status = CONFIRMED AND paymentStatus = UNPAID`; a second cancel or a cancel racing a payment updates 0 rows and restocks nothing | `POST /orders/:id/cancel` — claim-atomic conditional update (`apps/api/src/modules/marketplace/routes.ts`) | `apps/api/tests/order-cancel-restock.test.ts` |
| BR-10 | Only finished orders can be deleted; `PENDING`, `CONFIRMED`, `SHIPPED` must be cancelled first. Sandbox payment rows go with the order; real-gateway payment rows are kept | `DELETE /orders/:id` (`apps/api/src/modules/marketplace/routes.ts`) | `apps/api/tests/journey-marketplace.test.ts` (order-deletion cases) |
| BR-11 | `SHIPPED` and `DELIVERED` exist in the schema but **no code path writes them** (fleet/delivery transitions are not implemented) | grep across `apps/api/src` finds only the delete guard's read of `SHIPPED` (in `apps/api/src/modules/marketplace/routes.ts`); no writer exists | Documented from code; no test (nothing to test) |
| BR-12 | Checkout without a `clientRequestId` is protected by the cart-as-token claim: a parallel or sequential retry on an emptied cart is refused, never a second order | the cart-as-token claim in `POST /orders/checkout` (`apps/api/src/modules/marketplace/routes.ts`) | `apps/api/tests/checkout-idempotency.test.ts` |
| BR-13 | Checkout with a `clientRequestId` is idempotent: one key = one order for its lifetime, including when re-used later with a different cart | `findOrderByClientKey` + the replay paths in `POST /orders/checkout` (`apps/api/src/modules/marketplace/routes.ts`) | `apps/api/tests/checkout-idempotency-key.test.ts` |

## 4. Stock decrement semantics

| # | Rule | Source | Test |
|---|---|---|---|
| BR-14 | Stock is decremented at checkout with a conditional update (`stockQty >= qty AND isActive`), inside the same transaction as order creation; a failed condition aborts the whole order | the conditional stock decrement (`stockQty: { gte: item.qty }, isActive: true`) in `POST /orders/checkout` (`apps/api/src/modules/marketplace/routes.ts`) | `apps/api/tests/journey-marketplace.test.ts`; parallel oversell prevention pinned by `apps/api/tests/concurrency.test.ts` (PostgreSQL profile) |
| BR-15 | Cart add validates available stock but reserves nothing; the only reservation is the checkout decrement | `POST /cart/items` (`apps/api/src/modules/marketplace/routes.ts`) | `apps/api/tests/journey-marketplace.test.ts` (over-stock case) |
| BR-16 | Cancelling an unpaid order restocks each line exactly once; deleting a finished order does **not** restock (the goods moved) | `POST /orders/:id/cancel` and `DELETE /orders/:id` (`apps/api/src/modules/marketplace/routes.ts`) | `apps/api/tests/order-cancel-restock.test.ts`; delete-without-restock is implied by `apps/api/tests/journey-marketplace.test.ts` (order-deletion cases) |

## 5. Service booking pricing and state machine

| From | Allowed to | Source |
|---|---|---|
| `REQUESTED` | `CANCELLED` | the legal-transition guard in `POST /bookings/:id/status` (`apps/api/src/modules/services/routes.ts`) |
| `ASSIGNED` | `IN_PROGRESS`, `COMPLETED`, `CANCELLED` | same |
| `IN_PROGRESS` | `COMPLETED`, `CANCELLED` | same |
| `COMPLETED` / `CANCELLED` | terminal — any transition is refused | same guard (terminal check) |

| # | Rule | Source | Test |
|---|---|---|---|
| BR-17 | Only `PER_BIGHA` is area-scaled (`basePricePaisa × areaBigha`); every other unit is a flat charge regardless of area | the pricing rule in `POST /bookings` (`isPerBigha`; `apps/api/src/modules/services/routes.ts`) | `apps/api/tests/services-pricing-rating.test.ts` |
| BR-18 | Booking starts `ASSIGNED` when a compatible provider is chosen, otherwise `REQUESTED`; the provider must serve that service and be active | `POST /bookings` (provider compatibility + initial status; `apps/api/src/modules/services/routes.ts`) | `apps/api/tests/journey-services-procurement.test.ts` |
| BR-19 | Only the assigned provider (or an admin) may progress a booking; cancelling an `IN_PROGRESS` booking is restricted to provider/admin | `POST /bookings/:id/status` scoping (`bookings:manage:any` vs `:own`; `apps/api/src/modules/services/routes.ts`) | `apps/api/tests/booking-and-procurement-scope.test.ts`; `apps/api/tests/journey-services-procurement.test.ts` |
| BR-20 | Scheduled time must be in the future (60 s clock skew allowed) | the future-scheduling check in `POST /bookings` (`apps/api/src/modules/services/routes.ts`) | `apps/api/tests/journey-services-procurement.test.ts` (past-scheduling case) |
| BR-21 | A booking can be rated once, and only when `COMPLETED`; the provider aggregate moves exactly once | `POST /bookings/:id/rating` (`apps/api/src/modules/services/routes.ts`) | `apps/api/tests/services-pricing-rating.test.ts` (double-rating case) |

## 6. Procurement purchase-order state machine

Transitions are a table in code (`transitions` in `apps/api/src/modules/procurement/routes.ts`):

| Action | From | To |
|---|---|---|
| `QC_PASS` | `SUBMITTED` | `QC` |
| `ISSUE_PO` | `QC` | `PURCHASE_ORDER` |
| `COLLECT` | `PURCHASE_ORDER` | `COLLECTED` |
| `REJECT` | `SUBMITTED`, `QC`, `PURCHASE_ORDER` | `REJECTED` |
| payout (`POST /payments/payouts`) | `COLLECTED` | `PAID` |

| # | Rule | Source | Test |
|---|---|---|---|
| BR-22 | Transitions are claim-atomic; two reviewers racing leave exactly one winner | the claim-atomic `updateMany` in the `transitions` block (`apps/api/src/modules/procurement/routes.ts`) | `apps/api/tests/booking-and-procurement-scope.test.ts` |
| BR-23 | Reviewers and payers are region-scoped: a territory manager may only act on offers whose owner is in their region | `GET /procurement` region predicate and `assertMayActOnProcurementOffer` (`apps/api/src/modules/procurement/routes.ts`); `actorRegionLimit` in `apps/api/src/lib/territory.ts` | `apps/api/tests/booking-and-procurement-scope.test.ts`; `apps/api/tests/territory-unassigned.test.ts` |
| BR-23a | **The unassigned case:** a territory manager whose `region` is empty is currently *unrestricted* — the queue returns every region's offers (each row carrying the farmer's name and phone) and the mutation guards let it act on any of them. That is a configuration omission an operator can create in one PATCH, and it contradicts how BR-23 reads. The behaviour is deliberate in `lib/territory.ts` (it fails open) but is not an owner-approved policy: it is logged as `territory.unassigned`, pinned by `apps/api/tests/territory-unassigned.test.ts`, and awaiting a decision as ODL-007. Operators should assign a region with every territory role. | `isTerritoryScopedRole` / `actorRegionLimit` in `apps/api/src/lib/territory.ts` | `apps/api/tests/territory-unassigned.test.ts` |
| BR-24 | Payout requires `status = COLLECTED` and `netPayablePaisa > 0`; it credits the wallet via `WALLET_CREDIT` plus a ledger row, atomically | `POST /payments/payouts` (`apps/api/src/modules/payments/routes.ts`) | `apps/api/tests/journey-services-procurement.test.ts` (full-pipeline case); `apps/api/tests/concurrency.test.ts` (concurrent-payout case) |
| BR-25 | In production, a payout to an unverified phone is refused | the `!po.user.phoneVerified && isProd` guard in `POST /payments/payouts` (`apps/api/src/modules/payments/routes.ts`) | No dedicated test (production-gated path; the OTP flow itself is covered by `apps/api/tests/auth-session-integrity.test.ts`) |

## 7. Procurement QC price formula

`calcProcurement` (`apps/api/src/shared/utils/money.ts`):

1. Grade multipliers (`GRADE_MULTIPLIER`): A = 1.0, B = 0.92, C = 0.8; an unknown grade throws.
2. `grossPaisa = round(quantityKg × basePricePerKgPaisa × gradeMultiplier)`.
3. `extraMoisture = max(0, moisturePct − 14)`.
4. `deductionsPaisa = round(grossPaisa × extraMoisture × 0.005)` — i.e. 0.5% of the gross per
   percentage point above 14%.
5. `netPayablePaisa = grossPaisa − deductionsPaisa`.

| # | Rule | Source | Test |
|---|---|---|---|
| BR-26 | The five steps above, including the unknown-grade rejection | `calcProcurement` in `apps/api/src/shared/utils/money.ts` | `apps/api/tests/unit-core.test.ts` (procurement-price cases) |
| BR-27 | The offer records the computed values and the pipeline applies them end to end (offer → payout uses `netPayablePaisa`) | `apps/api/src/modules/procurement/routes.ts` (create/detail); `POST /payments/payouts` reads `netPayablePaisa` (`apps/api/src/modules/payments/routes.ts`) | `apps/api/tests/journey-services-procurement.test.ts` (full-pipeline case) |

## 8. Wallet withdrawal holds

| # | Rule | Source | Test |
|---|---|---|---|
| BR-28 | Minimum withdrawal is BDT 100 (`10_000` paisa); channel is `BKASH` (default), `NAGAD` or `BANK`; the destination is stored masked | `withdrawalSchema` / `MIN_WITHDRAWAL_PAISA` and `POST /wallet/withdrawals` (`apps/api/src/modules/payments/routes.ts`) | `apps/api/tests/wallet-withdrawals.test.ts` |
| BR-29 | A request holds the amount: `heldPaisa` is incremented under the wallet row lock and availability is `balancePaisa − heldPaisa`; a request above availability is refused | the hold inside the withdrawal transaction (`heldPaisa` incremented under the wallet row lock; `apps/api/src/modules/payments/routes.ts`) | `apps/api/tests/wallet-withdrawals.test.ts`; race coverage `apps/api/tests/withdrawal-race.test.ts` |
| BR-30 | Approval debits the wallet exactly once and releases the hold; rejection releases the hold without debiting; double-approve is refused | the withdrawal-decision route in `apps/api/src/modules/admin/routes.ts` (`POST /admin/withdrawals/:id/decision`; hold release + debit) | `apps/api/tests/wallet-withdrawals.test.ts`; `apps/api/tests/withdrawal-race.test.ts` |
| BR-31 | In production, withdrawal requires a verified phone | the `phoneVerified` guard in `POST /wallet/withdrawals` (`apps/api/src/modules/payments/routes.ts`) | No dedicated test (production-gated); the OTP flow is covered by `apps/api/tests/auth-session-integrity.test.ts` |
| BR-32 | Wallet month boundaries use Asia/Dhaka calendar months (no DST since 2009), computed as 18:00Z on the last UTC day of the previous month | `dhakaMonthStart` (`apps/api/src/shared/utils/dhakaMonth.ts`, used by the wallet summary in `apps/api/src/modules/payments/routes.ts`) | `apps/api/tests/timezone-boundaries.test.ts` |

## 9. Refunds

| # | Rule | Source | Test |
|---|---|---|---|
| BR-33 | Refunds are platform-initiated, require the `payments:refund` permission, and only `ORDER` payments are refundable in v1 | `POST /payments/:id/refund` (`payments:refund` gate; `apps/api/src/modules/payments/routes.ts`) | `apps/api/tests/payments-integrity.test.ts` |
| BR-34 | With a live gateway the refund must already have been issued in the gateway dashboard and the operator supplies `gatewayRef`; without it the request is refused | the `liveGateway && !gatewayRef` guard in `POST /payments/:id/refund` (`apps/api/src/modules/payments/routes.ts`) | `apps/api/tests/payments-refund-provider-mode.test.ts` (provider-mode cases) |
| BR-35 | Refund transitions `SUCCEEDED → REFUNDED` atomically, writes a compensating `DEBIT` ledger row, and may make the wallet balance negative — a documented ops behaviour | the `SUCCEEDED → REFUNDED` claim + compensating `DEBIT` in `POST /payments/:id/refund` (`apps/api/src/modules/payments/routes.ts`) | `apps/api/tests/payments-integrity.test.ts` (refund-ledger case) |
| BR-36 | A payment can be claimed once: `PENDING → SUCCEEDED` is the single gate shared by sandbox confirm, webhook and status reconciliation | `claimAndApplyPayment` (`apps/api/src/modules/payments/routes.ts`) | `apps/api/tests/payment-confirm-webhook-race.test.ts`; `apps/api/tests/payments-integrity.test.ts` (single-claim cases) |

## Rules that are documented from code with no test

- BR-6 membership expiry degradation (unit test covers the tier map, not the expiry path).
- BR-7 membership extension arithmetic (sandbox activation is tested, not the base-date choice).
- BR-11 `SHIPPED`/`DELIVERED` are unreachable states.
- BR-16 delete-without-restock is asserted indirectly (the delete test does not check stock rows).
- BR-25 and BR-31 production-only guards (phone verification) are not exercised by a test.
