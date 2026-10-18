# Runbook — Secret Rotation

Rotate one credential class at a time. Every rotation below is **restart/redeploy-scoped**: the
API reads its secrets once at boot (`apps/api/src/config/env.ts` parses `process.env` at import
time), so an environment change without a restart changes nothing and is the most common way a
"rotation" silently does not happen.

## Triggers

- Credential is suspected or confirmed exposed (leak, laptop loss, ex-employee, paste into a log).
- A provider requires rotation (gateway/SMS vendor policy).
- Scheduled hygiene for `JWT_*` secrets (suggest 180 days) — record the rotation in
  `EXECUTION_LOG.md`; secrets themselves never enter the repo or this runbook.
- `SECURITY_WAIVERS.md` row has expired and the remediation is a rotation.

## Where each class lives

| Class | Where set | Read by |
|---|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Vercel project `agro-bridge-api` env (Production + Preview); `.env` on the compose VM | `apps/api/src/config/env.ts` |
| `DATABASE_URL` (+ Neon `POSTGRES_*`/`DATABASE_URL_UNPOOLED`) | injected by the Neon marketplace integration; never copied to disk | Prisma client |
| `POSTGRES_PASSWORD` (compose stack) | `.env` beside `docker-compose.prod.yml` | `db` service |
| `SSLCOMMERZ_STORE_ID` / `SSLCOMMERZ_STORE_PASSWORD` | Vercel env / VM `.env` | `PAYMENT_PROVIDER=sslcommerz` adapter |
| `OPENAI_API_KEY`, `OPENWEATHER_API_KEY` | Vercel env / VM `.env` | AI / weather adapters |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Vercel env / VM `.env` | `STORAGE_PROVIDER=s3` adapter |
| `METRICS_TOKEN` | Vercel env / VM `.env` | `/metrics` guard (production) |
| `STAGING_*` (deploy secrets) | GitHub repo secrets | `.github/workflows/deploy-staging.yml` |

## Rotation 1 — JWT secrets (all sessions invalidated)

JWT access tokens are stateless; rotating either secret logs **every user out** at the next
request (401), so rotate deliberately, never mid-incident without announcing it.

```bash
# 1. generate two fresh 64-char hex secrets (never reuse; never commit)
openssl rand -hex 32   # → JWT_ACCESS_SECRET
openssl rand -hex 32   # → JWT_REFRESH_SECRET

# 2. Vercel production project
vercel env rm JWT_ACCESS_SECRET production -y && vercel env add JWT_ACCESS_SECRET production
vercel env rm JWT_REFRESH_SECRET production -y && vercel env add JWT_REFRESH_SECRET production
# (repeat for the Preview environment; the dashboard works equally well)

# 3. redeploy so the function boots with the new values (env changes do not hot-reload)
cd apps/api && vercel build --prod && node scripts/patch-vercel-output.mjs
rm -rf ../../.vercel/output && cp -r .vercel/output ../../.vercel/output
cd ../.. && vercel deploy --prebuilt --prod --yes

# 4. compose/VM stack instead: edit .env beside docker-compose.prod.yml, then
docker compose -f docker-compose.prod.yml up -d api
```

Verification (both must hold):

```bash
curl -s https://agro-bridge-api-vantiq-systems.vercel.app/health            # {"ok":true,...,"commit":"<new short sha>"}
curl -s https://agro-bridge-api-vantiq-systems.vercel.app/ready             # {"ok":true,"db":true,"schema":{...}}
# an access token minted before rotation must now be rejected (expect 401 envelope AUTH_*)
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer <old-token>" \
  https://agro-bridge-api-vantiq-systems.vercel.app/api/v1/auth/me
# a fresh login must succeed
```

Rollback: restore the previous secret values and redeploy — old tokens become valid again, so
rollback re-opens whatever caused the rotation. Prefer accepting the logout wave.

## Rotation 2 — Database credential (`POSTGRES_PASSWORD`)

1. Change the password in Neon (or the compose `db` service).
2. Update `DATABASE_URL` (and any `POSTGRES_*` mirrors) in the API environment. The Neon
   integration updates them for you; a manual `DATABASE_URL` must be updated on both the pooled
   and unpooled URLs — migrations use the unpooled one.
3. Redeploy / `up -d api`, then verify with the `/ready` **schema readout** (below) — it must
   still print the same `schema.latest` as before the rotation.
4. Compose stack: update `.env` then `docker compose -f docker-compose.prod.yml up -d db api`.
   The `db` healthcheck (`pg_isready`) in `docker-compose.prod.yml` gates the API restart.

## Rotation 3 — Provider credentials (payment / SMS / AI / weather / storage)

Rotate in the provider dashboard, then update the env var and redeploy as in Rotation 1.

- `SSLCOMMERZ_STORE_PASSWORD` is part of the **signature** (`sslcommerzSignature` in
  `apps/api/src/modules/payments/routes.ts`); a wrong value makes every webhook verification
  fail closed (rejected), which is the safe direction — reconcile pending payments afterwards
  via the failed-transaction-recovery runbook.
- `OPENAI_API_KEY` / `OPENWEATHER_API_KEY` failures degrade to the offline engine / mock
  provider paths; see provider-outage.md for what users see.
- `S3_*` rotation is coupled: rotate the key pair, deploy, then verify one disease-photo upload
  and one read-back before deleting the old key in the provider console.

## Verification checklist (every rotation)

- [ ] `/health` returns `ok:true` with the commit of the redeploy
- [ ] `/ready` returns `db:true` and `schema: { known: true, latest: "<expected migration>" }`
- [ ] One real login + one authenticated read succeed (not just an unauthenticated probe)
- [ ] The old credential is rejected (test it, do not assume)
- [ ] Rotation recorded in `EXECUTION_LOG.md` (class, date, operator — never the value)

If a secret **leaked**, also follow `docs/data-protection.md` §"Breach notification runbook"
(T+0…T+72), and file the incident per `docs/operations.md` §"Incident quick reference".

## Rollback

Per class: restore the previous value and redeploy. There is no rollback for a leaked secret —
the old value must be assumed compromised the moment it left its vault.

## Owner

Engineering (repo owner `@tanviruchahs2580`). Provider-console access is held by the same single
maintainer; a second holder is required before this runbook can be executed out-of-hours safely —
recorded as an open operational risk, not an assumption.

## Evidence record

| Date | Class rotated | Operator | /ready verified | Old value rejected | Notes |
|---|---|---|---|---|---|
| | | | | | |
