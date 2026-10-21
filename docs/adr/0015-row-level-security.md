# ADR-0015: Row-Level Security — deferred; app-level tenancy is the enforced layer

Status: Accepted (RLS prototype deferred) · Date: 2026-10-21

## Context

The V2 audit raised (ARC-12) that farmer data isolation currently lives entirely
in application code: every farmer-facing query scopes by `userId`/organization
(`cross-user-negative`, `tenant-isolation` suites), but the database would still
serve a cross-tenant row if a query forgot its scope, and the app connects with
a role that can read everything.

## Decision

1. **App-level scoping remains the enforced isolation layer** for this release:
   without RLS the behaviour is identical on both dialects (SQLite dev/test,
   PostgreSQL prod) and every negative test runs against the real query paths.
2. **RLS is planned, not mythical**: the PostgreSQL migration chain gains a
   `tenant isolation` migration enabling RLS with `current_setting('app.user_id')`
   policies on farmer-owned tables, and the API sets that GUC per transaction.
   The prototype task is tracked; it MUST ship with negative tests that prove
   the database itself rejects cross-tenant reads when the GUC is absent.
3. **The app-vs-migration DB role split** (app role cannot DDL) ships first — it
   is the cheaper half of defence-in-depth and is documented in
   docs/operations.md.
4. Until RLS lands, the invariant is: **every** farmer-facing Prisma query
   carries an explicit ownership predicate; the generated route matrix plus the
   cross-user suites are the guard.

## Consequences

- RLS must not be "enabled" opportunistically: with the app role as table
  owner, RLS policies silently do nothing — the runbook records the
  role-reassignment step that makes them real.
- Cryptographic/hashing discipline stays unchanged; RLS is defence-in-depth for
  lost-scope bugs, not a replacement for query scoping.
