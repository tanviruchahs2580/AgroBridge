# Contributing

How this repository is actually operated. Until 2026-10-17 this file described a process that
did not exist — it claimed `main` was protected and prescribed PRs while every commit went
straight to `main`. The rules below are the ones that are enforced (by GitHub, by CI, or by the
review checklist), not aspirations.

## Branching

```
main                       ← protected; every change arrives through a pull request
feature/<scope>-<summary>  ·  fix/…  ·  docs/…  ·  ci/…   ← short-lived branches off main
```

`main` has branch protection: pull requests required, CI + CodeQL required to pass, force pushes
and branch deletion blocked, conversations must be resolved. There is no long-lived `develop`
branch — with one active contributor it adds ceremony without adding safety; add one if and when
parallel feature work exists.

**Break-glass:** the repository owner may temporarily disable protection in the GitHub UI for a
production incident. Doing so requires a note in `CHANGELOG.md` (historical log archived under `docs/archive/2026-10-19/`) recording what was pushed
directly and why, and re-enabling protection afterwards.

## Commits

Conventional Commits, one logical change per commit, imperative subject:

```
feat(settings): account deletion and phone verification
fix(payments): refuse simulated payments in production
docs(play): submission runbook, listing copy, data-safety mapping
ci(deploy): verify production is running the reviewed commit
```

- No `update` / `final` / `misc` subjects.
- A behaviour change states its observable effect and how it was verified in the body —
  reproduction, root cause, fix, test. `1a682e6` is the reference example.
- Avoid snapshot commits ("final state", 100+ files). A change-set that large is more than one
  change.
- **No claim without a command.** Any number in a commit message, changelog or execution log
  (test counts, "green", "verified") must be reproducible by a command a reader can run. If CI
  cannot produce it, commit a receipt (below).

## Pull requests

1. Branch from `main`; open a PR even when working alone — the diff is the review artifact.
2. CI must be green: API lint/typecheck/tests on SQLite **and** PostgreSQL, web lint + i18n check
   + unit tests + typecheck + build, Playwright e2e, Android debug APK, gitleaks, npm audit
   (moderate+ on production deps), Trivy, CodeQL, and the deploy-verification job on `main`.
3. Behaviour changes need tests: journey tests in `apps/api/tests`, e2e in `apps/web/e2e`.
4. Update `CHANGELOG.md` (under `[Unreleased]`) and the affected `docs/` file in the same PR —
   stale docs are treated as a defect, not a follow-up.
5. Never commit `.env`, keystores, `key.properties`, real personal data or release binaries.

## Changing an API response

Response shapes are a contract with the web app, and the contract lives in one place:
`apps/web/src/lib/api-types.ts`. Two rules keep it honest:

1. `apps/api/tests/response-contract.test.ts` records the key structure of every endpoint
   the web consumes in `contracts/api-response-shapes.json`. **It fails when a response
   changes.** The failure names the endpoint and the endpoints' diff — that is a decision
   point, not a chore: a key that disappeared is a breaking change for a client.
2. When you decide to change a response, change all four in one PR: the route, the fixture
   (`WRITE_CONTRACT_FIXTURE=1 npx vitest run tests/response-contract.test.ts` regenerates it
   deliberately), `api-types.ts`, and the consuming feature. Regenerating the fixture to make
   a red build green is the exact drift the guard exists to catch.

The rule that makes this work: **types are read off the API route, never off a feature that
consumes it** — the feature is the thing that drifts.

## Evidence receipts

Numbers CI produces are durable by themselves (run IDs). Numbers produced on a workstation are
recorded as a committed receipt so a later reader does not have to trust prose:

```
qa-evidence/receipts/YYYY-MM-DD-<topic>.md
```

Each receipt states the command, the machine/OS, the headline result and any deviation. The rest
of `qa-evidence/` (screenshots, raw logs, ad-hoc probes) stays gitignored — working material,
not evidence.

## Dependency policy

- **Release-stabilisation window** (from feature freeze to a store submission): no major
  dependency bumps. Patches with a security rationale are allowed with a test run.
- Dependabot PRs are triaged, never left to rot: merge, or close with a written technical reason.
  Action pins are maintained by SHA with the version in a trailing comment, so an action-bump PR
  is usually superseded by the pin commit — close it and say so.
- Major bumps (React, express-rate-limit, bcryptjs, a `@types/node` across a runtime major) are
  migrations, not chores: branch, compatibility test, rollback note.

## Local gates before pushing

```bash
npm run typecheck                                   # api + web
npm run test --workspace apps/api                   # API suite (1 PG-gated skip by design; counts move — trust the run, not this file)
npm run test:unit --workspace apps/web              # web unit suite (same rule)
npm run lint --workspace apps/web
npm run build --workspace apps/web                  # includes typecheck
cd apps/api && npx eslint src tests
```

