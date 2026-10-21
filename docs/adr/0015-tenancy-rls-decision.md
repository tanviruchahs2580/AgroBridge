# ADR-0015: Tenant isolation stays application-level; Postgres RLS deferred

- **Status:** accepted (2026-10-19) — re-decide at the trigger points below
- **Deciders:** engineering (single maintainer); adopting RLS is a schema-wide change on a live database
- **Related:** ADR-0002 (hand-rolled data layer), ADR-0004 (dual-dialect Prisma); control inventory in `docs/security.md` §RBAC

## Context

Tenancy in this product has two shapes:

1. **Per-user ownership** — wallets, orders, bookings, notifications, advisory
   history, disease cases, payments, withdrawals are rows owned by one user.
2. **Organizations** — `Organization` + `OrganizationMember` + `Farm.organizationId`;
   CORPORATE/COOPERATIVE roles read and manage farms scoped to
   `OR(ownerId, organizationId ∈ memberships)`.

The control in force is application-level scoping: `requireAuth` re-reads the
user row on every request and attaches `{ userId, role }`; every farmer-facing
query filters by that id (or asserts ownership first, e.g. `assertFarmAccess` in
`modules/farms/routes.ts`); manager/admin queries bound themselves with
`actorRegionLimit`/`assertSubjectInRegion` (`lib/territory.ts`); role grants are
permission-map based (`middleware/rbac.ts`).

The alternative considered is PostgreSQL row-level security (RLS) with policies
keyed on a per-request session variable (`SET LOCAL app.user_id = …`), plus
triggers to stamp tenant columns. RLS would make the database the enforcement
point, so a forgotten `where: { userId }` stops being a data leak.

Evidence that the application control holds today (the negative tests):

- `tests/tenant-isolation.test.ts` — a CORPORATE user cannot list another org's
  farms or fetch its farm details (403/404), and a FARMER cannot create a farm
  under an org they are not a member of.
- `tests/cross-user-negative.test.ts` — wallet balance/ledger, AI history,
  disease-case detail and payment status are all proven to expose only the
  caller's rows, including the 404 shapes that avoid existence oracles.
- `tests/security-matrix.test.ts` — IDOR sweep across order, booking,
  procurement and notification endpoints plus the RBAC matrix
  (elevated roles cannot exceed their grants).
- `tests/rbac-fixes.test.ts`, `tests/farm-event-sync-scoping.test.ts` — the
  scoping regressions found in earlier passes stay fixed.

## Decision

**Keep application-level scoping as the production control. Defer RLS +
triggers until a trigger point below; the deferral is explicit, not an
omission.**

Why now is the right time to defer:

- **Pilot scale, single maintainer.** RLS is valuable in proportion to how many
  people write queries and how many tenants share one database. Today one
  maintainer writes all `modules/**` queries and the database holds one
  operator's pilot data.
- **Dual-dialect test story (ADR-0004).** The default API test suite runs on
  SQLite; RLS is PostgreSQL-only, so an RLS-enforced production would be tested
  against an unenforced engine — the guarantee and the test would stop being the
  same thing. A trustworthy RLS pass must move the scoping tests onto the PG
  profile and keep both dialects' behaviour documented.
- **Session-variable lifecycle.** Policies only work if every query runs inside
  a transaction that sets `app.user_id` first; that means routing all reads
  through a wrapper, and getting pool/`SET LOCAL` semantics right (a leaked
  variable is a cross-tenant read, the exact failure RLS is meant to prevent).
- **Cross-tenant reads are real.** Admin/finance/regional views deliberately
  read outside the caller's rows; policies need a second role (`app.role`,
  `BYPASSRLS` app role or per-policy `OR current_setting('app.role') = 'ADMIN'`),
  which is a design pass of its own, not a config toggle.
- **Migration/rollback cost on a live DB.** Enabling RLS requires backfilling
  tenant columns, `FORCE ROW LEVEL SECURITY`, and a rehearsed disable path;
  the failure mode during rollout is "all rows vanish", which is worse than the
  drift it protects against at current scale.

Prototype plan (when a trigger fires, in this order):

1. **Policy shape.** Owned tables (`Wallet`, `WalletTransaction`, `Order`,
   `Notification`, `Payment`, `Withdrawal`, `AdvisoryQuery`, `DiseaseCase`,
   `RefreshToken`, `Cart`):
   `USING ("userId" = current_setting('app.user_id', true))`.
   Org-scoped tables (`Farm`, `Plot`, `CropCycle`, `FarmEvent`, `Booking`,
   `ProcurementOrder`): `USING ("organizationId" IS NULL AND "ownerId" = …) OR
   EXISTS (SELECT 1 FROM "OrganizationMember" m WHERE m."organizationId" = … AND
   m."userId" = …)`; farm-children join through `Farm`.
2. **Session plumbing.** One `withUserContext(userId, fn)` helper that opens a
   transaction, runs `SET LOCAL app.user_id`, and hands the tx client to the
   handler; every module adopts it before any policy is enabled. Policies start
   `DISABLED` and are enabled table by table.
3. **Verification in the PG suite.** A scratch schema in `vitest.config.pg.ts`
   carrying the policies; the existing negative tests must pass with policies
   ON, plus new direct-SQL tests: wrong session variable reads zero rows, absent
   variable denies, admin context reads cross-tenant. The SQLite profile keeps
   the application-level tests as the cross-dialect baseline.
4. **Rollout.** Enable per table behind a migration; the disable path is
   `ALTER TABLE … DISABLE ROW LEVEL SECURITY`, rehearsed in the
   backup-restore rehearsal script.

## Trigger points (re-decide; do not silently drift)

- A second developer (or contractor) gets write access to `modules/**`, or
- the database becomes multi-tenant in the commercial sense (separate customers
  sharing one DB), or
- an enterprise/procurement customer contract requires database-enforced
  isolation (data-processing agreement, residency audit), or
- a scoping bug reaches production through a missing `where`, whichever comes
  first.

## Consequences

- A missed `where` remains an application bug caught by tests rather than by
  the database; the negative tests above are the compensating control and must
  grow with every new tenant-scoped table.
- No session-variable machinery is added to the hot path yet, so the current
  query shapes and the dual-dialect test story stay intact.
- The prototype plan is written so enabling RLS later is a scheduled project,
  not a re-derivation under pressure.
