# ADR-0022 — List responses are capped slices with X-Total-Count, and the ok/fail envelope is the contract

- Status: accepted
- Date: 2026-11-13
- Deciders: engineering (recorded during the 2026-11-10 full audit remediation; conventions were already in force, this ADR names them)

## Context

The 2026-11-10 audit (findings F-04, F-06, F-39) surfaced that AgroBridge's list-endpoint conventions
existed as scattered per-route comments and test names, but nowhere as a recorded decision. Three
questions kept re-appearing during review because nothing anchored them:

1. **Why does `GET /admin/withdrawals` return at most 100 rows while the UI shows a total?**
   The pattern (in force since the money-path work): the response **body is a capped slice**,
   bounded by a per-route `take` (100 for the finance queue, 50 for the wallet ledger), and the
   **true selected count travels in the `X-Total-Count` response header** — CORS-exposed in
   `app.ts` (`exposedHeaders: ["X-Request-Id", "traceparent", "X-Total-Count"]`) so the web client
   can read it. `MyOrders` renders "showing N of M" from it. A caller that wants more pages
   filters or paginates; it never receives an unbounded dump.
2. **Why do nested includes carry `take` caps?**
   `FARM_LIST_CAPS` (`farms/routes.ts`, ARC-15/API-05) and `ORG_LIST_CAPS`
   (`organizations/routes.ts`, F-06) bound one response — a farm's nested plots, an org's nested
   members — never the data itself. `_count` travels alongside so truncation is visible, not
   silent (`_count.plots`, `_count.members`).
3. **Why does every response share one envelope?**
   `ok(res, data)` / `fail(res, status, code, …)` in `middleware/context.ts` write
   `{ ok: true, data, requestId }` / `{ ok: false, error: { code, message, details, reference }, requestId }`.
   The web client's `lib/api.ts` is built entirely on this shape (`ApiError` with `status`/`code`/
   `details`/`reference`). There is no second response shape and none is planned.

The same audit deferred two related platform decisions, recorded here so they stop being
re-litigated: **Express 4 → 5** and **OpenTelemetry instrumentation**.

## Decision

1. **Capped slice + X-Total-Count is the list contract.** Any new list endpoint returns a body
   bounded by an explicit constant (per-route or a named `*_CAPS` object, values pinned by test —
   `farms-list-caps.test.ts`, `org-list-caps.test.ts`, `money-list-total-count.test.ts`) and sets
   `X-Total-Count` to the filtered total. `_count` accompanies any truncated nested include.
2. **The ok/fail envelope is the only response shape.** New routes use `ok()`/`fail()`; a route
   returning raw JSON or a different wrapper is a contract defect, not a style choice.
3. **List queries go through `validate({ query })` with explicit Zod schemas.** Hand-rolled
   `Number(req.query.x)` parsing is how AUD-116 happened. Where a documented behaviour clamps
   rather than rejects (AUD-116 on `/admin/audit-logs`), the clamp lives inside the schema —
   `validate()` is the mechanism, not a licence to change pinned behaviour.
4. **Express stays on 4.x.** Express 5's path-to-regexp changes would touch every route
   registration for no capability this product needs; the stabilisation window
   (`CONTRIBUTING.md`) forbids churn without owner sign-off. Re-raise if a 5-only feature
   (promise-error forwarding is the usual candidate) becomes load-bearing.
5. **OpenTelemetry stays deferred.** Structured logging with stable fields (§12 of the root
   `AGENTS.md`) is the current telemetry contract; `X-Request-Id` correlation is in place. OTel
   arrives as an owner decision with a sink that exists, not as an unexported dependency.

## Consequences

- Reviewers can reject an unbounded `findMany` on sight — the caps and the header are named policy.
- The web client reads totals from `X-Total-Count`, so paginating UIs need no second count request.
- Express 5 migration and OTel adoption are explicit owner decisions, not drift.
- The audit-log filters (`entityType`/`actorId`/`action`) are backed by existing schema indexes;
  new list filters must land with their index in the same change.
