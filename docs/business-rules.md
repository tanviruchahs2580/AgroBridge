# Business rules

Rules the code enforces, each with its source location and the test that pins it. Where a rule is
visible in code but has no test, that is stated explicitly ("documented from code; no test"). Where
the schema declares a state that no code path writes, that is stated too. Paths are relative to the
repository root; money is integer paisa unless noted.

## 1. Marketplace pricing

| # | Rule | Source | Test |
|---|---|---|---|
| BR-1 | Delivery fee is BDT 50 (`5_000` paisa), and it is 0 when the subtotal is at least BDT 5,000 (`500_000` paisa) | `apps/api/src/modules/marketplace/routes.ts:412` | `apps/api/tests/journey-marketplace.test.ts:32` (full checkout asserts the fee), and the delivery-fee rule is named in `docs/testing.md` suite 5 |
| BR-2 | Membership discount is `round(subtotalPaisa × discountPct / 100)` and is applied before the delivery fee | `apps/api/src/modules/marketplace/routes.ts:411,414` | `apps/api/tests/journey-marketplace.test.ts:91` |
| BR-3 | `totalPaisa = subtotalPaisa − discountPaisa + deliveryFeePaisa`; line items snapshot name, SKU and unit price at checkout | `apps/api/src/modules/marketplace/routes.ts:411-435` | `apps/api/tests/journey-marketplace.test.ts:32` |
| BR-4 | Catalog listing is paginated (`pageSize` 1–50, default 12) and only shows active products; cart add refuses `qty` above current stock but does not reserve it | `apps/api/src/modules/marketplace/routes.ts:48-84,150-160` | `apps/api/tests/journey-marketplace.test.ts:21,80` |

## 2. Membership tiers

The enforced discount engine is `TIER_DISCOUNT_PCT` in `apps/api/src/shared/utils/money.ts:11-16`:
BRONZE 0%, SILVER 3%, GOLD 5%. The `MembershipPlan` table is the configurable source of plan
prices/durations/benefits; the percentage that checkout applies comes from this map.

| # | Rule | Source | Test |
|---|---|---|---|
| BR-5 | Discount by tier: BRONZE 0, SILVER 3, GOLD 5; an unknown tier gets 0 | `apps/api/src/shared/utils/money.ts:11-18` | `apps/api/tests/unit-core.test.ts:33` |
| BR-6 | An expired membership degrades to BRONZE (0%) without mutating the stored profile; renewal refreshes the row | `apps/api/src/modules/membership/service.ts` (`getActiveMembership`) | `apps/api/tests/unit-core.test.ts:33` covers the map; expiry degradation has no dedicated test |
| BR-7 | Buying a plan extends from the current expiry when still active, otherwise from now; duration is the plan's `durationDays` or 365 days when unknown | `apps/api/src/modules/payments/routes.ts:78-95` | `apps/api/tests/journey-services-procurement.test.ts:132` covers sandbox activation for bookings; extension arithmetic has no dedicated test |
| BR-8 | Membership purchases are non-refundable while the membership is active | `apps/api/src/modules/payments/routes.ts:382-384` | `apps/api/tests/payments-integrity.test.ts:275` |

## 3. Order state machine

Schema comment declares `PENDING|CONFIRMED|PAID|SHIPPED|DELIVERED|CANCELLED`
(`apps/api/prisma/schema.prisma:253`); `paymentStatus` is `UNPAID|PAID|REFUNDED` (`:258`).

| From | Trigger | To | Source |
|---|---|---|---|
| — | Checkout creates the order directly | `CONFIRMED` (payment `UNPAID`) | `apps/api/src/modules/marketplace/routes.ts:417-419` |
| `PENDING`/`CONFIRMED` | Payment success side effect sets `PAID` + `paymentStatus PAID` | `PAID` | `apps/api/src/modules/payments/routes.ts:71-76` |
| `CONFIRMED` + `UNPAID` | Owner cancels | `CANCELLED` (stock restocked once) | `apps/api/src/modules/marketplace/routes.ts:282-295` |
| `PAID` | Platform refund | `REFUNDED` + `paymentStatus REFUNDED` | `apps/api/src/modules/payments/routes.ts:397-401` |

