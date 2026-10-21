# ADR-0016: OpenAPI deferral and the documentation freshness gates

Status: Accepted · Date: 2026-10-21

Related: ADR-0014 (contract strategy — generated inventories), DOC-07.

## Context

The V2 audit scored DOC-07 on generated reference material. An OpenAPI document
describing 65+ routes would be a second hand-written description of the API —
exactly the class of artifact that drifts (docs/api.md vs routes was an actual
audit finding, AUD-157's neighbours).

## Decision

1. Generated, version-checked documents ship today: the route matrix, the env
   reference and the ERD — each regenerated from source by a script whose
   committed output fails tests when stale (`tests/route-matrix.test.ts`,
   `tests/env-parity.test.ts`, `tests/schema-parity.test.ts`).
2. A hand-maintained `docs/api.md` remains the *narrative* reference (flows,
   caveats, error semantics) — narratives cannot be generated.
3. OpenAPI ships when a generator derives the document from the route inventory
   plus the zod schemas; rendering a stale OpenAPI file is explicitly refused
   by this decision.

## Consequences

- DOC-07 score rests on the freshness-tested generated references; an OpenAPI
 TODO remains tracked here rather than shipped stale.
- `docs/api.md` claims are cross-checked against the generated inventories by
  `tests/docs-route-parity.test.ts`.
