# ADR-0007 — Production schema state is part of the release contract, and the deploy gate proves it

- Status: accepted
- Date: 2026-10-18
- Deciders: engineering; decision forced by a verified production finding (below)

## Context

Deployment verification proved that production runs the reviewed **commit**: the web bundle reports
its commit in `/version.json`, the API reports one on `/health`, and `deploy-verify.yml` compares
both with `main` by ancestry and refuses to pass on staleness.

Nothing proved anything about the **schema**. Migrations are applied by hand —
`apps/api/scripts/deploy-migrations.mjs`, documented in `docs/runbooks/live-deployment.md` — and no
gate, workflow or readiness endpoint noticed whether that had happened.

On 2026-10-18 an architecture audit queried production directly and found three migrations recorded
in the repository but never applied to the production database:

| Migration | What production was missing |
|---|---|
| `20261016000000_payment_pending_per_user` | the partial unique index enforcing *one live PENDING payment intent per user and purpose* — defence in depth behind the application's claim-then-apply logic |
| `20261016010000_status_created_at_idx` | composite `(status, createdAt)` indexes for the admin/member status-sorted lists |
| `20261018000000_hot_query_indexes` | the hot-query indexes from the Phase 3 data/ops round (`Product(isActive, category)`, `Order(userId, createdAt)`, `AuditLog(createdAt)`) |

Every gate was green throughout. The repository's own changelog claimed those indexes existed; the
repository was right and production was wrong, and nothing could tell the difference. This is the
characteristic failure of a release contract with a gap in it: the parts that are checked stay
honest, and the part that is not silently rots.

## Decision

1. **`/ready` reports schema state.** `apps/api/src/infrastructure/schemaState.ts` reads the applied
   migration chain from `_prisma_migrations` (60 s in-process cache) and `/ready` returns
   `schema: { known, applied, latest }`. A database without the migrations table (db push, a fresh
   SQLite file) reports `known: false` — an honest "unknown", never a fabricated value and never a
   failed readiness probe.
2. **The deploy gate compares it with the repository.** After the deployed API has been shown to
   include the reviewed commit, `deploy-verify.yml` reads `apps/api/prisma/postgres/migrations`'s
   newest entry and polls `/ready` until production reports it — up to the same 10-minute window the
   commit checks use. Still behind after the window: the gate fails, naming the operator command.
3. **The SQLite chain is never the reference.** Production runs the PostgreSQL dialect (ADR-0004), so
   the gate reads the PostgreSQL chain. A migration that exists only in the SQLite chain does not
   exist for production.
4. **The rate-limit store is reported, not asserted.** `/ready` also returns
   `limiterStore: "redis" | "memory"` and the gate prints it. Running without Redis is a documented,
   accepted fail-open (`docs/security.md`) — the fix is visibility, not a new failure mode.
5. **CI provisions PostgreSQL from the same chain.** The `api-postgres` job used `prisma db push`
   against a second schema copy, so nothing in CI proved the chain could be applied and the guarded
   copy was not the shipping one. `provision-postgres.mjs` now applies the production chain (and the
   parity guard covers all three copies), which means a chain that cannot be applied fails a pull
   request rather than production.

## Consequences

- A migration that reaches `main` without being applied to production now fails the deployment gate
  on that push, with the remediation command in the failure message. Deploying code ahead of its
  schema becomes loud instead of silent.
- `/ready` grows two fields. `db: true` (which the gate greps) is unchanged, and the endpoint stays
  unauthenticated and secret-free: a migration *name* is not a credential.
- Any schema readout has to stay cheap: the 60 s cache means a readiness probe storm cannot turn
  into a database query storm.
- Applied migrations are now checked by CI; **rollbacks are still a manual, documented procedure**
  (Neon point-in-time restore, `docs/disaster-recovery.md`). This ADR covers forward drift only.