Rules:

| # | Rule | Source | Test |
|---|---|---|---|
| BR-9 | Cancel is claim-atomic on `status = CONFIRMED AND paymentStatus = UNPAID`; a second cancel or a cancel racing a payment updates 0 rows and restocks nothing | `apps/api/src/modules/marketplace/routes.ts:282-295` | `apps/api/tests/order-cancel-restock.test.ts:39,58,77` |
| BR-10 | Only finished orders can be deleted; `PENDING`, `CONFIRMED`, `SHIPPED` must be cancelled first. Sandbox payment rows go with the order; real-gateway payment rows are kept | `apps/api/src/modules/marketplace/routes.ts:221-247` | `apps/api/tests/journey-marketplace.test.ts:112` |
| BR-11 | `SHIPPED` and `DELIVERED` exist in the schema but **no code path writes them** (fleet/delivery transitions are not implemented) | grep across `apps/api/src` finds only the delete guard's read of `SHIPPED` (`apps/api/src/modules/marketplace/routes.ts:229`); no writer exists | Documented from code; no test (nothing to test) |
| BR-12 | Checkout without a `clientRequestId` is protected by the cart-as-token claim: a parallel or sequential retry on an emptied cart is refused, never a second order | `apps/api/src/modules/marketplace/routes.ts:390-395` | `apps/api/tests/checkout-idempotency.test.ts:35,62` |
| BR-13 | Checkout with a `clientRequestId` is idempotent: one key = one order for its lifetime, including when re-used later with a different cart | `apps/api/src/modules/marketplace/routes.ts:341-343,356-369,470-478` | `apps/api/tests/checkout-idempotency-key.test.ts:36,62,92,114,128` |

## 4. Stock decrement semantics

| # | Rule | Source | Test |
|---|---|---|---|
| BR-14 | Stock is decremented at checkout with a conditional update (`stockQty >= qty AND isActive`), inside the same transaction as order creation; a failed condition aborts the whole order | `apps/api/src/modules/marketplace/routes.ts:400-408` | `apps/api/tests/journey-marketplace.test.ts:32`; parallel oversell prevention pinned by `apps/api/tests/concurrency.test.ts:19` (PostgreSQL profile) |
| BR-15 | Cart add validates available stock but reserves nothing; the only reservation is the checkout decrement | `apps/api/src/modules/marketplace/routes.ts:150-160` | `apps/api/tests/journey-marketplace.test.ts:80` |
| BR-16 | Cancelling an unpaid order restocks each line exactly once; deleting a finished order does **not** restock (the goods moved) | `apps/api/src/modules/marketplace/routes.ts:296-301,221-247` | `apps/api/tests/order-cancel-restock.test.ts:39`; delete-without-restock is implied by `apps/api/tests/journey-marketplace.test.ts:112` |

## 5. Service booking pricing and state machine

| From | Allowed to | Source |
|---|---|---|
| `REQUESTED` | `CANCELLED` | `apps/api/src/modules/services/routes.ts:242-247` |
| `ASSIGNED` | `IN_PROGRESS`, `COMPLETED`, `CANCELLED` | same |
| `IN_PROGRESS` | `COMPLETED`, `CANCELLED` | same |
| `COMPLETED` / `CANCELLED` | terminal — any transition is refused | `apps/api/src/modules/services/routes.ts:235-238` |

