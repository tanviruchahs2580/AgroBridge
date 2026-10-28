<!-- owner: @tanviruchahs2580 · purpose: Implemented security controls and the audit findings behind them · last-verified: 2026-10-21 @ 6550a9a -->

# Security

> **Owner:** engineering · **Purpose:** security controls, limits and accepted risks · **Last verified:** 2026-10-19 (branch `audit/v2-remediation`; re-verify with the claims/link checks in CI).


See also: `docs/threat-model.md` (STRIDE abuse cases with control locations and the tests that pin
them) and `docs/slo.md` (alert mapping). This page remains the control inventory.

## Implemented controls
- **Passwords:** bcrypt (cost 12; 4 in tests only). Uniform login errors prevent user enumeration.
- **Sessions:** JWT access tokens (15 min, issuer-checked) + opaque refresh tokens stored as SHA-256
  hashes with rotation and revocation. Suspension/role-change revokes all refresh tokens immediately,
  and `requireAuth` re-validates account status per request so suspended accounts are cut off at once.
- **RBAC:** 13 roles → permission map enforced in middleware (`requirePermission`) plus per-resource
  ownership scoping in every farmer-facing query. **Tenancy:** `Organization`/`OrganizationMember` + `Farm.organizationId`; CORPORATE/COOPERATIVE `org:read/org:manage` + farm queries scoped to `OR(ownerId, organizationId in members)`; zero cross-tenant leakage proven by tenant isolation test.
- **Input validation:** zod schemas on body/query for every route (coercion, length caps, regex for
  BD phone numbers, UUID checks for sync ids).
- **Injection prevention:** Prisma parameterized queries only; no raw string SQL from user input.
- **Upload safety:** MIME allowlist + magic-byte sniffing + 8 MB cap for disease images.
- **Rate limiting:** per-route policy, all fail-closed except the store itself. Quotas are keyed to
  the *caller*, not to the address they share (`middleware/rateLimitKeys.ts`): the global cap on a
  truncated SHA-256 of the presented bearer token (address for anonymous callers), login/refresh on
  the normalised account named in the body, authenticated routes on the authenticated user. The
  keying is a security property as much as a fairness one — an address-keyed quota lets one
  neighbour spend another user's brute-force budget, and it is what silently broke the AI feature
  for every user behind a carrier-NAT address (10 000 distinct users shared one exhausted quota).
  Policy: login 20/15 min per **account** (uniform error path, no enumeration), OTP request 5/h per
  user, OTP verify 20/h per user, registration 10/h per **address** (deliberate: it is the
  mass-account-creation control and the key would otherwise be attacker-supplied), checkout
  40/15 min per user, financial actions 20/h per user, AI `AI_HOURLY_LIMIT`/h per user (default 30),
  plus a global cap.
  **Each limiter owns its store instance and its Redis key namespace.** Both halves are load-bearing
  and neither is visible without `REDIS_URL`: express-rate-limit refuses a Store shared by two
  limiters (ERR_ERL_STORE_REUSE, raised as a 500 on the second limiter's first request), and the
  counter key it passes comes only from the request — so two limiters on the same Redis without a
  prefix write the same key and enforce one budget between them. Four auth limiters shared one store
  until 2026-10-28, which would have 500'd OTP request/verify and password forgot/reset in any
  Redis-enabled deployment; `apps/api/tests/rate-limit-store-wiring.test.ts` now fails if either
  invariant is broken again.
  **Known limitation:** windows are shared only when `REDIS_URL` is set. On serverless without
  Redis each instance counts its own window, so the effective quota is *(instances × limit)* —
  the Redis store also fails **open** during an outage. Both are accepted for now (an outage must
  not take the API down with it) and are reported on `/ready` as `limiterStore` so the state is
  visible in production instead of assumed. Provisioning Redis is tracked as a P1 reliability item.

  **Why that is survivable today (defense in depth, AUD-V3 assessment):** the brute-force control
  that matters is *per-account*, and that one is **database-backed**, not in memory —
  `modules/auth/accountThrottle.ts` locks an account for 15 minutes after 10 failed logins and
  every instance sees the same rows, so the per-account budget does NOT multiply with instances
  even on serverless. What multiplies is only the softer per-IP/per-user request *quota*. When a
  Redis is provisioned, the store's window arithmetic is atomic (one Lua round trip for
  INCR+EXPIRE+TTL, with orphan-key healing — `infrastructure/rateLimitRedis.ts`), so a crash
  between operations can no longer leave a TTL-less counter locking an account's bucket forever.
- **Territory scoping (BR-23):** a territory role (REGIONAL/AREA/PROCUREMENT/COLLECTION_MANAGER)
  whose `region` column is empty is **unrestricted** today: `GET /api/v1/procurement` returns every
  region's offers — each row carrying the farmer's name and phone — and the review/payout guards
  treat a null region as "no limit", so such a manager can act on another region's records. An
  operator creates that state with one `PATCH /admin/users/:id` (role set, region omitted), so it is
  a configuration omission rather than an attack. It is deliberately fail-open in
  `lib/territory.ts`, logged as `territory.unassigned`, pinned by
  `apps/api/tests/territory-unassigned.test.ts`, and awaiting an owner decision on the default
  (ODL-007) — this run did not change a permission boundary on its own authority. Operators should
  assign a region whenever they assign a territory role.
