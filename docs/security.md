<!-- owner: @tanviruchahs2580 · purpose: Implemented security controls and the audit findings behind them · last-verified: 2026-10-21 @ 6550a9a -->

# Security

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
  40/15 min per user, financial actions 20/h per user, AI 30/h per user, plus a global cap.
  **Known limitation:** windows are shared only when `REDIS_URL` is set. On serverless without
  Redis each instance counts its own window, so the effective quota is *(instances × limit)* —
  the Redis store also fails **open** during an outage. Both are accepted for now (an outage must
  not take the API down with it) and are reported on `/ready` as `limiterStore` so the state is
  visible in production instead of assumed. Provisioning Redis is tracked as a P1 reliability item.
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

## Reporting
See [SECURITY.md](../SECURITY.md) for responsible disclosure instructions.