| # | Rule | Source | Test |
|---|---|---|---|
| BR-17 | Only `PER_BIGHA` is area-scaled (`basePricePaisa × areaBigha`); every other unit is a flat charge regardless of area | `apps/api/src/modules/services/routes.ts:117-122` | `apps/api/tests/services-pricing-rating.test.ts:34,60` |
| BR-18 | Booking starts `ASSIGNED` when a compatible provider is chosen, otherwise `REQUESTED`; the provider must serve that service and be active | `apps/api/src/modules/services/routes.ts:105-115,126-135` | `apps/api/tests/journey-services-procurement.test.ts:7,111` |
| BR-19 | Only the assigned provider (or an admin) may progress a booking; cancelling an `IN_PROGRESS` booking is restricted to provider/admin | `apps/api/src/modules/services/routes.ts:249-256` | `apps/api/tests/rbac-fixes.test.ts:7`; `apps/api/tests/journey-services-procurement.test.ts:41` |
| BR-20 | Scheduled time must be in the future (60 s clock skew allowed) | `apps/api/src/modules/services/routes.ts:107` | `apps/api/tests/journey-services-procurement.test.ts:29` |
| BR-21 | A booking can be rated once, and only when `COMPLETED`; the provider aggregate moves exactly once | `apps/api/src/modules/services/routes.ts:290-310` | `apps/api/tests/services-pricing-rating.test.ts:109` |

## 6. Procurement purchase-order state machine

Transitions are a table in code (`apps/api/src/modules/procurement/routes.ts:132-137`):

| Action | From | To |
|---|---|---|
| `QC_PASS` | `SUBMITTED` | `QC` |
| `ISSUE_PO` | `QC` | `PURCHASE_ORDER` |
| `COLLECT` | `PURCHASE_ORDER` | `COLLECTED` |
| `REJECT` | `SUBMITTED`, `QC`, `PURCHASE_ORDER` | `REJECTED` |
| payout (`POST /payments/payouts`) | `COLLECTED` | `PAID` |

| # | Rule | Source | Test |
|---|---|---|---|
| BR-22 | Transitions are claim-atomic; two reviewers racing leave exactly one winner | `apps/api/src/modules/procurement/routes.ts:139-152` | `apps/api/tests/rbac-fixes.test.ts:120` |
| BR-23 | Reviewers and payers are region-scoped: a territory manager may only act on offers whose owner is in their region | `apps/api/src/modules/procurement/routes.ts:88-101`; `apps/api/src/lib/territory.ts` | `apps/api/tests/rbac-fixes.test.ts:147,183`; `apps/api/tests/territory-unassigned.test.ts` |
| BR-23a | **The unassigned case:** a territory manager whose `region` is empty is currently *unrestricted* — the queue returns every region's offers (each row carrying the farmer's name and phone) and the mutation guards let it act on any of them. That is a configuration omission an operator can create in one PATCH, and it contradicts how BR-23 reads. The behaviour is deliberate in `lib/territory.ts` (it fails open) but is not an owner-approved policy: it is logged as `territory.unassigned`, pinned by `apps/api/tests/territory-unassigned.test.ts`, and awaiting a decision as ODL-007. Operators should assign a region with every territory role. | `apps/api/src/lib/territory.ts:19-40` | `apps/api/tests/territory-unassigned.test.ts` |
| BR-24 | Payout requires `status = COLLECTED` and `netPayablePaisa > 0`; it credits the wallet via `WALLET_CREDIT` plus a ledger row, atomically | `apps/api/src/modules/payments/routes.ts:480-519` | `apps/api/tests/journey-services-procurement.test.ts:175`; `apps/api/tests/concurrency.test.ts:53` |
| BR-25 | In production, a payout to an unverified phone is refused | `apps/api/src/modules/payments/routes.ts:479` | No dedicated test (production-gated path; the OTP flow itself is covered by `apps/api/tests/auth-hardening.test.ts:48`) |

## 7. Procurement QC price formula

`calcProcurement` (`apps/api/src/shared/utils/money.ts:32-44`):

1. Grade multipliers: A = 1.0, B = 0.92, C = 0.8; an unknown grade throws (`:22-30,38-39`).
2. `grossPaisa = round(quantityKg × basePricePerKgPaisa × gradeMultiplier)` (`:40`).
3. `extraMoisture = max(0, moisturePct − 14)` (`:41`).
4. `deductionsPaisa = round(grossPaisa × extraMoisture × 0.005)` — i.e. 0.5% of the gross per
   percentage point above 14% (`:42`).
