# AgroBridge — project instructions

Read `~/.zcode/AGENTS.md` first. It carries the portfolio-wide rules (evidence discipline, approval
boundaries, secret handling, migration safety, ratchets, project isolation). This file adds only what is
true **for AgroBridge**; where the two conflict, this file wins inside this repository.

`CONTRIBUTING.md` is the human-facing authority for branching, review and release policy. Where this file
summarises it, `CONTRIBUTING.md` is the source of truth.

---

## 1. What this is

An agricultural marketplace and advisory platform for Bangladeshi farmers, in Bangla, shipped as a web app,
a PWA, and a Capacitor Android app. npm workspaces monorepo, two workspaces.

| Layer | Path | Stack |
|---|---|---|
| API | `apps/api` | Express 4, TypeScript (NodeNext), Zod, Prisma 6, JWT + rotating refresh tokens |
| Web | `apps/web` | React 18, Vite 6, react-router-dom 7, Tailwind 3, framer-motion, Capacitor 8 |

Production runs on Vercel (PostgreSQL). Local development and tests use SQLite.

## 2. Runtime — pin it, do not inherit it

- **Node 22** (`.nvmrc` = `22`, `engines.node` = `>=22`). Package manager: **npm** (`package-lock.json`).
- This machine's ambient Node is **v24**, which satisfies `>=22` **but this project has only been built and
  tested on 22.** Before running anything, honour the project pin. If you ran on 24, say so in your receipt
  — the result is not transferable.
- Other projects on this machine pin different runtimes. Never assume.
- **Postgres 17** in CI and production; **SQLite** locally. A behaviour that depends on the engine differs.

## 3. Ports and process isolation

- API: **`PORT=4000`**. Web dev server: **`5173`** (`strictPort: true`, so a conflict fails loudly), preview:
  **`4173`** — all pinned in `apps/web/vite.config.ts`.
- **`5173` is also Bangla GPT's dev port.** The two projects' dev servers must not run at the same time.
  AgroBridge fails loudly rather than drifting. Run one at a time, or override explicitly:
  `npm run dev --workspace apps/web -- --port 5373` (then `WEB_ORIGIN` must match, or the API rejects the origin).
- Compose project name is **pinned to `agrobridgeapp`** in both compose files — exactly the value Compose
  previously derived from the directory name. Keep the pin; renaming it renames the containers and the
  `pgdata`/`grafanadata` volumes, which orphans the local database.
- The sibling project's compose name is `bangla-gpt-app` — distinct, so container stacks do not collide.

## 4. Architecture boundaries — enforced, not advisory

- **API modules are `apps/api/src/modules/<domain>/routes.ts`.** Cross-module internal imports are
  forbidden and fail `tests/import-boundaries.test.ts`. Share through `src/lib/` or `src/shared/`, not by
  reaching into another module's internals.
- Current modules (`apps/api/src/modules/`, 15 directories): `auth`, `farms`, `weather`, `aiagent`,
  `disease`, `marketplace` (products/cart/orders), `services` (services/bookings), `procurement`,
  `payments` (+ wallet and webhook routes in the same module), `membership` (service only — no
  `routes.ts`), `notifications`, `admin`, `organizations`, `analytics`, `ops` (`ops/routes.ts` carries
  the retention trigger — a data-deletion surface).
- Middleware lives in `apps/api/src/middleware/` — use the existing ones (`auth`, `rbac`, `validate`,
  `idempotency`, `audit`, `context`, `errorHandler`, `admission`, `rateLimit*`). Do not hand-roll.
- Web: library files are kebab-case under `apps/web/src/lib/`. There is **no state-management or
  data-fetching library** — the pattern is React context + custom hooks (`lib/session.tsx`,
  `lib/useResource.ts`, `lib/offlineQueue.ts`). Do not introduce Redux, Zustand, or React Query.
- TypeScript `strict: true` in both workspaces. `noUncheckedIndexedAccess` is **not** enabled — do not
  "helpfully" turn it on; it would break unchecked code.

## 5. Domain rules that are easy to get wrong

**Money is always integer paisa.** Never floating point, never rupees. Use the existing helpers
(`shared/utils/money.ts`, `lib/money.ts`).

**Time is stored and transmitted UTC.** Convert to `Asia/Dhaka` only at the domain/display boundary.

**Phone numbers** go through `normalizeBdPhone`. Never store or compare raw input.

**RBAC — 13 roles.** `SUPER_ADMIN, ADMIN, REGIONAL_MANAGER, AREA_MANAGER, PROCUREMENT_MANAGER,
WAREHOUSE_MANAGER, COLLECTION_MANAGER, FIELD_AGENT, SERVICE_PROVIDER, DEALER, CORPORATE, COOPERATIVE,
FARMER`. The table is `apps/api/src/middleware/rbac.ts`.

- The client's claimed role is **never** trusted. `requireAuth` re-reads **status and role from the
  database on every authenticated request** so revocation is immediate. Preserve that.
