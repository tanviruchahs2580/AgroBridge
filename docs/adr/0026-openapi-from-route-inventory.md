# ADR-0026 — OpenAPI is generated from the route inventory, with a freshness gate

- Status: accepted
- Date: 2026-11-23
- Deciders: engineering
- Supersedes: ADR-0021 (the deferral — this implements its stated condition)
- Findings: ARC-03, API-01, API-03

## Context

ADR-0021 deferred an OpenAPI document until it could be **generated** from the route inventory
plus the Zod schemas — a hand-written spec drifts, and drift in the API contract is exactly what
the response-shape fixture and the route-matrix gates exist to prevent. The 2026-11-23 remediation
wave (WP-19) made the inventory itself shareable, which is what the deferral was waiting for.

## Decision

1. **`docs/generated/openapi.json` is generated, never hand-written.**
   `scripts/generate-openapi.mjs` derives it from the same source parse as the route matrix
   (`collectRoutes()` was extracted from `route-matrix.mjs` so both share one parser and cannot
   disagree about what the source mounts): full mounted paths (resolved from `app.ts`'s
   `v1.use("<prefix>", <router>)` and the per-module sub-router factory mounts, same fixed-point
   as the auth scoping), operationIds, module tags, the auth chain (`security` + `x-permission`),
   and the `validate()` Zod schema names as `x-request-schema`.
2. **The envelope is the only response schema for now, and that is honest.** ADR-0022 makes
   `{ok, data, requestId}` / `{ok, error, requestId}` THE response contract, so the shared
   `ResponseEnvelope` component is truthful for every operation. Per-request-body JSON Schemas are
   the explicit follow-up: `x-request-schema` names the exact Zod schema const per operation
   (58/92 operations carry one today — the rest parse params only), so the follow-up is a
   mechanical import of those schemas via Zod 4's JSON-Schema conversion, not discovery work.
   Nothing in the document is invented or placeholder.
3. **Drift is gated two ways**: `generate-openapi.mjs --check` in the `quality-gates` CI job, and
   `tests/generated-docs-freshness.test.ts` re-renders and byte-compares. Breaking-change review
   is the diff of the committed file in any PR that touches `src/modules/**` — visible by
   construction.
4. **Spectral linting lands as its own dependency PR** (§9 authorizes the Spectral CLI;
   `CONTRIBUTING.md`/R4 require package-lock changes to ride a dedicated `ci(deps)` PR) — the
   ruleset is minimal: operation-id uniqueness, security on non-PUBLIC operations, no
   `x-request-schema`-less mutating route added after the follow-up.
5. **Lifecycle policy** (`docs/api-lifecycle.md`): additive changes only for shipped clients (R7
   of the master prompt), breaking changes behind env flags that default to current behaviour,
   `Deprecation` + `Sunset` response headers required before removing a route, and the minimum
   supported app version recorded per release.

## Consequences

- The API surface is now diffable and machine-readable without booting the app.
- A route added without the generator noticing is impossible — the parser and the auth-scope guard
  read the same files.
- Follow-ups, in order: per-route body schemas via Zod 4 `toJSONSchema` (a second PR), then the
  Spectral devDependency (a `ci(deps)` PR), then the lifecycle policy's `Deprecation` header
  middleware when the first deprecation actually happens.
