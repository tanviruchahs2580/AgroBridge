# 2026-11-03 — the quiet-surfaces pass (web copy and layout simplification)

Why this exists: the copy/layout pass touched eleven screens, deleted 81 dictionary entries and
changed two shared components. Its gate results were produced on a workstation, so they are recorded
here with the commands that produce them. Durable evidence for anything CI runs is the CI run itself.

**Machine:** Windows 11 (10.0.26300), Node v24.19.0, npm workspaces, SQLite dev profile.
**Baseline:** `b8ae2b0` (`main` at the branch point). **Rebased onto `origin/main` at `dd58587`**
(PRs #88 and #89 landed 82 files while this branch was open, including new web e2e specs and four new
dictionary entries); every number below is from the **rebased** tree.

**Stack for the browser gates:** API `NODE_ENV=development PORT=4599 RATE_LIMIT_MAX=2000
LOGIN_RATE_LIMIT_MAX=500` over the seeded `apps/api/prisma/dev.db`; web `vite --port 5301` with
`VITE_API_PROXY=http://127.0.0.1:4599`. Both ports were verified free first — the machine carried
leftover dev servers on 4000 and 4100 from earlier sessions, which is why the run uses its own ports
and `PLAYWRIGHT_BASE_URL` (that also disables Playwright's `webServer`, so the suite cannot silently
test a stale bundle).

## Gates

| Gate | Command | Result |
|---|---|---|
| Web typecheck | `npm run typecheck --workspace apps/web` | clean |
| Web lint | `npm run lint --workspace apps/web` | 0 errors, 0 warnings |
| Web unit suite | `npm run test:unit --workspace apps/web` | **214 passed / 27 files** (before the rebase: 213/26 on 212/26 at the branch point; +1 is this pass's ratchet, +1 file is main's `advisor/sources.test.tsx`) |
| Web build | `npm run build --workspace apps/web` | built in 26.44s; entry `index-BEd0HDwv.js` 404.95 kB / 129.75 kB gzip |
| i18n check | `npm run i18n:check --workspace apps/web` | 378 keys referenced, 531 declared, 0 missing, 0 inline language ternaries |
| Lint warning budget | `node scripts/qa/lint-budget.mjs` | api 143/143, web 0/0 |
| Docs link check | `node scripts/qa/link-check.mjs` | clean, 48 relative targets |
| Docs claims check | `node scripts/qa/claims-check.mjs` | clean |
| E2E chromium | `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5301 E2E_API_BASE=http://127.0.0.1:4599/api/v1 E2E_DB_URL=file:<abs>/apps/api/prisma/dev.db npx playwright test --project=chromium` | **82 passed, 1 skipped, 1 failed** — the failure and its re-run are below |
| E2E firefox + webkit | same env, `--project=firefox --project=webkit` | **12 passed (1.7m)** |

What the e2e pass covers that matters for this change: `a11y.spec.ts` scans `/`, `/market`,
`/wallet`, `/services`, `/orders`, `/sell`, `/settings`, `/notifications` and `/login` (including the
wrong-credentials state) in both themes and reports zero critical/serious axe violations;
`visual-contract.spec.ts` asserts all eight critical pages render with no horizontal overflow at
390 px **and** at 360 px; `console-health.spec.ts` asserts no console errors, page errors or failed
requests on the critical routes. The suite ran with zero retries (local runs do not retry).

## The one failure, and why it was the stack and not the change

`scenarios-governance.spec.ts › [ADM-01] dashboard metrics equal database ground truth` failed on the
first run. Cause: the spec reads its ground truth straight out of a SQLite file, defaulting to
`apps/api/prisma/test.db` — CI's e2e job provisions exactly that file, while this local stack runs the
API over `prisma/dev.db`, so the comparison was between one database's metrics and another's rows. The
spec's own header documents the escape hatch ("a local run with a different stack database passes
`E2E_DB_URL` explicitly"). Re-run with `E2E_DB_URL=file:<abs>/apps/api/prisma/dev.db`:

```
9 passed (1.2m)   # e2e/scenarios-governance.spec.ts, all of ADM-01..03, PRIV-01..02, UX-01/02/04, RES-02
```

So the chromium project is **91 passed, 1 skipped** across the two runs. The skip is the by-design
PostgreSQL-gated case.

## What changed, in numbers

- `apps/web/src/lib/i18n.ts`: **81 entries deleted**. The identity is exact against the rebase point:
  `origin/main` declares **612**, this branch declares **531**, and 531 = 612 − 81. Enums (`svc*`,
  `status*`, `role*`) and every `err*` message stay; four entries main added while the branch was open
  (`advisorSourceUnreviewed`, `casePhotoAlt`, `errAreaPositive`, `viewPhoto`) are present and used.
- `services` chunk unchanged at 63.96 kB; entry bundle 404.95 kB / 129.75 kB gzip. No dependency
  changed.
