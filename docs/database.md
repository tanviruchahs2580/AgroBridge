<!-- owner: @tanviruchahs2580 · purpose: data model, roles and schema-chain expectations · last-verified: 2026-10-21 @ 6550a9a -->

# Database

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