- **Overload behaviour:** the API refuses work it cannot serve instead of queueing it. Past
  `MAX_CONCURRENT_REQUESTS` in-flight requests it answers `503 OVERLOADED` + `Retry-After`
  immediately, and a database pool timeout is mapped to `503 DB_POOL_EXHAUSTED` rather than a bare
  500. Before this, one instance under a 10 000-user spike held requests for minutes — 44 % exceeded
  30 s and it never recovered. Refusal is bounded and honest, and `/health`, `/ready` and `/metrics`
  are deliberately outside the guard so an operator can still see the instance drowning.
- **Headers/CORS:** helmet on the API (CSP, HSTS, COOP/CORP, `nosniff`, `X-Frame-Options`,
  `Referrer-Policy: no-referrer`, no `x-powered-by`); CORS restricted to the `WEB_ORIGIN` list;
  request IDs propagated via `X-Request-Id` and echoed into every error envelope.
  The **static site** now ships its own edge policy too — CSP (`script-src 'self'` plus the
  theme-boot script's hash, `frame-ancestors 'none'`, no `unsafe-inline` for scripts), `nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (camera limited to
  self for the photo intake, geolocation off), `Cross-Origin-Opener-Policy`, and immutable caching
  for hashed assets. Both Vercel configs carry it, the build fails if they diverge or if the CSP
  hash drifts from the built HTML, and the deploy gate asserts the live headers. Full policy and
  the reasoning per header: `docs/deployment.md` §7.
- **Secrets:** `.env` never committed (`.gitignore`); `.env.example` documents the variables the
  code actually reads (`API_PUBLIC_URL`, not the `API_BASE_URL` that never existed in code); the API
  **refuses to boot** in production with default/dev JWT secrets; logs redact auth
  headers/passwords, and provider/datasource errors are never logged with their connection details.
- **Observability endpoints:** `/health` and `/ready` are public and intentionally minimal;
  `/metrics` is restricted in production to private source addresses or a `METRICS_TOKEN` bearer
  (`apps/api/src/middleware/metricsGuard.ts`), and request metrics label the matched route pattern
  rather than the raw URL (`apps/api/src/infrastructure/metrics.ts`), so unmatched scanner traffic
  cannot mint unbounded label sets.
- **Audit trail:** registration, login, checkout, payments, withdrawals, disease reviews and admin
  user/role changes recorded in `audit_logs` with actor/IP/entity metadata.
- **Release integrity:** production is only considered current when its **commit and its schema**
  include what `main` reviewed — `/ready` reports the applied migration chain and the deploy gate
  compares it with the repository (ADR-0007).

## Dependency scanning
`ci.yml` fails the build on any **moderate+** finding in production dependencies
(`npm audit --omit=dev --audit-level=moderate`); the dev tree is audited non-blockingly. Gitleaks
scans history for committed secrets, Trivy fails the image build on HIGH/CRITICAL (accepted risks in
`.trivyignore`, each cross-referenced to `SECURITY_WAIVERS.md` with an expiry), and CodeQL runs on
every push and PR. Action pins are full SHAs with the version in a trailing comment.

## Status notes (re-verified against the tree 2026-10-28): DAST, attestation, headers

Code facts only — status statements, not claims of coverage:

- **DAST:** `.github/workflows/dast.yml` ("Security — DAST baseline (ZAP)") runs a live ZAP
  baseline scan against a locally composed `db + api` stack on pull requests to `main` and on
  manual dispatch, alongside CodeQL (SAST, `codeql.yml`), Trivy image and config scanning plus
  CycloneDX SBOM generation (`ci.yml:415-434`, `:487-541`), secret scanning, the security-baseline
  test suites, and the deploy gate's live-header assertions. A baseline scan is a smoke-level pass
  over the classes it covers — not a penetration test, and not a coverage claim.
- **Build attestation:** `ci.yml`'s `docker-build` job calls `actions/attest-build-provenance` for
  the built API image, so provenance attestation IS produced for that artefact. Release integrity
  otherwise rests on SHA-pinned actions, the SBOM artifact, the apksigner/jarsigner signature checks
  (`android-release.yml:115-144`), and the deploy gate that compares the running commit and applied
  schema with the repository (ADR-0007).
- **Headers:** the API helmet policy and the static-site edge policy are described above; the live
  assertions run in `deploy-verify.yml`, and the web build fails if the two Vercel configs'
  policies diverge or if the CSP hash drifts from the built HTML
  (`docs/deployment.md` §7). No scanner asserts header *values* today other than that gate.

## Reporting
See [SECURITY.md](../SECURITY.md) for responsible disclosure instructions.
