# Retention and logs — what is kept, for how long, and how to configure it

Two retention domains that are easy to confuse: **application logs** (stdout from the API
function, collected by the hosting platform) and **database rows** (Neon PostgreSQL, including
uploads stored by the `db` provider). The policy-level retention schedule lives in
`docs/data-protection.md:14-26`; this page records the mechanics and the operator levers.

## 1. Log fields and redaction

The API logs with **pino** to stdout; the field/redaction contract is
`apps/api/src/shared/logging/logger.ts`:

- Every line carries `service: "agrobridge-api"` via the pino `base` field, and the level comes
  from `LOG_LEVEL` (default `info`, `silent` under test) — `logger.ts:38-42`.
- **Redacted keys** (never reach the stream, at top level and via one-level wildcard for nested
  objects — `logger.ts:10-36`): `authorization`/`cookie` request headers, `password`,
  `passwordHash`, `token`, `refreshToken`, `phone`, `phoneNumber`, `lat`, `lng`, `latitude`,
  `longitude`, `secretKey`, `accessKey`, `S3_SECRET_ACCESS_KEY`.
- The list is a **denylist of field names, not a value scanner** — the file's own header states
  the intent is defence in depth so a future log call cannot leak farmer PII unnoticed. A new
  field name (e.g. a differently-named coordinate or credential) is *not* covered until it is
  added to `LOG_REDACT_PATHS`.
- Request correlation: `X-Request-Id` is propagated and echoed into error envelopes; support
  error codes (`AB-XXXXX`) correlate a user's screenshot with the exact line
  (`docs/play/release-runbook.md:188-189`, `docs/security.md` headers/observability sections).
- Registration logs a **masked** phone (`phoneMasked`, first 3 + last 4 digits —
  `apps/api/src/modules/auth/routes.ts:162`), not the raw number.

## 2. Platform log retention — how to configure it

- **Vercel (current production host):** runtime logs are visible in the project dashboard for a
  limited platform window. To keep logs longer, forward them with **Drains** (Vercel → project →
  Observability → Drains) to a custom HTTP endpoint or a native integration; the sink you choose
  owns the retention period. Drains are available on Pro/Enterprise; usage is billed by volume
  (official page fetched 2026-10-19: `https://vercel.com/docs/drains`).
- The repository's suggested setting is **30 days** for application logs
  (`docs/data-protection.md:24`); set that as the sink's retention when configuring Drains.
- **Self-hosted / docker operators:** neither `docker-compose.yml` nor `docker-compose.prod.yml`
  sets a `logging` driver (checked 2026-10-19), so the host's Docker defaults apply. Configure the
  daemon's log driver (`json-file` with `max-size`/`max-file`, or a shipped driver) to bound local
  log volume; pin `LOG_LEVEL=info` unless debugging.
- **No log-shipping code exists in the repository** — the API writes stdout only; everything
  beyond that is platform configuration, which is why this page exists as the operator guide.

## 3. Database retention facts

From the policy schedule (`docs/data-protection.md:14-26`, decision record
`docs/adr/0011-data-retention.md`) and the implementing code:

| Data | Retention | Mechanism / code |
|---|---|---|
| Account & profile | account lifetime | anonymized at deletion (`apps/api/src/modules/auth/routes.ts:544-565`) |
| Refresh tokens | 7 days (TTL) | expiry + rotation; revoked at deletion (`env.ts:25`; `routes.ts:544`) |
| OTP challenges | 5 minutes / until consumed | expiry; deleted at deletion (`routes.ts:354`, `:547`) |
| Disease photos | account lifetime | purged at deletion, best-effort per file, honestly reported (`routes.ts:567-585`); failures retry via `apps/api/scripts/purge-uploads.ts` |
| Disease-case metadata | account lifetime | rows retained after deletion (no file bytes) |
| Financial/ledger rows | **5 years** | retained; corrections are compensating entries only (ADR-0011) |
| Application logs | operator-configured (suggest 30d) | platform setting — §2 |
| Backups | **30 days**, then auto-expire | backup job retention; deletion does not rewrite dumps (ADR-0011 §4) |
| Audit log rows (`audit_logs`) | no automated pruning exists | the API writes audit events (registration, login, checkout, payments, withdrawals, reviews, admin changes — `docs/security.md` audit-trail bullet); no script deletes them (checked 2026-10-19: no `auditLog.delete*` under `apps/api/src` / `apps/api/scripts`), so they grow with usage and are kept indefinitely unless the operator adds archiving |

Uploads with `STORAGE_PROVIDER=db` live in the database (`StoredObject`), so **the database's
backup and size story is the uploads' story**: each upload is capped at 8 MB and JPEG metadata is
stripped before storage; database size grows with uploaded bytes (ADR-0012). Switching to `s3`
later moves bytes but not deletion semantics — the purge path goes through the storage provider
either way.

## 4. Volume considerations (operator-facing)

- **Uploads:** bounded per file (8 MB request cap, MIME allowlist) but unbounded in aggregate;
  watch database growth while `db` storage is active, and plan the `s3` switch (env set in
  `docs/play/launch-checklist.md` §2 "later") from measured volume, not estimates.
- **Audit rows:** grow with user activity and are never pruned by anything in this repository;
  if volume or legal minimums require bounded retention, that needs an explicit archive/prune job
  and a policy change recorded together.
- **Application logs:** DB errors are logged without connection details (`docs/security.md`
  secrets bullet); log volume is dominated by lifecycle/error events, not per-request access
  lines (there is no access-log middleware in `apps/api/src/app.ts` — checked 2026-10-19).
- **Sandbox SMS in production:** with `SMS_PROVIDER=sandbox`, OTP codes are **written to the log
  stream** instead of being sent (`apps/api/src/config/env.ts:104-105`). Keep that mode off any
  real deployment (set `SMS_PROVIDER=http` + gateway credentials, or `none` if OTP must not
  happen at all) — otherwise logs contain live authentication secrets for 5 minutes.
- **Local-disk orphan sweep (development/self-hosted only):**
  `apps/api/scripts/prune-uploads.mjs` deletes files older than 7 days with no matching
  `DiseaseCase` row; it targets `uploads/disease` on disk and is not part of the serverless path.

## 5. Configuration checklist

- [ ] Choose a log sink and retention (suggested 30 days) and wire it with Vercel Drains, or set
      the Docker log driver on a self-hosted host (§2).
- [ ] Set `LOG_LEVEL` deliberately (`info` in production; raise temporarily when debugging).
- [ ] When any log call adds a new sensitive field name, add it to `LOG_REDACT_PATHS`
      (`apps/api/src/shared/logging/logger.ts`) in the same change.
- [ ] Confirm the backup retention actually configured on the database plan matches the 30-day
      statement in the policies; if it differs, align whichever side is wrong (policy text or
      plan setting) before submission.
- [ ] Verify the SMS provider mode on any deployment where real users exist (§4).
