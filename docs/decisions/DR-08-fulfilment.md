# DR-08 — Order management (fulfilment) scope

Status: **open decision (owner)** · Phase A memo — no code until approved · Recorded: 2026-11-23 (WP-20)

## The gap

Order statuses are documented as `PENDING → CONFIRMED → PAID → SHIPPED → DELIVERED / CANCELLED`,
plus `REFUNDED` (PR #108). No route moves an order to `SHIPPED` or `DELIVERED`: after payment the
buyer's order is frozen at `PAID` forever — the account-deletion guard blocks on it (DR-03's
"terminal orders never block" has no terminal state to reach), and the roles the schema declares
(`WAREHOUSE_MANAGER`, `DEALER`) have surfaces waiting for it (ARC-06).

## Proposed minimal state machine (Phase A)

- Transitions: `PAID → PACKED → SHIPPED → DELIVERED`; `PACKED/SHIPPED → CANCELLED` only with a
  refund path; `DELIVERED` and `REFUNDED` are terminal.
- Illegal transitions rejected by a transition table in code, not by `if` chains.
- Who may transition: `orders:manage` (ADMIN) plus scoped roles — `WAREHOUSE_MANAGER` for
  PACKED/SHIPPED within territory (`lib/territory.ts`), `DEALER` for their own catalog's orders;
  every transition audited and buyer-notified (via the outbox once DR-07 lands, inline until then).
- Delivery confirmation: an OTP to the buyer (the STEP_UP challenge purpose already exists)
  marks `DELIVERED` — prevents a driver marking their own delivery.
- Stock: PACKED reserves, CANCELLED releases; the inventory ledger belongs to the WP-17 ledger
  design, not to ad-hoc updates.
- Endpoints + the buyer-visible status field travel with the route-role matrix, the response-shape
  fixture and `api-types.ts` in the same PR (api-contract-change discipline).

## Resolves

PAY-05 (no fulfilment workflow), the permanent `PAID/SHIPPED` account-deletion blocker (DR-03's
support path becomes real: wait for delivery → terminal → deletable), ARC-06's declared-without-
routes roles.

## Decision requested

Approve the state machine and the role scoping (or amend); Phase B is one schema-plus-routes PR
per the contract discipline.