For UI work also run the e2e suites against a local stack (`docs/testing.md`), including
`apps/web/e2e/visual-contract.spec.ts` — the eight critical pages must render without horizontal
overflow in both themes.

## Running the API suite while a dev server is up

The suite's global setup regenerates the Prisma client **only when the schema is newer than the
generated client** — a client that is already current means there is nothing to generate, so a
running dev server no longer breaks the run. That was a real papercut: on Windows the dev process
holds `query_engine-windows.dll.node`, the unconditional regenerate failed with
`EPERM: operation not permitted, rename …`, and the suite died with an error that never mentioned
the dev server.

If you change `schema.prisma` while a dev server is running, the run will still fail (correctly —
the client must be rebuilt) and now says so: *"prisma generate failed while the schema is newer than
the generated client … stop `npm run dev --workspace apps/api` and run the suite again"*.

## Conventions the gates enforce

Names and layout follow one convention per concern, and the quality jobs check them: API modules
are `modules/<domain>/routes.ts` (a module's routes file is its public entry — importing another
module's internals fails `tests/import-boundaries.test.ts`); web library files are kebab-case under
`src/lib/`, feature folders `src/features/<area>/` with the screen as the PascalCase file; money is
always integer paisa via `shared/utils/money.ts`; phones always pass `normalizeBdPhone` before
storage or comparison; timestamps are UTC in storage with Asia/Dhaka at the boundaries
(`modules/weather/day.ts`, wallet month windows).

Local gates gained the quality jobs in CI, so a clean push runs the same checks: `npm run qa:knip`
(dead code / unused dependencies), `npm run qa:jscpd` (duplication under 3%), `npm run qa:licenses`
(production dependency licences against `license-allowlist.json`), `npm run qa:versioncode`
(monotonic Android versionCode vs the newest `v*` tag), `node scripts/qa/link-check.mjs` and
`node scripts/qa/claims-check.mjs` (docs links and prose claims). Generated reference docs
(`docs/erd.md`, `docs/env-reference.md`, `docs/route-role-matrix.md`) are regenerated by their
`apps/api/scripts/generate-*.mjs` scripts and a freshness test fails when the committed copy drifts
— run the generator and commit the output in the same change.

## Size and complexity exceptions (SLP-03)

`eslint` warns (never errors) above 400 lines per file, 60 lines per function and
cyclomatic complexity 15. The current exceptions are listed here rather than
silenced, because a rule that is quietly off is not a rule:

| Site | Why it is acceptable |
|---|---|
| `apps/api/src/modules/auth/routes.ts`, `farms/routes.ts`, `payments/routes.ts` | Route modules: the export is a sequence of endpoint definitions; splitting them would scatter one security contract (guards + claims) across files. Size is tracked by this table, and any NEW route module over the limit fails review against it. |
| `apps/api/src/modules/payments/webhook.ts` (complexity 2 sites) | Signature/amount/claim verification branches are deliberately explicit, one branch per failure mode with a test each. |
| `apps/api/src/modules/disease/routes.ts` (complexity + function size) | Multipart parsing, magic-byte checks, EXIF stripping and storage in one validated pipeline. |
| `apps/api/src/app.ts` (function size) | The composition root: middleware order + route mounting read as one document; splitting hides ordering bugs. |
| `apps/api/src/middleware/errorHandler.ts`, `shared/utils/jpeg.ts`, `providers/payment/sslcommerz.ts`, `providers/health.ts`, `modules/services/routes.ts`, `modules/aiagent/routes.ts`, `modules/admin/routes.ts`, `modules/auth/dataExport.ts`, `modules/marketplace/routes.ts`, `modules/farms/routes.ts` | Branch-per-provider-error / branch-per-field mapping; each branch is pinned by a test. |
| `apps/web/src/lib/i18n.ts` (779 lines), `components/ui.tsx`, `lib/api-types.ts` | Dictionary and design-system/contract data: content, not logic. |

**The warning budget is ratcheted (AUD-V3):** `scripts/qa/lint-budget.mjs` runs in the
quality-gates CI job against `scripts/qa/lint-warning-budget.json` (currently api 143, web 0 — the counts of CI's `eslint src tests` scope, 2026-10-24 —
the recorded counts behind the table above). A new warning FAILS CI. To land one anyway:
fix it, or raise the budget in the JSON and add the site to this table with a reason — in the
same PR. Warnings going down is always welcome; lower the budget to lock it in.

Removal trigger for any row: when the file drops under the limit, delete the row.
