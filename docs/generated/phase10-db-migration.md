# Phase 10 — Database & Migration Strategy (Local Prep, No Push)

**Status:** PREPARED — no push, no deploy
**Gap:** `docker/api.Dockerfile:23-28,32` deletes `prisma` + `npx`, yet `docker-compose.prod.yml:9` and `render.yaml:18` call `npx prisma migrate deploy` / `db push` — prod deploys would fail. Also `render.yaml:18` uses `db push` + re-seed (drift) not `migrate deploy`.

## Prepared Fix (non-visual)

### Option A (recommended, retains CLI and fixes Trivy):
- Upgrade `prisma` `6.5.0 → 6.19.3` (root `package.json:14,26`, `apps/api/package.json:27,51`) — `deepmerge-ts` CVE fixed in 6.19.x, so runtime can retain CLI and still pass Trivy HIGH/CRITICAL.
- Runtime stage: `npm ci --omit=dev` then `COPY --from=build /app/node_modules/prisma` + `.bin/prisma` retained; **do not** `rm -rf /usr/local/bin/npx` (keep npx for migrate).
- Or: build stage is full toolchain; runtime keeps `prisma@6.19.3` as prod dep.

### Option B (no CLI in runtime, separate migrate job):
- Keep current slim runtime (no prisma/npx), but move migration to a one-off `migrate` service in `docker-compose.prod.yml` using `build` image: `docker compose run --rm migrate npx prisma migrate deploy` before `api` starts. `render.yaml` preDeploy stays on build image, not runtime.

### Policy (enforced)
- `prisma migrate dev` in dev, `prisma validate` in CI (`ci.yml:59`), `prisma migrate deploy` in prod — never `db push` (except local `provision-postgres.mjs:18` for test).
- Pre-migration backup via `apps/api/scripts/backup-restore-rehearsal.mjs` (already exists, last rehearsed 2026-08-25 `docs/disaster-recovery.md:18`), must be wired into `deploy-staging.yml:119` and prod pipeline.
- Single prod DB standard: `postgresql` (`schema.prisma` sqlite is dev/test only, `schema.postgresql.prisma` is prod).

## UI/UX Impact
**none** — infra only.

## Next (requires push)
Apply `api.Dockerfile` Option A, `render.yaml:18` change `db push && db seed` → `migrate deploy`, `docker-compose.prod.yml:9` migration service, CI re-run `trivy-scan` to confirm 0 HIGH.
