# Security

## Implemented controls
- **Passwords:** bcrypt (cost 12; 4 in tests only). Uniform login errors prevent user enumeration.
- **Sessions:** JWT access tokens (15 min, issuer-checked) + opaque refresh tokens stored as SHA-256
  hashes with rotation and revocation. Suspension/role-change revokes all refresh tokens immediately,
  and `requireAuth` re-validates account status per request so suspended accounts are cut off at once.
- **RBAC:** 13 roles → permission map enforced in middleware (`requirePermission`) plus per-resource
  ownership scoping in every farmer-facing query.
- **Input validation:** zod schemas on body/query for every route (coercion, length caps, regex for
  BD phone numbers, UUID checks for sync ids).
- **Injection prevention:** Prisma parameterized queries only; no raw string SQL from user input.
- **Upload safety:** MIME allowlist + magic-byte sniffing + 8 MB cap for disease images.
- **Rate limiting:** global (env-configured) + stricter per-hour AI limit; standard headers enabled.
- **Headers/CORS:** helmet defaults; CORS restricted to `WEB_ORIGIN` list; `x-powered-by` disabled;
  request IDs propagated via `X-Request-Id`.
- **Secrets:** `.env` never committed (`.gitignore`); `.env.example` documents all variables; the API
  **refuses to boot** in production with default/dev JWT secrets; logs redact auth headers/passwords.
- **Audit trail:** registration, login, checkout, payments, admin user changes recorded in
  `audit_logs` with actor/IP/entity metadata.

## Dependency scanning
GitHub Actions runs `npm audit --audit-level=high` on every push/PR (warnings surface in the job log).

## Reporting
See [SECURITY.md](../SECURITY.md) for responsible disclosure instructions.
