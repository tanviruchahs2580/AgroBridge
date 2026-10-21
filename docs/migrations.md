# Migration notes — forward, lock and rollback posture

> **Owner:** engineering · **Purpose:** per-migration safety posture for the two chains; the release gate enforces that production has applied the newest PostgreSQL migration (ADR-0007). · **Last verified:** 2026-10-19.

Policy: every migration is **expand/contract**. A release adds columns, tables
and indexes; code that uses them ships in the same release and tolerates their
absence (read paths guard, write paths feature-detect through the schema
readout). Destructive steps (drop column, rewrite table, drop index in use)
follow a separate later release after the previous one has been live for a full
release cycle.

Rollback posture per migration: the **deploy** rolls back by promoting the
previous deployment (old code ignores new columns/tables). The **schema** is
forward-only — a rollback migration is written only when a destructive step is
being introduced, and then it is reviewed as its own change. `deploy-migrations.mjs`
is idempotent (probe + `migrate deploy`), so re-running is always safe.

| Migration (PostgreSQL chain) | Forward | Lock risk | Backfill | Rollback |
|---|---|---|---|---|
| `init_postgres` | full schema | none (empty DB) | n/a | n/a |
| `wallet_held_paisa` | add column default 0 | none on PG 11+ | implicit default | old code ignores column |
| `payment_pending_per_user` | partial unique index | short index build; table was pilot-sized | none | drop index (safe once duplicates impossible) |
| `status_created_at_idx` | index | short | none | drop index |
| `hot_query_indexes` | six indexes | short, non-concurrent (pilot volume); use `CREATE INDEX CONCURRENTLY` when the tables grow past ~100k rows | none | drop index |
| `order_idempotency_feedback_indexes` | column + unique index + feedback columns | non-concurrent; acceptable at pilot volume — the runbook records the rule to switch to CONCURRENTLY before scale | `clientRequestId` nullable (no backfill needed) | old code ignores the column; index droppable |
| `durable_storage_ai_provenance_purge_queue` | two new tables + three nullable columns | none (new objects, nullable adds) | none | old code ignores; tables unused by old code |
| `login_attempt_throttle` | new table | none | none | old code ignores; pruning is the retention job's job |

The SQLite chain mirrors these for local development; the parity guard
(`tests/schema-parity.test.ts`) plus the CI drift job keep the two from
diverging in ways that matter (models, fields, attributes).

**Backup prerequisite:** production migrations run against Neon with PITR
available; before a destructive change the operator takes a named restore point
(`docs/runbooks/failed-transaction-recovery.md`). The restore rehearsal
(`apps/api/scripts/backup-restore-rehearsal.mjs`) proves the data layer's
logical restore path and is re-run each audit cycle.
