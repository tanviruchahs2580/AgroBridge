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
npm run test --workspace apps/api                   # API suite (counts move every round — see docs/testing.md)
npm run test:unit --workspace apps/web              # web unit tests (ibid.)
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
