# ADR-0014: Contract strategy — generated inventories, one response contract, idempotency keys

Status: Accepted (supersedes "OpenAPI first" from the V2 audit assumption) · Date: 2026-10-21

## Context

The API is consumed by a React web app, an Android WebView build, and future
operator tooling. The V2 audit initially assumed an OpenAPI document as the
contract of record; in practice three drift problems kept recurring (docs/api.md
vs routes, route inventory vs reality, response shapes vs the web client).

## Decision

1. **The generated inventories are the contract of record**, each with a
   freshness gate that fails CI on drift:
   - `docs/generated/route-matrix.{json,md}` — every mounted route with its
     authorization chain (`apps/api/scripts/route-matrix.mjs`), guarded by
     `tests/route-matrix.test.ts` (drift + deny-by-default allowlist + money
     surfaces never PUBLIC);
   - generated env/ERD documents guarded the same way (DOC-07).
2. **Response shapes** for web-consumed endpoints stay locked by
   `tests/response-contract.test.ts` against the committed fixture
   (`contracts/api-response-shapes.json`); an accepted shape change regenerates
   the fixture deliberately in the same change-set.
3. **Idempotency**: money-mutating routes accept an `Idempotency-Key` header
   mapped onto the existing `clientRequestId` body field (same validation,
   same 1:1 order/intent guarantee); the body field remains the canonical
   contract for clients that already send it.
4. **OpenAPI rendering is deferred** until a generator can derive it from the
   route inventory without hand-maintaining a second description of every
   route. Rendering an outdated OpenAPI document would be a false claim.

## Consequences

- A new route with no auth decision cannot ship (matrix + allowlist fail).
- Documentation cannot describe a route the code does not mount, and vice versa
  (`docs-route-parity`, `env-parity`, inventories).
- The OpenAPI gap is intentional and tracked: DOC-07 keeps its freshness-test
  credit for the generated docs that DO exist.
