# Typography rebuild (WS1) + backend hardening (WS2) — evidence receipt

- Date: 2026-11-13
- Commit: **working tree, uncommitted** (preview mode — no commit/push per standing SOP)
- Machine / OS: Windows 10.0.26300, **Node v24.19.0**, Python 3.12 + Playwright 1.x (Chromium headless shell 158)
- Scope: WS1 Bangla-first typography system (tokens/tailwind/index.css/component sweep/formatNumber/docs) and WS2 conservative backend fixes (server idle-connection drain, PG coverage-threshold mirror, ORG_LIST_CAPS, validate({query}) conversions on 3 routes, scratch cleanup, ADR-0022). Does **not** cover: payments/routes.ts split, Express 5, OTel, the deferred P3 security items — all recorded as owner decisions.

## Result

Both workstreams implemented per the approved plan, all declared gates re-run green, browser QA performed on the real dev servers with a seeded e2e account. **Everything in the commands table ran on Node 24, not the project's Node 22 pin (no nvm/volta on this machine) — every executed result is non-transferable to the pinned runtime.** Nothing is committed; the diff lives in the working tree (21 modified + 4 new files, verified via `git status`).

## Commands and results

| # | Command | Result |
|---|---|---|
| 1 | `npm run typecheck` | pass |
| 2 | `npm run test --workspace apps/api` | pass — **137 files / 759 passed / 1 skipped, exit 0** (includes the 2 new suites `org-list-caps.test.ts`, `query-validation.test.ts`; SQLite engine; the stdout "Gate: FAIL" lines are ai-eval-degradation's expected degradation-signal output, not gate failures) |
| 3 | `npm run test:unit --workspace apps/web` | pass **only with `--fileParallelism=false`** — 44 files / 310 tests / exit 0. Plain parallel run: 177 tests passed across 28 files but vitest exited 1 with **16 "Failed to start forks worker / Timeout waiting for worker to respond" unhandled errors** — memory starvation (0.7 GB free on this machine, same profile as the known knip failure), not test failures; the affected files (Home, App, Market, Services, Wallet) all pass in serial runs |
| 4 | `npm run lint --workspace apps/web` | pass — 0 errors, 0 warnings |
| 5 | `node scripts/qa/lint-budget.mjs` | pass — api 124 ≤ 143, web 0 ≤ 0 |
| 6 | `npm run build --workspace apps/web` | pass — bundle within preflight budgets (entry 128.3 kB ≤ 132 kB gzip) |
| 7 | `cd apps/api && npx eslint src tests` | pass — 0 errors, 4 warnings (pre-existing `!`-assertion style in tests; budget holds) |
| 8 | `node scripts/drift-check.mjs` / `node scripts/todo-gate.mjs` / `node scripts/check-versions.mjs` | all pass — versions consistent 1.4.2 / 14002 |
| 9 | `npm run qa:knip` | **not determined** — cannot run on this machine (oxc-parser 2 GiB buffer vs ~1 GB free; known constraint) |
| 10 | Browser QA (Playwright, headless Chromium, 390×844, locale bn-BD) | pass — real dev servers (API on 4000 confirmed `agrobridge-api` via its root envelope; Vite on 5173, verified free first). Logged in with the seeded e2e account from `e2e/a11y.spec.ts` (01700000002), which end-to-end exercises the PR #105 demo-provisioning fix. Home renders the demo farmer session. **0 console errors, 0 page errors** across login + home, light + dark (recorded in `$TEMP/ab-qa/console-errors.json`) |

**Typography verified by computed style, not by test suite alone** — live DOM probe of the rendered Home (logged-in, `bn-BD`):

| Element | size | weight | line-height | ratio |
|---|---|---|---|---|
| `h1.h1` greeting | 20px | 700 | 32px | 1.60 |
| `h2.h2` farm panel | 18px | 700 | 29px | 1.61 |
| section `h2` (আজকের কাজ etc.) | 15px | 700 | 22px | 1.47 |
| `.card-title` | 15px | 700 | 24px | 1.60 |

All weights are real 700 (no `font-extrabold` fakes remain in rendered output) and Bangla heading leading is ≥1.47 — the old Latin-tuned 1.33 is gone. Full evidence set: `$TEMP/ab-qa/` — `01-login-light.png`, `02-login-dark.png`, `03-home-light.png`, `04-home-dark.png`, `headings.json`, `console-errors.json`.

## Deviations

1. **`ORG_LIST_CAPS.farmsPerOrg` (50) added beyond the plan's line references** — GET /:id/farms returned an unbounded farm list too; capping only plots would have left the same F-06 class open one level up. Pattern-consistent with the plan's intent.
2. **`_count.members` added to GET /organizations** — additive contract change so the truncated 50-member slice is visible (same contract as `_count.plots` on GET /farms). Assessed under the api-contract-change skill: fixture records no /organizations endpoints, web has zero consumers, route-role matrix unchanged → no regeneration required. Pinned by `org-list-caps.test.ts`.
3. **`.gitignore` needed no edits** (plan item WS2-5 assumed it might): every scratch pattern was already covered — verified via `git check-ignore -v`. Only the stale files themselves were deleted (~60 stray `*.db`, `tmp-shadow.db`, logs, backups; kept `dev.db`/`test.db`).
4. **AUD-116 clamp behaviour preserved inside the zod schema** rather than switching audit-logs to strict rejection — `clampedInt` preprocess helper; the pinned `admin-pagination-bounds.test.ts` clamp assertions still pass. Unknown *filter values* (withdrawal status, notification category) do fail loud with 400 — that distinction is deliberate and tested in `query-validation.test.ts`.
5. **Two web test assertions updated** (Home.test.tsx `"28°"`→`"২৮°"`; MyOrders.test.tsx `text-xl`→`h1`) — stale assertions against sanctioned WS1 changes, not weakened gates.

## Known gaps

- **Node 24, not the pinned Node 22** — every result above is non-transferable (no nvm/volta on this machine).
- **Web suite's exit 0 required `--fileParallelism=false`** — a CI-relevant environment difference; CI's larger runners will not hit this, but it is recorded.
- **Visual acceptance is computed-style + tool-captured screenshots, not a human/visual-judge review.** The PNGs exist for the owner to eyeball; this session could not inspect them as images. A green console and correct computed styles are not a full visual sign-off.
- **Not run:** e2e Playwright suite, a11y axe scans, Lighthouse CI, i18n:check — unchanged code paths beyond the sweep, but not re-executed in this pass.
- **knip not determined** (memory, above).
- **Preview mode:** nothing committed, nothing pushed. The full diff is in the working tree.

## Open decisions for the owner

1. **Commit & push?** The working tree holds both workstreams; say the word and it goes up as conventional commits (WS1 `feat(web)`, WS2 `fix(api)` split, or one PR — your call).
2. **Deferred items remain owner decisions:** payments/routes.ts split + shim migration, Express 5, OTel, `products:manage` ownership scoping, localStorage token migration, OTP pepper decoupling, web CSP verification.
