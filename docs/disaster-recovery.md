# Disaster Recovery

## Honest scope statement
This repository ships the **procedures and hooks** for backup/restore. Actual RPO/RTO guarantees
depend on the production database platform chosen at deployment time — they are **UNVERIFIED until
you configure, schedule and rehearse them on your infrastructure** (Rule 48: no untested DR claims).

## Backup policy (recommended baseline)
| Asset | Method | Cadence | Retention |
|---|---|---|---|
| PostgreSQL | managed snapshots / `pg_dump` custom format | daily full + WAL archiving (PITR) | 30 days |
| Object uploads (`uploads/`) | bucket versioning or rsync to secondary | daily | 30 days |
| Secrets | platform secret manager versioning | on change | n/a |
| Infrastructure config | Git (this repo) + IaC if adopted | every change | unlimited |

Suggested RPO ≤ 24h (≤ minutes with WAL/PITR). Suggested RTO ≤ 2h.

## Restore procedure
1. Provision replacement DB host/container.
2. `pg_restore -d $DATABASE_URL latest.dump` (or restore snapshot; PITR to timestamp if enabled).
3. Point API `DATABASE_URL` at restored instance; keep app instances running (they reconnect).
4. Run `npx prisma migrate deploy` — reports already-applied (no-op) confirming schema consistency.
5. Verify: `/ready`, admin login, one farmer journey, payments list integrity.
6. Re-enable writes/traffic fully after step-5 checklist passes.

## Migration rollback strategy
Migrations are forward-only. To undo a bad release migration:
1. Stop rollout.
2. Author a **compensating migration** reverting only the harmful change.
3. Review in PR with `prisma migrate diff`, test on clean DB, deploy.

## Rollback of application
Redeploy previous immutable build/image tag. The API holds no local state (SQLite is dev/test only),
so rollback is safe against an unchanged database. If a migration accompanied the bad release,
apply the compensating migration first.

## DR drill (do this before claiming readiness)
Quarterly: restore yesterday's snapshot into staging, run the deployment verification checklist
(deployment.md §6), time it, record gaps.
