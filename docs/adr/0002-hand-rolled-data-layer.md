# ADR-0002 — The web data layer is hand-rolled: `api()` + `useResource`, no query library

- Status: accepted
- Date: 2026-10-18
- Deciders: engineering; decision already in force, recorded by the Phase 4 quality review

## Context

All server state in `apps/web` flows through two hand-written modules:

- `src/lib/api.ts` — one typed transport. The base URL is build-time configurable
  (`VITE_API_BASE_URL`, default `/api/v1`) so the same bundle works behind an nginx proxy, as a
  Capacitor APK or as a cross-origin PWA. Bearer auth is delegated to `sessionManager` (single
  token truth), with single-flight refresh, timeout + retry, an
  `ApiError { status, code, message, details, reference }` envelope, a fire-and-forget
  `wakeBackend()` cold-start ping, and a critical-flow guard that suppresses session destruction
  while checkout/payment is in flight.
- `src/lib/useResource.ts` — the only React data hook. `useResource(key, fetcher)` owns
  loading / refreshing / error / reload / optimistic `setData`; `invalidate(key)` and
  `useInvalidation()` are the declarative refetch mechanism after mutations. `key` is a resource
  *family* — everything that changes together shares one key — which is what makes partial failure
  survivable: one failing panel no longer blanks the page. A newest-request-wins guard stops a slow
  reload from overwriting a newer invalidated result.

The 2026-10-17 code-quality review (finding WEB-1) measured the situation this replaced: before
the hook, 10 of 14 screens re-implemented `loading`/`error`/`finally` + retry, and mutations
refetched by calling per-screen `load()` functions by hand — ~17 manual refetch sites, each a
stale-UI bug in waiting. The Phase 1 remediation migrated all 14 screens (27 resources across 11
files) onto `useResource`; `grep "async function load()"` over `features/` now returns nothing,
and the hook arrived with the repository's first component tests (including two StrictMode
regressions that were verified to fail against the unfixed hook).

## Decision

Keep the custom transport and `useResource`. Do not add TanStack Query / SWR / RTK Query.

The hook's own header states the reasoning: it deliberately omits cache persistence
(deduplication window) and background refetching. At this app's size — a phone-first SPA with 14
screens — those features would be unused surface area. What was actually missing was
*ownership* (one place that knows a resource is loading / errored / stale) and *cancellation* (a
stale response must not win). A query library would add a dependency, a provider component, its
own integration with the session/refresh flow, and a second caching mental model beside the
app's existing `invalidate` semantics.

## Revisit triggers — what would justify a query library

Revisit this ADR if any of these become true:

1. A **persisted read cache** is needed (offline reading of previously loaded data), not just the
   write queue in `lib/offlineQueue.ts`.
2. Several screens need the same resource with **shared dedup / window-focus** semantics, or a
   screen needs polling/background refresh (today a mount refetches; `invalidate` is manual).
3. Pagination / infinite queries appear on more than one screen.
4. Data-fetching bugs recur that `useResource` cannot express (e.g. dependent queries, rollback
   beyond `setData`).
5. The team grows past the point where maintaining a hand-written hook is cheaper than library
   upgrades.

The migration seam is contained: features call `api()` inside a fetcher and use
`useResource` / `invalidate` for everything else, so adoption means replacing the hook internals
(and `invalidate` semantics) behind the same call sites — not rewriting features.

## Consequences

- No added runtime dependency; network behaviour (timeouts, refresh, error mapping, offline
  queueing) lives in one auditable file with its own unit tests (`api.test.ts`,
  `useResource.test.tsx`).
- No cache deduplication: two mounted resources sharing a key each fetch once per mount; no
  devtools, no `staleTime` inspector. Accepted — the review's acceptance criterion was declarative
  invalidation and no feature-level `load()`, both satisfied.
- Every mutation author must remember `invalidate(<key>)`; the hook cannot infer it. That is the
  documented trade of WEB-1 and stays on review checklists.
- A future reader must not "fix" the absence of a query library by adding one; WEB-1's P1 status
  is about discipline (invalidation coverage), not about the choice of mechanism.
