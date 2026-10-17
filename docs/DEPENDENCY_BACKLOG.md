# Dependency backlog — deferred bumps and their triggers

Nine Dependabot pull requests were open since 2026-08-26 (nine weeks) and triaged on 2026-10-17.
Three were **superseded**; six were **deliberately deferred** and are listed here with the
condition that has to hold before they land. This file exists so a deferred bump is a recorded
engineering decision, not a forgotten notification — and so the next person does not have to
reconstruct the reasoning from closed PR comments.

Policy that produced these decisions: `CONTRIBUTING.md` §Dependency policy (no major bumps during
the release-stabilisation window; a major is a migration, not a chore).

## Superseded (closed, nothing to do)

| PR | Bump | Why it can never converge |
|---|---|---|
| #6 | `actions/checkout` 4 → 7 | Actions are pinned by full commit SHA with the version in a trailing comment; Dependabot compares tag refs, so the PR can never be satisfied. The pin already carries v7.0.1. |
| #4 | `actions/setup-node` 4 → 7 | Same; pin carries v7.0.0. |
| #3 | `actions/upload-artifact` 4 → 7 | Same; pin carries v7.0.1. |

## Deferred (with the trigger that unblocks each)

| # | Package | From → to | Trigger / required work |
|---|---|---|---|
| 7 | `docker/metadata-action` | 5 → 6 | Bump together with the **first real staging deployment**. The action is used only by `deploy-staging.yml`, a scaffold that has never executed; changing an action inside a workflow with no green run to point at is unverifiable. |
| 12 | `@types/node` | 22 → 26 | **Coordinated Node runtime upgrade** (`engines`, CI `node-version`, Vercel runtime) in one change. Types must describe the runtime; Node 26 types on a Node 22/24 runtime declare APIs that do not exist. |
| 11 | `react` + `@types/react` | 18 → 19 | Its own branch, with the full Playwright suite as the compatibility gate. React 19 touches framer-motion, `react-dom` entry points and the modal/focus code. |
| 10 | `autocannon` | 7 → 8 | Bump when the **load test is next executed** and `apps/api/scripts/loadtest.mjs` is updated for the v8 API (dev-only tool; an unverified bump is still an unverified change). |
| 9 | `express-rate-limit` | 7 → 8 | Migration branch + the concurrency and security-matrix suites green. v8 changes custom-store and `keyGenerator` handling — the API's financial, checkout and login limiters all use both. |
| 8 | `bcryptjs` (+`@types`) | 2 → 3 | Migration branch that proves **existing password hashes still verify** (hash-compatibility test) and that the auth suite passes. Security-critical: a silent change here locks every user out. |

## How to work this list

1. One item per branch, one PR each — never a combined dependency sweep.
2. The PR body states which trigger condition is satisfied and what was run to verify it.
3. After a successful landing, delete the row here in the same PR.

## Standing checks

- `npm audit --omit=dev --audit-level=moderate` is a **blocking** CI gate, so a vulnerable
  production dependency cannot merge regardless of this list.
- Action pins are refreshed deliberately (read the release notes, resolve the SHA, keep the version
  comment) — not by merging Dependabot's tag-based PRs.
