# Database

## Engine strategy
- **Development/test:** SQLite via `DATABASE_URL="file:./dev.db"` — zero external dependencies,
  reproducible CI.
- **Production:** PostgreSQL. Change the provider in `apps/api/prisma/schema.prisma`
  (`sqlite` → `postgresql`), point `DATABASE_URL` at Postgres, run `prisma migrate deploy`.
  Schema uses only portable constructs (no native enums, no JSON columns) to make this switch safe.

## Entity map (25 tables)
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

## Integrity rules enforced in schema/logic
- Foreign keys everywhere; cascades only where ownership implies deletion (farm→plots),
  `Restrict` for financial references (orders/payments).
- Unique: phone, email?, SKU, orderNo, bookingNo, poNo, payment refNo, cart(cartId,productId),
  farmEvent.clientUuid (offline sync dedup).
- Money columns are integer paisa. Indexes on all foreign keys and hot filters
  (order status/user, booking status/user, notification user+readAt, audit entity/actor).

## Migrations SOP
```bash
npx prisma migrate dev --name <change>   # author (dev)
npx prisma migrate deploy                # apply (staging/prod) — tested first on clean DB
```
Never edit applied migrations; never hand-edit production schemas.