- Ten screens lost a subtitle, a helper line or a whole section; `PageHeader.subtitle` and
  `EmptyState.description` no longer exist as props, so the pattern cannot be re-added by accident.

## Visual pass

Screenshots of `/login`, `/`, `/services`, `/farm`, `/market`, `/settings` and a 404 at 390 px and
1280 px, captured with a throwaway Playwright script against the same stack. Reviewed for: card grid
alignment in the services catalogue (the single action button aligns across each row), the Home
quick-action tiles at two columns, the readiness ring's caption, and the auth split screen at desktop
width. Nothing required a follow-up change.

## Rebase notes

The only conflict was `features/auth/AuthShell.tsx`, where main added `useIsDesktop()` (it renders
only the hero crop the viewport needs, because a `display:none` image is still fetched — an LCP fix).
Resolution keeps main's hook and image markup and drops only the value-bullet list this pass removed,
so the lazy-crop behaviour is intact. Everything else auto-merged; main's FARM-02 area validation in
`MyFarm.tsx`, its Advisor citation changes and its `Wallet.tsx` changes are all present, verified by
grep on the rebased tree.

## Deviations

- `npm run test --workspace apps/api` was **not** run: this change touches no API source, no schema,
  no migration and no contract fixture. `apps/web` is the only changed workspace.
- `e2e/scenarios-governance.spec.ts` needed `E2E_DB_URL` locally, as described above. CI's e2e job
  provisions `test.db`, which is the default, so no CI change is implied.

## Post-merge: the release, the live artifact and the Android artifact

The change was merged as `3f1c991` (`refactor(web): the screens show state and actions, not
taglines (#90)`, squash with the full body preserved) and verified against production.

| Observation | Command | Result |
|---|---|---|
| Live web commit | `curl -s https://agrobridge-web.vercel.app/version.json` | `{"version":"1.4.1","commit":"3f1c991","builtAt":"2026-11-03T09:17:00.931Z"}` |
| Live API commit | `curl -s https://agro-bridge-api-vantiq-systems.vercel.app/health` | `commit 3f1c991`, `env: production` |
| Live schema | same host `/ready` | `db: true`, applied 11/11 |
| Deploy gate | `gh run view 41609544987` | `completed/success` — "Production includes the reviewed commit" |
| Push-CI / CodeQL on main | `gh run list --branch main` | 13 CI jobs, CodeQL and deploy verification all `success` on `3f1c991` |
| Shipped copy, live | fetch `/`, extract the entry chunk, count strings in it | entry `index-Bjeuj7BB.js`, 388 549 chars: **0** occurrences of all twelve removed strings; **1** of each replacement (`খামার প্রস্তুতি`, `জেলা অনুযায়ী আবহাওয়া`, `কার্ট খালি`, `টাকা তোলার আগে যাচাই প্রয়োজন`, `প্রোফাইল, ফার্ম, অর্ডার ও ওয়ালেট`, `আবহাওয়ার সতর্কতা পাওয়া যায়নি`) |
| Live DOM, authenticated | in-app browser, read-only | `/`: ring caption `খামার প্রস্তুতি`, no AI badge/subtitle, quick tiles label-only, empty cards without the "add your first crop" line. `/services`: 8 cards, one action each, no hero/how-it-works/why/CTA. `/settings`: no subtitle, short district caption, short export line, merged footer, policies and the deletion disclosure intact |
| Android artifact | `gh run download 41609544999 --name agrobridge-debug-apk` | `version.json` inside the APK: `commit 3f1c991`; `assets/public/assets/index-Bjeuj7BB.js` **byte-identical** to the deployed chunk (SHA-256 `c3df0367e000b844f8eb712da7896fc2e45c018bcc4e05438cbb411ac1764b9c`, 404 950 bytes); `AndroidManifest.xml` carries `versionName` 1.4.1 and `com.agrobridge.app` |
| Default credentials on production | four `POST /auth/login` probes with the seeded demo phones | `401` for `01700000000`, `01700000001`, `01700000002`, `01700000099` |

**Deviation — the APK was not run.** The verification machine has no `adb`, no Android SDK, no
emulator, and no Java runtime, so the artifact could not be installed. It was checked by content
(bundle hash, build stamp, manifest version) instead, which proves the APK carries the same reviewed
build as the deployment but does not prove it launches. Running it remains an owner step on a device.

**Out of scope, recorded:** `GET /repos/tanviruchahs2580/AgroBridge/branches/main/protection` returns
`404 Branch not protected`, so the gate `CONTRIBUTING.md` describes (pull requests required, CI and
CodeQL required, force pushes blocked) is not enforced by GitHub. Recorded in `docs/STATUS.md` under
the owner-decision register rather than changed here: enabling protection and correcting the document
are different answers and the choice is the owner's.
