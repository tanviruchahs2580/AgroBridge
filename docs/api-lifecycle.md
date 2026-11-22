# API lifecycle policy (API-03)

Companion to ADR-0026 (generated OpenAPI) and the master prompt's backward-compatibility rule R7.
This page is the policy for how routes and fields age; it exists so removal is a process, not a
surprise.

## 1. Additive by default

Installed Android apps outlive API versions. Any change a shipped client can observe must be
**additive**: new optional request fields, new response fields, new routes. Renames and type
changes are breaking — they do not ship.

## 2. Breaking changes ride behind a flag

When a breaking change is genuinely required: ship it behind an env flag that **defaults to the
current behaviour** (the `AUTH_REFRESH_COOKIE` / `REQUIRE_REDIS_LIMITER` pattern), flip it only
after the client fleet has caught up. The flag registration goes through the usual generated docs
(env-reference, runtime-contract).

## 3. Deprecation

Before a route or field stops being served:

1. The OpenAPI operation gains `deprecated: true` and a description naming the replacement.
2. Responses carry `Deprecation: <date>` and `Sunset: <date>` headers (draft IETF Deprecation
   header field; both headers ship from the route's handler via the `context.ts` helpers once the
   first deprecation exists — the middleware lands with it, not speculatively).
3. The web client and the Android app stop calling it in the same release window.
4. Removal happens no earlier than the **second release after** the deprecation shipped.

## 4. Minimum supported app version

Each release's `CHANGELOG.md` entry states the **minimum supported app version** — the oldest
Android/web build the API still serves faithfully. A release may raise it only when the deprecation
window (§3) for everything the dropped builds rely on has expired.

## 5. Enforcement

- The generated OpenAPI diff in any `src/modules/**` PR is the review surface: a removed or
  retyped field is visible in the committed file's diff.
- The route-matrix PUBLIC-set guard and the response-shape fixture catch accidental contract
  changes; neither is a substitute for the lifecycle headers once a real deprecation exists.
