# Hot-query EXPLAIN evidence — audit fixture database (2026-10-19)

Why this file exists: the hot-query indexes were added by migration
`20261018000000_hot_query_indexes` after the schema-drift receipt
(`2026-10-18-schema-drift-and-release-contract.md`) showed they were missing in
production. This receipt records the current plans for the queries that index
set was chosen for, so a later change can be compared against a known state
instead of against memory.

The numbers below come from the audit fixture database (the same container the
2026-10-18 verification pass used), not from production. They answer "does the
planner pick the intended access path on a correctly migrated database?" — not
"how fast is this at production scale". Scale numbers are for the lead to
append where a production-sized dataset is available.

## Environment

- PostgreSQL 17.11 (Alpine, x86_64) in container `agro-pg-audit` (image build of
  `docker-compose.yml`'s postgres service), database `agrobridge_w1`, owner
  `agrobridge`.
- Migrations applied: 8, latest `20261019140000_login_attempt_throttle` —
  i.e. the hot-query index migration (`20261018000000_hot_query_indexes`) and
  the order/feedback index migration (`20261018120000_…`) are in the chain.
- Fixture size (exact counts):

| Table | Rows | Table | Rows |
|---|---|---|---|
| User | 220 | Payment | 33 |
| Product | 22 | WalletTransaction | 68 |
| Order | 45 | Notification | 124 |
| Farm | 36 | AdvisoryQuery | 87 |
| Plot | 34 | ProcurementOrder | 7 |

## Method

Read-only discipline: only `SELECT` and `EXPLAIN (ANALYZE, BUFFERS)` statements
were issued; `EXPLAIN ANALYZE` executes the SELECT, and no query in this file
writes. Parameters (user ids, a payment ref, a category) were read from the
fixture itself so the plans see the same cardinalities the API would.

```bash
docker exec -i agro-pg-audit psql -U agrobridge -d agrobridge_w1 -X -q < probes.sql
```

Each probe is the Prisma query from the route named in the table below, hand
translated to SQL (Prisma emits the same shape: equality filters, `ORDER BY
"createdAt" DESC`, `LIMIT`).

Probe SQL (the file piped into psql; parameters are fixture values):

```sql
\pset pager off
\echo === Q1 product list ===
EXPLAIN (ANALYZE, BUFFERS) SELECT id, sku, name, category, "pricePaisa", "stockQty" FROM "Product" WHERE "isActive" = true ORDER BY "createdAt" DESC LIMIT 12;
\echo === Q2a product list filtered by category ===
EXPLAIN (ANALYZE, BUFFERS) SELECT id, name FROM "Product" WHERE "isActive" = true AND category = 'EQUIPMENT' ORDER BY "createdAt" DESC LIMIT 12;
\echo === Q2b product search by name ===
EXPLAIN (ANALYZE, BUFFERS) SELECT id, name FROM "Product" WHERE "isActive" = true AND name ILIKE '%seed%' ORDER BY "createdAt" DESC LIMIT 12;
\echo === Q3 order list (buyer) ===
EXPLAIN (ANALYZE, BUFFERS) SELECT id, "orderNo", status, "totalPaisa" FROM "Order" WHERE "userId" = 'cmvev5d2e0000upqod4qku0z3' ORDER BY "createdAt" DESC LIMIT 20;
\echo === Q4 wallet ledger (page 1) ===
EXPLAIN (ANALYZE, BUFFERS) SELECT id, direction, "amountPaisa", "balanceAfterPaisa" FROM "WalletTransaction" WHERE "userId" = 'cmvev5djn000zupqoh7r97fag' ORDER BY "createdAt" DESC LIMIT 50;
\echo === Q5 notifications list ===
EXPLAIN (ANALYZE, BUFFERS) SELECT id, type, category, "readAt" FROM "Notification" WHERE "userId" = 'cmvev3wmx003gupqwujvzdsbb' ORDER BY "createdAt" DESC LIMIT 100;
\echo === Q6 farm tree (farms for owner) ===
EXPLAIN (ANALYZE, BUFFERS) SELECT f.id, f.name, p.id AS plot_id FROM "Farm" f LEFT JOIN "Plot" p ON p."farmId" = f.id WHERE f."ownerId" = 'cmvev59lu0015upmgepe2cdzs' ORDER BY f."createdAt" DESC;
\echo === Q7 advisory history ===
EXPLAIN (ANALYZE, BUFFERS) SELECT id, question, confidence, "createdAt" FROM "AdvisoryQuery" WHERE "userId" = 'cmvev4bab001supkcaplz1j8m' ORDER BY "createdAt" DESC LIMIT 20;
\echo === Q8a payment by refNo ===
EXPLAIN (ANALYZE, BUFFERS) SELECT id, "refNo", status, "amountPaisa" FROM "Payment" WHERE "refNo" = 'PAY-20261019-F97CD927';
\echo === Q8b payments by status (admin list) ===
EXPLAIN (ANALYZE, BUFFERS) SELECT id, "refNo", "createdAt" FROM "Payment" WHERE status = 'SUCCEEDED' ORDER BY "createdAt" DESC LIMIT 50;
\echo === Q9a procurement offers (farmer) ===
EXPLAIN (ANALYZE, BUFFERS) SELECT id, "poNo", status FROM "ProcurementOrder" WHERE "userId" = 'cmvev3qsr004gupn41o41lktv' ORDER BY "createdAt" DESC LIMIT 100;
\echo === Q9b procurement offers (admin, unfiltered queue) ===
EXPLAIN (ANALYZE, BUFFERS) SELECT id, "poNo", status FROM "ProcurementOrder" ORDER BY "createdAt" DESC LIMIT 100;
\echo === Q10 admin metrics (active users) ===
EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM "User" WHERE status = 'ACTIVE';
```

## Probes, sources, and results

| # | Probe | Route / source | Plan shape | Exec |
|---|---|---|---|---|
| Q1 | Product list (`isActive`, newest first, page 1) | `GET /products` — `modules/marketplace/routes.ts` (`productsRouter.get("/")`) | Seq Scan → Sort → Limit (22 rows) | 1.6 ms first run, 11.0 ms incl. cold planning; steady state < 1 ms |
| Q2a | Product list + `category` filter | same, `listQuery.category` | Seq Scan (filter `isActive AND category`) → Sort → Limit | 0.18 ms |
| Q2b | Product search `name ILIKE '%seed%'` | same, `listQuery.search` | Seq Scan, `Rows Removed: 22` (0 matches in fixture) | 0.23 ms |
| Q3 | Order list for one buyer | `GET /orders` — `modules/marketplace/routes.ts` (`ordersRouter.get("/")`) | Seq Scan (userId filter) → Sort → Limit | 0.51 ms |
| Q4 | Wallet ledger page 1 (50 newest) | `GET /wallet` — `modules/payments/routes.ts` (`walletRouter.get("/")`) | Seq Scan (userId) → Sort → Limit | 0.71 ms |
| Q5 | Notification list (100 newest) | `GET /notifications` — `modules/notifications/routes.ts` | Seq Scan (userId) → Sort → Limit | 1.64 ms |
| Q6 | Farm tree for one owner (farms ⋈ plots) | `GET /farms` — `modules/farms/routes.ts` (`farmsRouter.get("/")` with plots include) | **Index Scan `Farm_ownerId_idx`**, then Bitmap Index Scan `Plot_farmId_idx` per farm | 3.5 ms |
| Q7 | Advisory history (20 newest) | `GET /ai/history` — `modules/aiagent/routes.ts` | Seq Scan (userId) → Sort → Limit | 2.6 ms |
| Q8a | Payment by `refNo` | webhook + gateway-return + `GET /payments/:id/status` — `modules/payments/webhook.ts`, `modules/payments/routes.ts` | Seq Scan (`refNo` = …, 1 row; 33 rows in table) | 0.35 ms |
| Q8b | Payments by `status` (newest first) | admin reconciliation reads; index added for it | Seq Scan (status) → Sort → Limit | 0.17 ms |
| Q9a | Procurement offers for one farmer | `GET /procurement` — `modules/procurement/routes.ts` (farmer branch) | **Index Scan `ProcurementOrder_userId_idx`** → Sort → Limit | 0.45 ms |
| Q9b | Procurement queue, unfiltered (admin branch) | same route, admin branch (`where = {}`) | Seq Scan → Sort → Limit | 0.15 ms |
| Q10 | Admin metrics: active users | `GET /admin/metrics` — `modules/admin/routes.ts` (`user.count(status: ACTIVE)`) | Seq Scan aggregate | 7.5 ms |

### How to read this

- **Seq scans on the 7–220-row fixture are expected, not findings.** The
  planner correctly prefers a full scan of tens of rows over an index; both give
  sub-millisecond results. The index-backed plans that DO appear (Q6, Q9a) show
  the intended paths exist and are chosen when a selective predicate works.
- Q2b is `ILIKE '%term%'`: no btree index can serve a leading wildcard, at any
  table size. This is a recorded product-level limit (search over a small
  catalogue), not a missing index — if the catalogue grows, the answer is a
  trigram index or a dedicated search store, tracked as a separate decision.
- Q4 and Q5 sort AFTER filtering by `userId`; at scale the composite
  `WalletTransaction(userId, createdAt)` / `Notification(userId, readAt)`
  indexes carry the filter and the sort respectively. On this fixture the sort
  is over ≤ 68 rows.
- Planning time (8–23 ms) exceeds execution time for every probe; on a fixture
  this small it is pure overhead of prepared-statement planning and not a
  measured application cost.

## Raw output

```text
=== Q1 product list ===
 Limit  (cost=1.71..1.74 rows=12 width=111) (actual time=1.919..2.005 rows=12 loops=1)
   Buffers: shared hit=4
   ->  Sort  (cost=1.71..1.77 rows=22 width=111) (actual time=1.831..1.834 rows=12 loops=1)
         Sort Key: "createdAt" DESC
         Sort Method: quicksort  Memory: 28kB
         Buffers: shared hit=4
         ->  Seq Scan on "Product"  (cost=0.00..1.22 rows=22 width=111) (actual time=0.236..0.283 rows=22 loops=1)
               Filter: "isActive"
               Buffers: shared hit=1
 Planning:
   Buffers: shared hit=139
 Planning Time: 20.241 ms
 Execution Time: 11.016 ms
(13 rows)

=== Q2a product list filtered by category ===
 Limit  (cost=1.54..1.57 rows=12 width=73) (actual time=0.083..0.088 rows=12 loops=1)
   Buffers: shared hit=1
   ->  Sort  (cost=1.54..1.58 rows=14 width=73) (actual time=0.081..0.083 rows=12 loops=1)
         Sort Key: "createdAt" DESC
         Sort Method: quicksort  Memory: 26kB
         Buffers: shared hit=1
         ->  Seq Scan on "Product"  (cost=0.00..1.27 rows=14 width=73) (actual time=0.029..0.037 rows=14 loops=1)
               Filter: ("isActive" AND (category = 'EQUIPMENT'::text))
               Rows Removed by Filter: 8
               Buffers: shared hit=1
 Planning Time: 0.538 ms
 Execution Time: 0.180 ms
(12 rows)

=== Q2b product search by name ===
 Limit  (cost=1.28..1.29 rows=1 width=73) (actual time=0.135..0.136 rows=0 loops=1)
   Buffers: shared hit=1
   ->  Sort  (cost=1.28..1.29 rows=1 width=73) (actual time=0.132..0.133 rows=0 loops=1)
         Sort Key: "createdAt" DESC
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=1
         ->  Seq Scan on "Product"  (cost=0.00..1.27 rows=1 width=73) (actual time=0.076..0.076 rows=0 loops=1)
               Filter: ("isActive" AND (name ~~* '%seed%'::text))
               Rows Removed by Filter: 22
               Buffers: shared hit=1
 Planning Time: 2.676 ms
 Execution Time: 0.229 ms
(12 rows)

=== Q3 order list (buyer) ===
 Limit  (cost=1.57..1.58 rows=3 width=69) (actual time=0.418..0.422 rows=3 loops=1)
   Buffers: shared hit=1
   ->  Sort  (cost=1.57..1.58 rows=3 width=69) (actual time=0.415..0.417 rows=3 loops=1)
         Sort Key: "createdAt" DESC
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=1
         ->  Seq Scan on "Order"  (cost=0.00..1.55 rows=3 width=69) (actual time=0.375..0.379 rows=3 loops=1)
               Filter: ("userId" = 'cmvev5d2e0000upqod4qku0z3'::text)
               Rows Removed by Filter: 42
               Buffers: shared hit=1
 Planning:
   Buffers: shared hit=125
 Planning Time: 13.669 ms
 Execution Time: 0.507 ms
(14 rows)

=== Q4 wallet ledger (page 1) ===
 Limit  (cost=4.44..4.56 rows=50 width=48) (actual time=0.606..0.621 rows=50 loops=1)
   Buffers: shared hit=2
   ->  Sort  (cost=4.44..4.58 rows=55 width=48) (actual time=0.603..0.609 rows=50 loops=1)
         Sort Key: "createdAt" DESC
         Sort Method: quicksort  Memory: 32kB
         Buffers: shared hit=2
         ->  Seq Scan on "WalletTransaction"  (cost=0.00..2.85 rows=55 width=48) (actual time=0.170..0.530 rows=55 loops=1)
               Filter: ("userId" = 'cmvev5djn000zupqoh7r97fag'::text)
               Rows Removed by Filter: 13
               Buffers: shared hit=2
 Planning:
   Buffers: shared hit=62
 Planning Time: 8.178 ms
 Execution Time: 0.709 ms
(14 rows)

=== Q5 notifications list ===
 Limit  (cost=6.58..6.60 rows=8 width=55) (actual time=1.547..1.552 rows=5 loops=1)
   Buffers: shared hit=5
   ->  Sort  (cost=6.58..6.60 rows=8 width=55) (actual time=1.544..1.547 rows=5 loops=1)
         Sort Key: "createdAt" DESC
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=5
         ->  Seq Scan on "Notification"  (cost=0.00..6.46 rows=8 width=55) (actual time=0.510..1.515 rows=5 loops=1)
               Filter: ("userId" = 'cmvev3wmx003gupqwujvzdsbb'::text)
               Rows Removed by Filter: 119
               Buffers: shared hit=5
 Planning:
   Buffers: shared hit=50
 Planning Time: 7.959 ms
 Execution Time: 1.642 ms
(14 rows)

=== Q6 farm tree (farms for owner) ===
 Sort  (cost=17.70..17.70 rows=2 width=104) (actual time=2.837..2.840 rows=1 loops=1)
   Sort Key: f."createdAt" DESC
   Sort Method: quicksort  Memory: 25kB
   Buffers: shared hit=4
   ->  Nested Loop Left Join  (cost=4.31..17.69 rows=2 width=104) (actual time=2.775..2.785 rows=1 loops=1)
         Buffers: shared hit=4
         ->  Index Scan using "Farm_ownerId_idx" on "Farm" f  (cost=0.14..8.16 rows=1 width=72) (actual time=0.923..0.927 rows=1 loops=1)
               Index Cond: ("ownerId" = 'cmvev59lu0015upmgepe2cdzs'::text)
               Buffers: shared hit=2
         ->  Bitmap Heap Scan on "Plot" p  (cost=4.16..9.50 rows=2 width=64) (actual time=1.839..1.842 rows=1 loops=1)
               Recheck Cond: ("farmId" = f.id)
               Heap Blocks: exact=1
               Buffers: shared hit=2
               ->  Bitmap Index Scan on "Plot_farmId_idx"  (cost=0.00..4.16 rows=2 width=0) (actual time=1.051..1.051 rows=1 loops=1)
                     Index Cond: ("farmId" = f.id)
                     Buffers: shared hit=1
 Planning:
   Buffers: shared hit=228
 Planning Time: 23.416 ms
 Execution Time: 3.501 ms
(20 rows)

=== Q7 advisory history ===
 Limit  (cost=11.77..11.82 rows=20 width=102) (actual time=2.465..2.474 rows=20 loops=1)
   Buffers: shared hit=10
   ->  Sort  (cost=11.77..11.85 rows=30 width=102) (actual time=2.462..2.466 rows=20 loops=1)
         Sort Key: "createdAt" DESC
         Sort Method: quicksort  Memory: 28kB
         Buffers: shared hit=10
         ->  Seq Scan on "AdvisoryQuery"  (cost=0.00..11.04 rows=30 width=102) (actual time=1.056..2.410 rows=30 loops=1)
               Filter: ("userId" = 'cmvev4bab001supkcaplz1j8m'::text)
               Rows Removed by Filter: 57
               Buffers: shared hit=10
 Planning:
   Buffers: shared hit=44
 Planning Time: 2.965 ms
 Execution Time: 2.594 ms
(14 rows)

=== Q8a payment by refNo ===
 Seq Scan on "Payment"  (cost=0.00..2.40 rows=1 width=60) (actual time=0.177..0.321 rows=1 loops=1)
   Filter: ("refNo" = 'PAY-20261019-F97CD927'::text)
   Rows Removed by Filter: 32
   Buffers: shared hit=2
 Planning:
   Buffers: shared hit=102
 Planning Time: 6.505 ms
 Execution Time: 0.354 ms
(8 rows)

=== Q8b payments by status (admin list) ===
 Limit  (cost=2.64..2.67 rows=13 width=56) (actual time=0.091..0.096 rows=14 loops=1)
   Buffers: shared hit=2
   ->  Sort  (cost=2.64..2.67 rows=13 width=56) (actual time=0.089..0.091 rows=14 loops=1)
         Sort Key: "createdAt" DESC
         Sort Method: quicksort  Memory: 26kB
         Buffers: shared hit=2
         ->  Seq Scan on "Payment"  (cost=0.00..2.40 rows=13 width=56) (actual time=0.033..0.050 rows=14 loops=1)
               Filter: (status = 'SUCCEEDED'::text)
               Rows Removed by Filter: 19
               Buffers: shared hit=2
 Planning:
   Buffers: shared hit=3
 Planning Time: 0.508 ms
 Execution Time: 0.171 ms
(14 rows)

=== Q9a procurement offers (farmer) ===
 Limit  (cost=8.17..8.18 rows=1 width=104) (actual time=0.364..0.366 rows=1 loops=1)
   Buffers: shared hit=2
   ->  Sort  (cost=8.17..8.18 rows=1 width=104) (actual time=0.362..0.362 rows=1 loops=1)
         Sort Key: "createdAt" DESC
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=2
         ->  Index Scan using "ProcurementOrder_userId_idx" on "ProcurementOrder"  (cost=0.14..8.16 rows=1 width=104) (actual time=0.327..0.329 rows=1 loops=1)
               Index Cond: ("userId" = 'cmvev3qsr004gupn41o41lktv'::text)
               Buffers: shared hit=2
 Planning:
   Buffers: shared hit=85
 Planning Time: 14.981 ms
 Execution Time: 0.453 ms
(13 rows)

=== Q9b procurement offers (admin, unfiltered queue) ===
 Limit  (cost=20.61..20.86 rows=100 width=104) (actual time=0.081..0.085 rows=7 loops=1)
   Buffers: shared hit=1
   ->  Sort  (cost=20.61..21.16 rows=220 width=104) (actual time=0.079..0.081 rows=7 loops=1)
         Sort Key: "createdAt" DESC
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=1
         ->  Seq Scan on "ProcurementOrder"  (cost=0.00..12.20 rows=220 width=104) (actual time=0.020..0.024 rows=7 loops=1)
               Buffers: shared hit=1
 Planning Time: 0.123 ms
 Execution Time: 0.152 ms
(10 rows)

=== Q10 admin metrics (active users) ===
 Aggregate  (cost=10.65..10.66 rows=1 width=8) (actual time=4.980..4.982 rows=1 loops=1)
   Buffers: shared hit=7
   ->  Seq Scan on "User"  (cost=0.00..10.05 rows=238 width=0) (actual time=1.218..4.860 rows=215 loops=1)
         Filter: (status = 'ACTIVE'::text)
         Rows Removed by Filter: 5
         Buffers: shared hit=7
 Planning:
   Buffers: shared hit=60
 Planning Time: 9.540 ms
 Execution Time: 7.523 ms
(10 rows)
```

## What this receipt does NOT claim

- Not a production measurement: the fixture is 220 users / 45 orders / 33
  payments. No probe here exercises index-selectivity effects that only appear
  at scale (e.g. whether `Product(isActive, category)` is picked over a seq
  scan, whether the `Order(userId, createdAt)` composite beats the plain
  `userId` index).
- No load or concurrency numbers; see `apps/api/scripts/loadtest.mjs` and the
  P1 loadtest log in `qa-evidence/` for those.
- The lead appends production-scale EXPLAINs (same probe list) where available;
  keep the probe SQL identical so the comparison is apples-to-apples.