- `requirePermission("<perm>")` is the only gate. Never invent a permission string; read the table.
- `contracts/roles.json` and `docs/route-role-matrix.md` are the authority, drift-gated by
  `tests/route-role-matrix.test.ts`. A role or permission change updates all three plus the tests.
- Respect separation-of-duties (`lib/separationOfDuties.ts`) and territory scoping (`lib/territory.ts`). A
  new endpoint without `requirePermission` **and** ownership/territory scoping is a privilege bug.

**AI advisory must never overstate itself.**
- Retrieval is keyword-based and deterministic (`kb-retrieval-v1`, `apps/api/src/providers/ai/knowledge.ts`).
- **Every KB entry currently has `status: "UNSOURCED"`.** Do not change an entry to `REVIEWED` without a
  real `sourceName`, `sourceUrl`, and `reviewedAt`.
- `AiAnswer` carries `confidence`, `lowConfidenceFlag`, `groundedRefs`, `groundedSources`, `kbVersion`.
  Preserve all of them.
- Retrieved KB text is injected as **delimited, untrusted reference data** — keep the delimiting and the
  injection-hardened system prompt.
- The monthly budget guard (`AI_MONTHLY_BUDGET_PAISA` → `429 AI_BUDGET_EXCEEDED`) must not be bypassed.
- **Disease photos are `PENDING_REVIEW` until an agronomist acts.** The code states this is "**NEVER**
  presented as a confirmed AI diagnosis." Do not introduce an automated diagnosis claim.

**Payments.** SSLCommerz in production (signature-verified webhook, constant-time comparison), sandbox
otherwise. Checkout is idempotent — use the existing idempotency middleware. Refunds and withdrawals are
permission-gated and separation-of-duties enforced.

## 6. Database — two schema variants

`scripts/generate-prisma.mjs` selects by environment: **SQLite** locally (`prisma/schema.prisma`),
**PostgreSQL** when `VERCEL` is set (`prisma/postgres/schema.prisma`, with `prisma/schema.postgresql.prisma`
also present). The chains are separate: `prisma/migrations/` and `prisma/postgres/migrations/`.

- **Any schema change must be mirrored across the variants and both chains**, and must keep
  `api-migration-drift` green.
- There are **no native enums** — enum-like values are strings, with allowed values documented in comments.
  Do not introduce a native enum without checking SQLite support.
- Never commit `.db` files; they are gitignored and several hold real data.

## 7. Generated and serialized artifacts — one writer each

Regenerate in the same change; never hand-edit. These are the collision points.

| Artifact | Generated by | Owner |
|---|---|---|
| `contracts/api-response-shapes.json` | `tests/response-contract.test.ts` with `WRITE_CONTRACT_FIXTURE=1` | Backend Engineer |
| `docs/route-role-matrix.md` | route + `contracts/roles.json` | Backend Engineer (Security Reviewer authors the policy) |
| `docs/erd.md`, `docs/env-reference.md`, `docs/generated/**` | schema / env schema | Database Engineer / Backend Engineer |
| `CHANGELOG.md` | hand-written at release time — the release record, not a per-PR diary (see `CONTRIBUTING.md` for the policy to align) | **Principal Architect only** |
| `version.json`, `package.json` versions, `scripts/qa/lint-warning-budget.json`, `package-lock.json` | release process | **DevOps Engineer only** |

`contracts/api-response-shapes.json` is consumed by `apps/web/src/lib/api-types.ts`. A route change lands
the route, the fixture, the shared types, and every consumer **in one PR** — see
`~/.zcode/skills/api-contract-change`.

## 8. Do not "fix" these deliberate decisions

- **The service worker is a kill switch.** `apps/web/public/sw.js` unregisters all registrations and clears
  caches; `vite.config.ts` deliberately does **not** add `VitePWA` to `plugins`, and `main.tsx` registers
  nothing. `vite-plugin-pwa` is still a devDependency. Offline writes queue in `lib/offlineQueue.ts`.
  **Enabling VitePWA would contradict a documented decision — raise it as a question instead.**
- **No Sentry on the web**, only `console.error` in `ErrorBoundary` — a known, documented gap, not an
  oversight.
- `.gitleaksignore` entries are commit-pinned, triaged false positives recorded in `SECURITY_WAIVERS.md`.
  Do not broaden them.
- `CODEOWNERS` comments state the `main` protection ruleset runs with
  `required_approving_review_count: 0` — `CONTRIBUTING.md` and `CODEOWNERS` disagree here. Do not assume
  review is enforced; if it matters, ask.

## 9. Gates — exact commands

Before pushing (from `CONTRIBUTING.md`):

```bash
npm run typecheck
npm run test --workspace apps/api
npm run test:unit --workspace apps/web
npm run lint --workspace apps/web
npm run build --workspace apps/web
cd apps/api && npx eslint src tests
```

Plus the structural gates: `npm run qa:knip`, `npm run qa:jscpd`, `npm run qa:versioncode`,
`node scripts/qa/lint-budget.mjs`, `node scripts/drift-check.mjs`, `node scripts/todo-gate.mjs`,
`node scripts/check-versions.mjs`, `node scripts/qa/link-check.mjs`, `node scripts/qa/claims-check.mjs`.

