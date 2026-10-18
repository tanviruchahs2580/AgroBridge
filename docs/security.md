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
- **Rate limiting:** per-route policy, all fail-closed except the store itself: login 20/15 min per
  IP (uniform error path, no enumeration), OTP request 5/h, OTP verify 20/h, registration 10/h,
  checkout 40/15 min, financial actions 20/h per user, AI 30/h per user, plus a global cap.
  **Known limitation:** windows are shared only when `REDIS_URL` is set. On serverless without
  Redis each instance counts its own window, so the effective quota is *(instances × limit)* —
  the Redis store also fails **open** during an outage. Both are accepted for now (an outage must
  not take the API down with it) and are reported on `/ready` as `limiterStore` so the state is
  visible in production instead of assumed. Provisioning Redis is tracked as a P1 reliability item.
- **Headers/CORS:** helmet on the API (CSP, HSTS, COOP/CORP, `nosniff`, `X-Frame-Options`,
  `Referrer-Policy: no-referrer`, no `x-powered-by`); CORS restricted to the `WEB_ORIGIN` list;
  request IDs propagated via `X-Request-Id` and echoed into every error envelope.
  **Known gap:** the static site (the SPA itself, i.e. the origin that runs the app's JavaScript)
  ships only HSTS — Vercel's default. No CSP, `nosniff`, frame or referrer policy. Logged as a
  P2 web-edge finding in the 2026-10-18 architecture audit.
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
