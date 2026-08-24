# Disaster Recovery

## Honest scope statement
Backup/restore is now **REHEARSED and VERIFIED** at the data layer (see evidence below).
RPO/RTO guarantees still depend on the production platform chosen at deployment time —
production-grade PITR (WAL archiving) remains UNVERIFIED until configured on real infrastructure.

## Backup policy (recommended baseline)
| Asset | Method | Cadence | Retention |
|---|---|---|---|
| PostgreSQL | managed snapshots / `pg_dump` custom format | daily full + WAL archiving (PITR) | 30 days |
| Object uploads (`uploads/`) | bucket versioning or rsync to secondary | daily | 30 days |
| Secrets | platform secret manager versioning | on change | n/a |
| Infrastructure config | Git (this repo) + IaC if adopted | every change | unlimited |

Suggested RPO ≤ 24h (≤ minutes with WAL/PITR). Suggested RTO ≤ 2h.

## Rehearsed evidence (2026-08-25, local PostgreSQL 17.5)
`apps/api/scripts/backup-restore-rehearsal.mjs` performs a full application-level logical backup →
destroy scratch DB → schema re-provision → data restore → per-table row-count verification +
orphan-FK spot check:

```
✅ RESTORE VERIFIED — 100% row integrity, no orphans
Backup: 929ms · Restore: 670ms · Total rehearsal: 12.6s
```

Re-run anytime:
```bash
DATABASE_URL=postgresql://…/agrobridge SCRATCH_URL=postgresql://…/agrobridge_restore_test \
  npm run pg:rehearse-backup   # inside apps/api
```
Production should still prefer `pg_dump -Fc` + `pg_restore` for speed and consistency snapshots;
the script exists so recovery is provable on any machine without extra tooling.

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