**Two licence gates, two allow-lists — one is CI, one is not.** `node scripts/licence-gate.mjs` reads
`scripts/licence-allowlist.json` and **is** a CI step (the `quality-gates` job). `npm run qa:licenses`
reads repo-root `license-allowlist.json` and is **not** wired into CI — a local check with a slightly
different package scope. Raise either allow-list if a dependency genuinely warrants it; never lower one
to make a change pass.

CI runs the above plus: API suite on **both SQLite and PostgreSQL**, the migration-drift job
(`api-migration-drift`), web e2e (Playwright), Android debug APK, gitleaks, `npm audit` (moderate+ on
production deps), Trivy, CodeQL, the IaC config scan, commitlint, Lighthouse CI (a11y ≥ 0.9; LCP 5 s,
TBT 500 ms, CLS 0.1), ZAP baseline DAST, compose smoke, and the deploy-verification job. Generated-doc
freshness is two gates: `node apps/api/scripts/route-matrix.mjs --check` and
`node apps/api/scripts/gen-erd.mjs --check` run in the `quality-gates` job, and
`apps/api/tests/generated-docs-freshness.test.ts` byte-compares `docs/erd.md` and
`docs/env-reference.md`.

**Not every CI job is a required status check.** The `main` ruleset (25297401) requires 11 contexts;
the migration-drift job, the whole `quality-gates` job, compose smoke, the IaC scan and ZAP are not
among them, so they can be merged red. Treat them as required by convention — §6's "must keep
`api-migration-drift` green" is a process rule, not (yet) platform enforcement.

**Ratchets — raise only, never lower:** API coverage `statements 82 / branches 72 / functions 84 /
lines 84` (`apps/api/vitest.config.ts`); `scripts/qa/lint-warning-budget.json` (api 143, web 0 — a new
warning **fails CI** in `quality-gates`); jscpd 3% (`npx jscpd --silent --threshold 3 apps/api/src
apps/web/src` is the CI scope; `.jscpd.json` mirrors it for `npm run qa:jscpd`); the two licence
allow-lists above.

There is **no `.pre-commit-config.yaml`** and **no semgrep** in this project as of this audit.

## 10. Android

Capacitor 8, `appId com.agrobridge.app`, native project committed at `apps/web/android/`.
`versionCode` comes from root `version.json` (currently `1.4.1` / `14001`) and is gated by `qa:versioncode`
and a CI preflight.

**Builds are CI-only.** This machine has **no `java`, no `gradle`, and no `adb`** — you cannot build or
install an APK locally. Workflows: `android-debug-apk.yml`, `android-release.yml`, `play-upload.yml`.
Signing secrets (`ANDROID_KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`) and
`PLAY_SERVICE_ACCOUNT_JSON` live only in CI. Never commit `*.keystore`, `*.jks`, `key.properties`, or
`google-services.json`.

## 11. Approval boundaries specific to this project

Ask before: pushing to `main`; running `deploy-staging.yml`, `deploy-verify.yml`, or any deploy/release
workflow; touching Vercel project settings; rotating or sharing any signing secret; running a migration
against any non-disposable database; `git filter-repo` or force-push; changing a dependency without an
explicit request (this project has a release-stabilisation window and Dependabot policy in
`CONTRIBUTING.md`); enabling the service worker; raising a payment/withdrawal limit.

## 12. Observability

Structured logs, metrics and traces ship with any new critical path. Log fields must be stable and
queryable — a one-off free-text message is not instrumentation.

- **Never log PII, credentials, tokens, or full request bodies.** Structured logging is not a licence to
  log whole payloads.
- Never let a farmer, enterprise or order identifier surface in a log line, metric label or error message
  that another account can read. The scoping rules in §5 apply to telemetry too, not only to API responses.
- Alerting on the money path and on authorisation failures is expected.
- Some sinks do not exist yet — see §14. Write the signals anyway; a missing sink is not a reason to skip
  the instrumentation.

## 13. MCP and inference — least privilege

Every MCP integration is scoped to the narrowest capability that works. Prefer read-only; **never** grant
unrestricted database or filesystem access for convenience. No new MCP server, credential or broad
permission grant without explicit approval (§11).

Prefer secure local/private inference where it is suitable. When a hosted model is used, send the minimum
necessary data and never a tenant-identifying payload — assembling AI context is subject to the isolation
and untrusted-reference rules in §5.

## 14. Known gaps (do not treat as working)

- **No rollback runbook or rehearsal.** Immutable `sha-<commit>` image tags exist, but the reverse path has
  never been exercised.
- **No crash-reporting sink**; the uptime probe has "no paging sink yet".
- **Staging is a scaffold** — `deploy-staging.yml` needs `STAGING_HOST`, `STAGING_USER`, `STAGING_SSH_KEY`,
  and has never run.
- **No semgrep, no pre-commit hooks** (Bangla GPT has both).
- **No `psql`/`sqlite3` client on this machine** — DB inspection needs `docker exec`.
