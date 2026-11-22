# Runbook — restore drill (gate G4, OA-06)

Purpose: produce **signed evidence** that a backup can be restored within an RTO the owner
accepts, without ever touching a non-disposable database. The rehearsal script drops its scratch
target — the guard exists so it can never be pointed at production by accident.

## 1. What to run, where

### Local (engineering; proves the data layer)

```bash
# Disposable Postgres for this project (compose project name is pinned: agrobridgeapp)
docker compose up -d db
DATABASE_URL=postgresql://postgres@localhost:5433/agrobridge \
SCRATCH_URL=postgresql://postgres@localhost:5433/agrobridge_restore_test \
  npm run pg:rehearse-backup --workspace apps/api
```

The script refuses any scratch host outside `SCRATCH_HOST_ALLOW` (default: `localhost`,
`127.0.0.1`, `::1`, `0.0.0.0`) and anything on `SCRATCH_HOST_DENY`, and refuses when
`SCRATCH_URL == DATABASE_URL`. It writes `restore-drill-receipt-<timestamp>.md` next to the working
directory with the timed phases; move it to `qa-evidence/receipts/` and fill in the machine and
commit lines before committing.

### Remote (owner; the drill that actually counts, OA-06)

The production database is Neon. The drill target is a **disposable Neon branch restored from
PITR** — never the primary:

1. In the Neon console, create a branch/database from a known restore point (PITR) and note the
   branch endpoint hostname.
2. Run the same command with `DATABASE_URL` = the branch URL **read-only intentions** (dump from
   the branch, since the primary must not be scraped) and `SCRATCH_URL` = a second disposable
   database on the same branch, plus `SCRATCH_HOST_ALLOW=<exact branch endpoint host>`.
   The allow-list is per-host and explicit on purpose: a typo cannot select production.
3. Commit the receipt; sign the RPO/RTO (below).

## 2. The timed phases (what each proves)

| Phase | What it measures |
|---|---|
| Dump (export) | Time to read every table out of a running Postgres — the RPO-side cost of a logical backup |
| Restore (schema + data) | Time to rebuild schema (`prisma db push` of the **production** schema file) and reinsert every row in FK-safe order |
| Row-count verification | Source = dump = restored per table, plus the orphan spot-check |
| Smoke queries | The queries a recovered deployment serves first (user/order/payment counts, latest audit and payment rows) |

## 3. RPO / RTO — definitions and the signing step

- **RPO** (recovery point objective): the maximum acceptable data loss window. For Neon PITR the
  theoretical floor is the PITR window granularity; the operator's choice (e.g. "≤ 5 minutes") is
  what gets signed. Engineering does not sign it.
- **RTO** (recovery time objective): how long until the service is serving again. The drill
  measures the data-layer portion (dump → restore → verify → smoke). Deployment cutover
  (env switch to the restored endpoint) adds minutes on top — the runbook must state the full
  path before the number is signed.
- The owner signs both numbers **on a committed receipt** (`qa-evidence/receipts/TEMPLATE-restore-drill.md`
  is the skeleton). `docs/disaster-recovery.md` records the *procedure*; it must never state RPO/RTO
  as facts until a signed receipt exists.

## 4. What this drill does NOT prove (say it in the receipt)

- It is an application-level logical rehearsal (no `pg_dump` on this machine; production's real
  restore path is Neon PITR + a fresh branch, which the remote drill above exercises).
- It does not rehearse the deploy cutover, secret rotation against a restored DB, or the
  "restore under active incident load" case — each is a separate drill.
- It does not prove backups *exist* — the existence of PITR on the paid Neon plan is an OA-06
  precondition.
