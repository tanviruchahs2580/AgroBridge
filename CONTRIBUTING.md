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
production incident. Doing so requires a note in `EXECUTION_LOG.md` recording what was pushed
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
npm run test --workspace apps/api                   # 150 tests (1 PG-gated skip by design)
npm run test:unit --workspace apps/web              # 108 unit tests
npm run lint --workspace apps/web
npm run build --workspace apps/web                  # includes typecheck
cd apps/api && npx eslint src tests
```

For UI work also run the e2e suites against a local stack (`docs/testing.md`), including
`apps/web/e2e/visual-contract.spec.ts` — the eight critical pages must render without horizontal
overflow in both themes.

## Stop the API before running its test suite (Windows)

`npm run dev --workspace apps/api` holds the Prisma query-engine DLL, and the suite's global setup
regenerates the client: the run fails with `EPERM: operation not permitted, rename …
query_engine-windows.dll.node` while that process lives. Stop the dev server first.