5. `netPayablePaisa = grossPaisa − deductionsPaisa` (`:43`).

| # | Rule | Source | Test |
|---|---|---|---|
| BR-26 | The five steps above, including the unknown-grade rejection | `apps/api/src/shared/utils/money.ts:32-44` | `apps/api/tests/unit-core.test.ts:8,15,20,27` |
| BR-27 | The offer records the computed values and the pipeline applies them end to end (offer → payout uses `netPayablePaisa`) | `apps/api/src/modules/procurement/routes.ts` (create/detail); `apps/api/src/modules/payments/routes.ts:498` | `apps/api/tests/journey-services-procurement.test.ts:175` |

## 8. Wallet withdrawal holds

| # | Rule | Source | Test |
|---|---|---|---|
| BR-28 | Minimum withdrawal is BDT 100 (`10_000` paisa); channel is `BKASH` (default), `NAGAD` or `BANK`; the destination is stored masked | `apps/api/src/modules/payments/routes.ts:46-49,617-621` | `apps/api/tests/wallet-withdrawals.test.ts:28` |
| BR-29 | A request holds the amount: `heldPaisa` is incremented under the wallet row lock and availability is `balancePaisa − heldPaisa`; a request above availability is refused | `apps/api/src/modules/payments/routes.ts:632-662` | `apps/api/tests/wallet-withdrawals.test.ts:28,61`; race coverage `apps/api/tests/withdrawal-race.test.ts:28,50` |
| BR-30 | Approval debits the wallet exactly once and releases the hold; rejection releases the hold without debiting; double-approve is refused | `apps/api/src/modules/admin/routes.ts:221-290` | `apps/api/tests/wallet-withdrawals.test.ts:72,116,134`; `apps/api/tests/withdrawal-race.test.ts:72,99` |
| BR-31 | In production, withdrawal requires a verified phone | `apps/api/src/modules/payments/routes.ts:628` | No dedicated test (production-gated); the OTP flow is covered by `apps/api/tests/auth-hardening.test.ts:48` |
| BR-32 | Wallet month boundaries use Asia/Dhaka calendar months (no DST since 2009), computed as 18:00Z on the last UTC day of the previous month | `apps/api/src/modules/payments/routes.ts:552-581` | `apps/api/tests/timezone-boundaries.test.ts` |

## 9. Refunds

| # | Rule | Source | Test |
|---|---|---|---|
| BR-33 | Refunds are platform-initiated, require the `payments:refund` permission, and only `ORDER` payments are refundable in v1 | `apps/api/src/modules/payments/routes.ts:351-387` | `apps/api/tests/payments-integrity.test.ts:208` |
| BR-34 | With a live gateway the refund must already have been issued in the gateway dashboard and the operator supplies `gatewayRef`; without it the request is refused | `apps/api/src/modules/payments/routes.ts:363-373` | `apps/api/tests/payments-refund-provider-mode.test.ts` (provider-mode cases) |
| BR-35 | Refund transitions `SUCCEEDED → REFUNDED` atomically, writes a compensating `DEBIT` ledger row, and may make the wallet balance negative — a documented ops behaviour | `apps/api/src/modules/payments/routes.ts:388-421` | `apps/api/tests/payments-integrity.test.ts:245` |
| BR-36 | A payment can be claimed once: `PENDING → SUCCEEDED` is the single gate shared by sandbox confirm, webhook and status reconciliation | `apps/api/src/modules/payments/routes.ts:217-251` | `apps/api/tests/payment-confirm-webhook-race.test.ts:45`; `apps/api/tests/payments-integrity.test.ts:122` |

## Rules that are documented from code with no test

- BR-6 membership expiry degradation (unit test covers the tier map, not the expiry path).
- BR-7 membership extension arithmetic (sandbox activation is tested, not the base-date choice).
- BR-11 `SHIPPED`/`DELIVERED` are unreachable states.
- BR-16 delete-without-restock is asserted indirectly (the delete test does not check stock rows).
- BR-25 and BR-31 production-only guards (phone verification) are not exercised by a test.
