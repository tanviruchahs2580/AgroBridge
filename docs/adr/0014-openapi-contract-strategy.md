# ADR-0014: API contract strategy — hand-maintained reference + executable shape gate now, OpenAPI 3.1 deferred

> **SUPERSEDED (2026-10-21)** by [ADR-0019](0019-contract-strategy-and-generated-inventories.md), which re-decided this topic with the generated inventories as the contract of record. Kept for the decision trail. (Both were briefly numbered 0014 — the collision is why the 2026-10-21 wave moved to 0017-0021.)

- **Status:** accepted (2026-10-19) — revisit at the trigger points below
- **Deciders:** engineering (platform phase will re-decide)
- **Related:** ADR-0007 (schema state in the release contract), ADR-0009 (client-generated idempotency keys), `docs/api.md`, `contracts/api-response-shapes.json`

## Context

The API has three in-repo consumers (the web app, the Capacitor APK and the e2e
suites) and no external integrators. The audit asked for an explicit contract
strategy: an OpenAPI document is the industry default, but a document that is
generated from code can only exist if the code carries generation metadata, and
a document that is hand-written is a second source of truth that drifts.

Today the contract is enforced by three artefacts that already exist and already
fail CI on drift:

1. **`docs/api.md`** — the hand-maintained human reference. Every v1 router
   mounted in `apps/api/src/app.ts` must appear in it; `tests/docs-route-parity.test.ts`
   parses the mount registrations and fails when a route family is added without
   a doc entry (and the reverse is reviewed when a section is removed).
2. **`contracts/api-response-shapes.json`** — a committed record of the key
   structure of every response the web app consumes. `tests/response-contract.test.ts`
   regenerates the shapes from live requests and fails on any diff, so a rename
   or removal of a field cannot ship silently.
3. **`apps/web/src/lib/api-types.ts`** — the client's type mirror, updated in the
   same commit as the fixture, which is what makes the drift-fix a *decision*
   (read the diff → update fixture → update types → update the consuming
   feature) rather than a reflex.

## Decision

**Keep the three-part gate as THE contract for now; do not hand-write or
generate an OpenAPI document yet. Any breaking change fails the contract test,
and that failure is the breaking-change gate.**

- Additive changes are allowed without touching the fixture: new optional
  response fields, new optional request headers/fields, new endpoints. They
  still require a `docs/api.md` update when they add a route family.
- Breaking changes (renamed/removed keys, changed types, changed semantics of
  an existing field) must ship in ONE commit: fixture, web types and consumer
  updated together. The contract test diff is the review artefact.
- The fixture deliberately records key *structure*, not values, nullability or
  field order; and only endpoints the web consumes. Those are known blind
  spots, accepted because no other consumer exists — they are exactly what a
  generated spec would have to solve.

### Worked example of the additive policy

The `Idempotency-Key` header on `POST /orders/checkout` and
`POST /payments/intent` (this remediation wave) is the policy in action: the
header is optional, existing clients that never send it observe byte-identical
responses, and a keyed replay returns the ORIGINAL order/payment with 200 in
the already-recorded envelope shape. `contracts/api-response-shapes.json` and
`apps/web/src/lib/api-types.ts` therefore needed no change — while a change
that added a required field to those envelopes would have failed
`response-contract.test.ts` and forced the one-commit decision above.

## Deferred: generated OpenAPI 3.1 document

Deferred to the platform phase, with these concrete trigger conditions (any one
fires the re-decision):

- a consumer outside this repository (partner, enterprise, or a second
  front-end team) is agreed, or
- SDK / client code generation is requested by a consumer, or
- the API is offered to external developers (public API docs), or
- a machine-readable spec is required by tooling (gateway, mock server, DAST)
  that the three-part gate cannot satisfy.

The trigger work is expected to be generation from the existing zod schemas
(one source of truth; no route decorators), reviewed like any other release
gate: CI regenerates and fails when the committed document is stale. Choosing
a generator before a real consumer exists would add a fourth artefact to keep
in sync with nobody reading it.

Rejected alternatives:

- **Hand-written OpenAPI file now** — a second source of truth that the current
  tests do not check against; drift would be invisible until an integrator hits it.
- **Framework-level spec generation (tsoa-style)** — requires restructuring
  every route; not justified while the client set is in-repo.
- **No contract gate at all** — already disproven by history: the order-history
  screen read `item.product.name` while the API sent `nameSnapshot`; the
  fixture exists because TypeScript cannot see across the wire.

## Consequences

- The breaking-change gate is executable and already in CI today; every release
  is checked against the committed shapes.
- No new dependency and no document to synchronise during the pilot.
- External-consumer readiness is a known, time-boxed gap: when a trigger fires,
  the generation pass starts from zod schemas rather than from a stale document.
