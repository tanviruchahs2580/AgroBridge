# AgroBridge — Disaster Recovery Report

Date: 2026-08-25  
Scope: Logical backup/restore rehearsal + RPO/RTO measurement. No actual PG was available this session, so no live rehearsal was executed; this report documents the rehearsal tool, previous verified result, and exact steps to reproduce. No faked durations.

## 1. Strategy
- Production: managed PostgreSQL with daily `pg_basebackup` + continuous WAL (PITR) + offsite copy (see `docs/disaster-recovery.md`)
- This repo's rehearsal: logical dump via Prisma-level export to JSON (no `pg_dump` on dev box) + scratch DB restore + per-table count + orphan check

## 2. Rehearsal Script
- Path: `apps/api/scripts/backup-restore-rehearsal.mjs`
- Tables covered (25): `User`, `RefreshToken`, `FarmerProfile`, `Farm`, `Plot`, `CropCycle`, `FarmEvent`, `AdvisoryQuery`, `DiseaseCase`, `Product`, `Cart`, `CartItem`, `Order`, `OrderItem`, `Service`, `ServiceProvider`, `Booking`, `ProcurementOrder`, `Payment`, `Wallet`, `WalletTransaction`, `MembershipPlan`, `Notification`, `AuditLog`, `AiUsageLog`
- Steps:
  1. Export: `SELECT * FROM "Table"` per table → JSON (`backup-<ts>.json`) + backupMs
  2. Recreate scratch DB: `DROP DATABASE IF EXISTS ...; CREATE DATABASE ...` on admin `postgres` DB, then `prisma db push --schema schema.postgresql.prisma` on `SCRATCH_URL`
  3. Restore: chunked `INSERT` (50 rows) respecting FK order (parents first as listed)
  4. Verify: per-table `COUNT(*)::int` source vs restored vs dump length; orphan query `FarmEvent LEFT JOIN Farm`
  5. Report: `Backup: Xms · Restore: Yms · Total: Z s` + ✅/❌ + exit code

## 3. Previous Verified Rehearsal (from CHANGELOG 1.1.0, PG 17.5, Windows)
- Result: **✅ RESTORE VERIFIED — 100% row integrity, no orphans**
- Total rehearsal: **12.6s** (backup + restore + verify)
- Evidence: `CHANGELOG.md:30` — "Backup → destroy → restore → integrity: 100% row match, no orphans (12.6s total rehearsal)"
- RPO (logical dump strategy): equals interval since last dump (recommended: daily dump → RPO ≤ 24h; with WAL → minutes)
- RTO (logical restore on dev hardware): ~6–8s restore + schema push + verification = ~12.6s total; production RTO with `pg_basebackup` restore will differ (measure on staging)

## 4. This Session — Attempt
- Command would be: `DATABASE_URL=postgresql://agrobridge:ci-password@localhost:5432/agrobridge SCRATCH_URL=postgresql://agrobridge:ci-password@localhost:5432/agrobridge_restore_test node scripts/backup-restore-rehearsal.mjs`
- Result: **NOT EXECUTED** — no PostgreSQL reachable (`docker ps` → no daemon; no `psql`)
- Evidence: `docker --version` not found; no `DATABASE_URL` with `postgresql://` set in env
- No new backup file was produced, so no RPO/RTO to measure this session

## 5. Reproduction on Staging With Docker
```bash
# Start PG + API
export POSTGRES_PASSWORD=... API_DATABASE_URL=postgresql://agrobridge:$POSTGRES_PASSWORD@localhost:5432/agrobridge
docker compose up -d --build
docker compose exec api npx prisma migrate deploy
# Seed
docker compose exec api npm run db:seed --workspace apps/api # or: node prisma/seed.ts inside api

# Run rehearsal from host (requires host node + deps):
DATABASE_URL=postgresql://agrobridge:$POSTGRES_PASSWORD@localhost:5432/agrobridge \
SCRATCH_URL=postgresql://agrobridge:$POSTGRES_PASSWORD@localhost:5432/agrobridge_restore_test \
node apps/api/scripts/backup-restore-rehearsal.mjs
# Expected: ✅ 100% row match, Total ~10-15s on dev hardware; measure Backup/Restore/Total separately
```

## 6. Rollback Drill (App + DB)
- App rollback: `docker compose pull` previous image tag or `git checkout <prev-tag> && docker compose up --build -d`; smoke `/health` + `select count(*) from ...` (see `docs/deployment.md` rollback)
- DB rollback: **Do not regress migrations** (append-only). For a bad migration, write compensating migration. Snapshot rollback is `pg_restore` from base backup + replay WAL to just before bad DDL.

## 7. Recommendations
- Enable `pg_cron` or external cron: `pg_dump -Fc` nightly to object storage (encrypted, versioned), retention 30d
- Enable WAL archiving (`archive_mode=on`, `archive_command` to S3) for PITR; test restore monthly
- Document `API_DATABASE_URL` and `POSTGRES_PASSWORD` rotation procedure and secret-manager (never in git)

## 8. Verdict This Session
- DR: `NOT TESTED` this session (infra blocked) — tool ready, prior pass verified, exact reproduction steps provided.

