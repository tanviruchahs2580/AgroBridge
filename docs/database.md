# Database

> **Owner:** engineering · **Purpose:** schema conventions, migrations and roles · **Last verified:** 2026-10-19 (branch `audit/v2-remediation`; re-verify with the claims/link checks in CI).


## Engine strategy
- **Development/test:** SQLite via `DATABASE_URL="file:./dev.db"` — zero external dependencies,
  reproducible CI. Model definition: `apps/api/prisma/schema.prisma`; migration chain:
  `apps/api/prisma/migrations/`.
- **Production:** PostgreSQL on Neon. Prisma cannot serve two dialects from one schema, so the
  model definition is kept in three copies — `schema.prisma` (SQLite),
  `schema.postgresql.prisma`, and `postgres/schema.prisma` (same models plus `binaryTargets` for
  the Vercel serverless runtime) — with a separate PostgreSQL migration chain in
  `prisma/postgres/migrations/`. The matching client is generated at install time by
  `scripts/generate-prisma.mjs` (root `postinstall`: `VERCEL` env → PostgreSQL, otherwise SQLite);
  `scripts/deploy-migrations.mjs` (`npm run db:migrate:pg`) applies the PG chain idempotently.
  **Any schema change must update every copy and both chains** — `tests/schema-parity.test.ts`
  fails on drift. Full rationale and failure history: `docs/adr/0004-dual-dialect-prisma.md`.
  Schemas use only portable constructs (no native enums, no JSON columns) to keep dialects aligned.
  Connection behaviour in production is whatever the platform-injected `DATABASE_URL` provides: the
  API constructs `new PrismaClient({ log })` with no datasource overrides or pool settings
  (`apps/api/src/infrastructure/database/prisma.ts`), so pooling is a Neon/operator configuration
  rather than a code decision — `docs/runtime-contract.md` records what is and is not known about it.

## Entity map (30 models)
```
User ─┬─ RefreshToken          (sessions, hashed, rotated)
      ├─ FarmerProfile         (membership tier, geography)
      ├─ Farm ── Plot ── CropCycle
      │            └─── FarmEvent        (auditable record; clientUuid idempotency)
      ├─ Cart ─ CartItem ── Product
      ├─ Order ─ OrderItem     (price/name snapshots at purchase time)
      ├─ Booking ── Service ── ServiceProvider
      ├─ ProcurementOrder      (grade/moisture auditable pricing)
      ├─ Payment               (polymorphic purpose ORDER|BOOKING|PROCUREMENT|MEMBERSHIP)
      ├─ Wallet ─ WalletTransaction (ledger with balanceAfter)
      ├─ Notification · AdvisoryQuery · DiseaseCase · AiUsageLog · AuditLog
MembershipPlan                (admin-configurable tiers/benefits)
```
(30 `model` declarations; the map shows the business core — Organizations, `OtpChallenge`,
`Withdrawal` and similar supporting tables are omitted for readability.)

## Integrity rules enforced in schema/logic
- Foreign keys everywhere; cascades only where ownership implies deletion (farm→plots),
  `Restrict` for financial references (orders/payments).
- Unique: phone, email?, SKU, orderNo, bookingNo, poNo, payment refNo, cart(cartId,productId),
  farmEvent.clientUuid (offline sync dedup).
- Money columns are integer paisa. Indexes on all foreign keys and hot filters
  (order status/user, booking status/user, notification user+readAt, audit entity/actor).
  Hot-query indexes added 2026-10-18: `Product(isActive, category)`, `Order(userId, createdAt)`,
  `AuditLog(createdAt)`.

## Migrations SOP
```bash
npx prisma migrate dev --name <change>     # author (SQLite dev chain)
npx prisma migrate deploy                  # apply SQLite chain (dev/test)
npm run db:migrate:pg --workspace apps/api # apply PostgreSQL chain (idempotent, baseline-aware)
```
Never edit applied migrations; never hand-edit production schemas. Remember the PG chain lives in
`prisma/postgres/migrations/` and needs its own migration for every schema change.

## Roles and least privilege (note, 2026-10-19)

- The API and the migration tooling use **one database role**. `DATABASE_URL` is passed straight
  to `new PrismaClient(...)` with no datasource overrides
  (`apps/api/src/infrastructure/database/prisma.ts:6-12`), and the migration chain runs with the
  same URL (`apps/api/scripts/deploy-migrations.mjs:20`); the deploy runbook points the DDL step
  at the unpooled connection (`docs/runbooks/live-deployment.md:66-71`).
- Consequence: because migrations execute with the application's own connection string, that role
  must be able to run DDL — the runtime credentials are schema-owner credentials. No read/write
  split or separate migrator role exists in the repository
  (`apps/api/scripts/provision-postgres.mjs` creates no additional roles; it applies the
  production schema and chain to whatever `DATABASE_URL` points at).
- Operator task before user volume grows: create a restricted runtime role (no DDL; only the
  SELECT/INSERT/UPDATE/DELETE the app uses) after migrations, point the deployment's
  `DATABASE_URL` at it, and keep the owner credentials for `deploy-migrations.mjs` runs only.
  Verify the exact grant set against the tables the app touches, and re-run the smoke checks in
  `docs/runbooks/live-deployment.md` after switching.
