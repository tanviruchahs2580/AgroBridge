# Verification Report — AgroBridge frontend renovation (2026-10-22)

> Companion documents: `audit.md` (what was found, with file:line evidence) and
> `feature-preservation-matrix.md` (what was preserved, per route and action).
>
> **Truth rule applied throughout.** Every `PASS` below is a command whose output
> was read. Anything not executed is marked `NOT RUN` with the reason. No score,
> timing or bundle figure in this document is estimated.

## 1. Environment

| Item | Value |
|---|---|
| Host | Windows 10 (win32 10.0.26300), Git Bash |
| Repository | `C:\Users\DST\projects\Agro bridge app`, branch `main` |
| Baseline commit | `2c83e5b` (working tree clean at start; no user changes existed to preserve) |
| Node / package manager | `>=22` per `.nvmrc`, npm workspaces |
| API for verification | local `tsx watch src/server.ts` on :4000, **SQLite** `apps/api/prisma/verify.db` |
| Web for verification | local `vite` on :5173, proxying `/api` → :4000 |
| E2E base URL | `http://127.0.0.1:5173` (specs' own default) |
| Database provenance | `verify.db` created for this run via `prisma migrate deploy` + `prisma db seed`; **recreated from scratch immediately before the final E2E pass** (recorded below) so stock decrements from earlier runs could not produce false failures |

No production resource was touched. `apps/api/.env.local`, which points at a live
Neon instance, is loaded by nothing in this flow (the API imports only
`dotenv/config`, i.e. `.env`, which selects `file:./dev.db`); `DATABASE_URL` was
set explicitly per command to this run's throwaway file.

## 2. Baseline (before any edit)

| # | Command | Status | Result |
|---|---|---|---|
| B1 | `git status --short --branch` | PASS | `## main...origin/main`, no local modifications |
| B2 | `npm run typecheck --workspace apps/web` | PASS | exit 0 |
| B3 | `npm run test --workspace apps/web` | PASS | 19 files, **181 passed**, 0 failed, 75.65 s |
| B4 | `npm run build --workspace apps/web` | PASS | exit 0, built in 25.02 s; entry `423.75 kB / 134.38 kB gz` |
| B5 | `curl -X POST :4000/api/v1/auth/login` | PASS | `{"ok":true,…}` after provisioning a migrated DB |
| B6 | `npx playwright test` | PASS | **47 passed**, exit 0, 5.1 m |

Baseline chunk sizes are tabulated in `audit.md` §7. No pre-existing test failure
existed, so this change set has no "known failure" allowance.

## 3. Final results

| # | Command | Status | Result |
|---|---|---|---|
| F1 | `npm run typecheck --workspace apps/web` | PASS | exit 0 |
| F2 | `npm run lint --workspace apps/web` | PASS | 0 errors, 0 warnings |
| F3 | `npm run i18n:check --workspace apps/web` | PASS | 439 keys referenced, 0 missing, **0 inline language ternaries** |
| F4 | `npm run test --workspace apps/web` | PASS | 19 files, **181 passed**, 0 failed |
| F5 | `npm run build --workspace apps/web` | PASS | exit 0, 11.20 s |
| F6 | `npm run preflight --workspace apps/web` | PASS | all 5 families green — see §4 |
| F7 | `node scripts/audit-dead-classes.mjs` | PASS | 157 class tokens checked, **0 emitting no CSS** |
| F8 | `npx playwright test` | PASS | **49 passed, 0 failed, 0 flaky, exit 0**, 6.0 m — 37 chromium (full suite) + 6 firefox + 6 webkit (the two smoke specs). Suite grew from the baseline's 47 by the 2 new `farm-card` tests. |

### An intermediate E2E run failed, and that is part of the record

The first full run **after** the edits produced **8 failures** against a green
baseline. They were diagnosed rather than re-run, and they had exactly two causes —
both of which were my changes breaking **too-broad test assertions**, not broken app
behaviour:

| Failing tests | Cause | Resolution |
|---|---|---|
| `a11y.spec` authenticated-shell scan, `visual-contract` light-theme pass | `page.locator("nav[aria-label]")` stopped being unique once the `Sidebar` got an `aria-label` (before, only the bottom bar was labelled, which is precisely the defect `audit.md` §8.3 recorded) | both specs now address the mobile primary nav by a stable `data-testid="bottom-nav"` |
| `gui-e2e-test` T4, T5, T6, T7, T8 | `page.locator('nav[aria-label] a')` matched **sidebar** links first once the sidebar was labelled; the sidebar is `display:none` below `md`, so `.first()` resolved to a hidden element and every click timed out. The Assertions were passing before only because the sidebar was invisible to the selector | 6 call sites now scope to `[data-testid="bottom-nav"] a` |
| `offline.spec` queue-replay, and the banner test | `page.locator('div[role="status"]')` stopped being unique once non-error toasts also became `role="status"` (the correct ARIA — the container had been the live region and toasts only sometimes were) | specs now use `data-testid="offline-banner"` |

`data-testid="bottom-nav"` / `"sidebar-nav"` / `"offline-banner"` were added to the
three elements. This is not a new convention: `Splash.tsx` already carries
`data-testid="splash"` and `splash-verify.spec.ts` already selects on it. The
final run above is the evidence that all eight now pass; the intermediate failure
count is recorded here because a verification report that only shows the green run
is not a record of what happened.


### Bundle movement (F5 vs B4, same machine, same flags)

| Chunk | Baseline | Final | Delta |
|---|---|---|---|
| entry `index-*.js` | 423.75 kB (134.38 kB gz) | 425.06 kB (134.75 kB gz) | +1.31 kB raw (+0.37 kB gz) |
| `Services-*.js` | 73.93 kB (21.04 kB gz) | 74.17 kB (21.04 kB gz) | +0.24 kB raw (0 gz) |
| CSS (`index-*.css`) | 61.56 kB (11.8 kB gz) | 11.8 kB gz | unchanged within rounding |
| all JS (gzip) | 212.7 kB | 212.6 kB | −0.1 kB |

The entry-bundle growth is the added dictionary keys, the shared `BlockError` /
`UiLangProvider` code and the small new modules. It is inside the repository's own
enforced budget (`entry bundle (gzip): 131.3 kB, budget 132 kB` — the preflight
asserts it, so this is a gated number, not a claim). **No performance improvement
is claimed**: nothing here was measured that would support one. The `Services`
chunk still carries framer-motion's full feature set; see §7.

## 4. Release preflight (F6), full output

```
✓ both vercel.json files carry the same header policy
✓ inline script (445 bytes) is allowlisted: sha256-YUcwMzZ0gx97FWbqxA9+Cavq+c8Ee6RP3CVy8jWZp00=
✓ connect-src allows the API origin the bundle bakes in (https://agro-bridge-api-vantiq-systems.vercel.app)
✓ entry bundle (gzip): 131.3 kB (budget 132 kB)
✓ all JS (gzip): 212.5 kB (budget 225 kB)
✓ all CSS (gzip): 11.8 kB (budget 15 kB)
✓ fonts: 486.3 kB (budget 520 kB)
✓ images: 2428.0 kB (budget 2600 kB)
✓ no raw hex colors in src/**/*.ts(x) outside the token layer (1 allowlisted)
  ↳ src/lib/session.tsx:51 — meta theme-color literal (var() is not resolved for it)
✓ every Tailwind class in src/ resolves in the built CSS (157 checked)
✓ web preflight passed
```

The last line is the **new fifth family** this change set added, wired into the
existing `npm run preflight` so it runs in the `Web — Lint · Unit · Build` CI job
without editing the workflow. It is the gate that would have caught the three
silently-unstyled classes documented in `audit.md` §8.1.

### The new gate is proven to detect breakage, not just to print green

A passing gate that cannot fail is worthless, so it was tested against a
deliberately broken probe file:

```
$ cat > src/__gate_probe.tsx <<'EOF'
  export const Probe = () => <div className="bg-surface-card-subdued bg-warning
    text-2xs text-md decoration-link/40 rounded-card" />;
  EOF
$ node scripts/audit-dead-classes.mjs
class tokens checked: 161 | emitting no CSS: 3
  bg-surface-card-subdued        <- __gate_probe.tsx
  bg-warning                     <- __gate_probe.tsx
  decoration-link/40             <- __gate_probe.tsx
$ rm src/__gate_probe.tsx && node scripts/audit-dead-classes.mjs
class tokens checked: 158 | emitting no CSS: 0
```

It names exactly the three classes it is meant to catch, and returns to clean once
they are removed. The probe file was deleted; `git status` shows it is not present.

The CLI also supports probing one class at a time, which is how each finding was
confirmed individually:

```
$ node scripts/audit-dead-classes.mjs bg-white/10 bg-warning bg-surface-subdued
  bg-white/10               PRESENT  .bg-white\/10{…}
  bg-warning                *** ABSENT ***  .bg-warning-bg{…}
  bg-surface-subdued        PRESENT  .bg-surface-subdued{…}
```

## 5. Browser-level verification

The local stack (API :4000 + web :5173 + seeded demo farmer) was driven with real
browsers. The 5xx/rate-limit guardrails the repository documents were applied
(`RATE_LIMIT_MAX=2000`, `LOGIN_RATE_LIMIT_MAX=500` on the API process).

### 5.1 The `MyFarm` plot-form bug — before and after, by measurement

This is the one finding in the change set that was reproduced as a **failing
browser assertion** before the fix, not inferred from reading code. A temporary
Playwright diagnostic clicked into the inline "add plot" form and reported which
view the page ended up on:

| Code state | Diagnostic output |
|---|---|
| Baseline (before fix) | `detailAppeared=true formStillThere=false` — the form was destroyed |
| After fix | `detailAppeared=false formStillThere=true` — the form survives |

The diagnostic was then rewritten as a permanent regression spec,
`apps/web/e2e/farm-card.spec.ts` (2 tests), which also asserts the card no longer
claims `role="button"`.

### 5.2 Full E2E suite

**49 passed, 0 failed, 0 flaky, exit 0** (37 chromium + 6 firefox + 6 webkit), 6.0 m,
on a database re-created from scratch immediately before the run. §3 F8 records the
intermediate 8-failure run and its causes. The suite covers, with real browsers, at
both 390 px and 360 px, in both themes and in all three engines: route rendering and
horizontal-overflow checks for the 8 critical pages, axe scans (zero
critical/serious), keyboard-only tab order and focus traps, the offline banner and
the offline write-queue replay with `clientUuid` idempotency, console health (no
console errors / page errors / failed requests), settings and account deletion,
the admin guard, the English-mode pass, and per-route navigation timings.

### 5.3 Visual review of the real UI

Screenshots of the running app at 390 × 844 (DPR 2, `bn-BD`) were captured and
reviewed. This is what produced the four design defects in §6.2 below; each was
visible in the render, not theorised. Capture is reproducible:

```
node scripts/capture-design-review.mjs          # 390x844, light, all routes
node scripts/capture-design-review.mjs --dark   # dark theme
```

Output lands in `apps/web/design-review/` (git-ignored; screenshots are not
committed). The in-app browser's own screenshot path timed out in this environment
twice at 30 s, which is why the capture uses Playwright directly.

## 6. What changed, and how each change was verified

### 6.1 Defects fixed — each one proved first

| # | Defect | Proof it existed | After |
|---|---|---|---|
| 1 | `bg-surface-card-subdued` emitted no CSS (7 call sites) → panel backgrounds transparent | built-CSS probe: `(no selector)` | probe: `PRESENT` `.bg-surface-subdued{…}` |
| 2 | `bg-warning` emitted no CSS → the readiness risk dot **vanished exactly when a risk existed** | built-CSS probe: `ABSENT` (loose greps had matched `.bg-warning-bg`) | uses `bg-enterprise-warning`, `PRESENT` |
| 3 | `decoration-link/40` emitted no CSS → legal-page link underline colour dropped | built-CSS probe: `(no selector)` | `decoration-brand-200`, `PRESENT` |
| 4 | `Field`'s error paragraph had no `id`, so 13 `aria-describedby="…-err"` attributes pointed at nothing | cross-check of all 13 call sites in Login/Register/Reset/SellCrop | `Field` now emits `id={htmlFor}-err`; every existing reference resolves |
| 5 | Inline "add plot" form was destroyed by the farm card's click handler | Playwright diagnostic: `formStillThere=false` | `formStillThere=true`; permanent spec added |
| 6 | Farm card was `role="button"` while containing buttons and a form | Playwright: `[role="button"]` count ≥ 1 | count 0, asserted |
| 7 | `MyFarm` rendered `risks[0]` unfiltered in an amber warning box, so the provider's INFO-level "Weather favourable" appeared as a **warning** while Home reported no risk from the same payload | screenshot + `Home` vs `MyFarm` source comparison | both use the shared `lib/weatherRisks.ts` filter |
| 8 | Home printed the same two strings twice (weather-card footer **and** Smart Alerts) | DOM snapshot of the rendered page | the per-card strip is gone; the advisory lives in the advisory section |
| 9 | Neutral "notifications" quick action painted in danger red, and used the `text-danger-text` **text** token as a background | screenshot + source | info tones; badge uses `bg-enterprise-critical` |
| 10 | A `<span>` styled with `text-link` + chevron looked like a link but was not a control — and duplicated the "view plots" button's action | source + screenshot | removed; the real button remains |
| 11 | `Button size="sm"` was 36 px — the only control below the app's own 44 px target, used for farm actions, admin approve/reject, mark-all-read, booking cancel | source | 44 px; preflight/overflow specs still pass |
| 12 | Doctor's live region announced English to Bengali users; `Playwright`… (see below) | DOM snapshot: `Loading 0 percent — …` became `লোড হচ্ছে ০ শতাংশ — ফার্ম ডেটা সংযুক্ত হচ্ছে...` | `splashLoadingProgress` key, confirmed live in the browser |
| 13 | Toast container was `aria-live="polite"` **and** each error toast carried `role="alert"` + `aria-live="assertive"` → nested live regions, double announcement; `Wallet` nested `role="alert"` inside `role="alert"` | source; the existing unit test asserted the old arrangement | one role per toast; container is not a live region; unit test updated to assert the new (correct) semantics |
| 14 | `BottomNav` badge's only text said "new notifications" **and** sat inside an `aria-hidden` subtree, so on the wallet tab it was both wrong and invisible to AT | source (`ui.tsx`) + call-site check (`App.tsx:144` is the only badge) | `badgeLabel` names what it means, rendered outside `aria-hidden` |
| 15 | `Sidebar` had no `aria-label` → two indistinguishable `nav` landmarks | source | labelled; specs updated to address each landmark by test id |
| 16 | `Modal`'s focus trap was gated on *closability*, so the checkout wizard's intermediate steps were `aria-modal="true"` with no trap, no initial focus and no focus restore | source (`useDialogA11y(Boolean(onClose), onClose)`), call site `Market.tsx` | gated on being mounted/open |
| 17 | Disease-photo input was `display:none`, so the only path into the disease intake was unreachable by keyboard | source | `sr-only peer` + `peer-focus-visible` ring on the label |
| 18 | A failed advisory request was rendered as an **AI answer bubble** | source (`Advisor.tsx` `role:"ai"` on the mapped error) | failed turns render an `ErrorBanner`; the transcript is a `role="log"` live region |
| 19 | Health `Wait` — the readiness ring could read as a fabricated conformance score… (see §7) | n/a | unchanged; no score was invented |
| 20 | Raw enums leaking into the UI (`RICE`, `FARMER`) where localizers existed | source + DOM snapshot (`ধান` confirmed after the fix) | `cropLabel` / `roleLabel` |
| 21 | Service-category counts hardcoded beside the mapping they duplicate | source | derived from `FILTER_MAP` |
| 22 | 8 arbitrary type sizes (`text-[10px]`…`text-[26px]`) off a 7-step scale; page `<h1>` sizes disagreed per screen (17 / 20 / 28 px) | source inventory | two named steps added (`2xs`, `md`); every arbitrary size replaced; `<h1>` on the scale |
| 23 | Nine byte-identical copies of `BlockError`, two of the care-tone class map, two of the crop list | source inventory | one shared definition each (`ui.tsx`, `lib/labels.ts`) |
| 24 | Heading-order gaps (`EmptyState` hard-coded `h3` under a page `h1`; `Onboarding` had no `h1`; product cards were `h3` with no `h2`) | source inventory | `EmptyState` gained `headingLevel` (default 2, 4 nested call sites opt into 3); `Onboarding` gained an `h1`; the Market grid gained an `sr-only` `h2` |
| 25 | Admin data table: 7 `<th>` without `scope` | source | `scope="col"` |
| 26 | Unread notifications conveyed by tint alone | source | `sr-only` "unread" text |
| 27 | `Settings` hand-rolled five `Loader2` spinners and never announced the busy state | source | shared `Spinner` + `aria-busy` |
| 28 | English literals in primitives (`ErrorBanner` "Copy"/"Copied!", `Modal` "Close") on 14 + 2 call sites | source inventory | `UiLangProvider` + `useUiLang`; defaults now come from the dictionary |
| 29 | `✅` prefixes in five toast strings although `ToastProvider` already draws a success tick; `👋` in the page `<h1>` | source inventory | removed; no emoji remains in `src/` outside an explanatory comment |

### 6.2 Design defects found **only** by looking at the render

Rows 7, 8, 9, 10 and 29 above came from reviewing screenshots of the running app,
not from static reading — the code was internally consistent, and the defect was
in how it composed. That is why the visual pass exists rather than being assumed.

## 7. Known remaining issues, unverified areas and follow-ups

Nothing in this section is a claim that something works. Each item is either an
open defect with its location, or work not attempted.

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | `Services`/`ServiceCard` import the full `motion` component, pulling framer-motion's layout-projection engine into the 74 kB route chunk | **open** | `layout` needs `domMax`, which `main.tsx` deliberately does not load, so those bytes buy a capability that is not active. Removing `layout` (and with it the `motion` import) would cut the chunk; loading `domMax` at the root would move the cost onto every user. Left as-is because both directions trade one cost for another and the choice is a product decision. |
| 2 | `Button` disables itself during async actions, which can drop focus to `<body>` | **open, not attempted** | Fixing needs an `aria-disabled` pattern across every async control — a cross-cutting change, not a repair inside this pass. |
| 3 | The Home hero is still the tallest element on the page (~3 nested surfaces: gradient card → glass box → ring) | **open, judgement** | It is the deliberate headline status and I could not show it costs users anything measurable. Changing it reduces a design decision to taste, so it was left. |
| 4 | `Services`' three summary cards look tappable (arrow / check icon) but are not controls | **open** | Making them filter is a feature addition, which the brief forbids inventing. Reported instead. |
| 5 | `components/TopBar.tsx` still renders under the header on authenticated routes, duplicating navigation | **open** | `VITE_FEATURE_NEW_SHELL` gates the newer shell; removing the legacy bar is a product decision. |
| 6 | `apps/web/vitest.config.ts` coverage floors (statements 16, branches 75, functions 49, lines 16) are unchanged | **not changed** | Lowering or raising a coverage gate is a policy change; this pass adds no feature-level tests for the pages it touched beyond `farm-card.spec.ts`. |
| 7 | Unit/E2E suites were not extended to cover every fixed item (e.g. no test asserts the weather card no longer duplicates Smart Alerts) | **partially covered** | New/updated coverage: `farm-card.spec.ts` (2 tests), `ui.test.tsx` toast semantics, `i18n.test.ts` greeting. The remaining fixes are covered by the structural specs (preflight dead-class family, axe, overflow, keyboard) rather than by dedicated assertions. |
| 8 | The `npm audit`, dependency-licence, `jscpd` and `knip` gates were not re-run | **NOT RUN** | No dependency was added or changed, and no tracked file was renamed or removed. `knip.jsonc` tracks exports; the one new module (`lib/weatherRisks.ts`) is imported by two screens, and `audit-dead-classes.mjs` is wired into `preflight`. Running these would not exercise this change set's behaviour, and CI runs them on the PR. |
| 9 | The PostgreSQL test profile and the API suites were not run | **NOT RUN** | Out of scope: no `apps/api` file was modified (`git diff --stat apps/api` is empty). |
| 10 | No Lighthouse / Core Web Vitals measurement was taken in this pass | **NOT RUN** | The repository's Lighthouse config is `workflow_dispatch`-only by design, and the byte budgets it does enforce are in the preflight output above. No FPS, LCP or "faster" claim is made anywhere in these documents. |
| 11 | Formal WCAG 2.2 AA certification | **not claimed** | axe passes zero critical/serious on the scanned routes, and the manual checks below were done — that is the extent of the evidence. |

### Manual checks performed (and what they are not)

| Check | Method | Result |
|---|---|---|
| Bengali rendering at 390 px | screenshots + DOM snapshot | Bengali labels, wrapping and the numeral rendering all read correctly; the greeting, advisory copy and provincial date all render in Bengali |
| Reduced motion | `MotionConfig reducedMotion="user"` + global `prefers-reduced-motion` guard; E2E `keyboard.spec.ts` passes | PASS — no motion-related assertion failed |
| Keyboard-only operation | `keyboard.spec.ts` (skip link, tab order, confirm-dialog focus trap) | PASS |
| 360 px and 390 px reflow | `visual-contract.spec.ts` 360 × 640 pass + 390 px overflow assertions on 8 pages × light/dark | see §6 E2E figures |
| Dark theme | `visual-contract.spec.ts` dark pass | PASS |

These are **not** a screen-reader pass (no NVDA/JAWS/VoiceOver was driven) and not
a human accessibility audit.

## 7a. Second pass (2026-10-23) — user-level functional acceptance, then CI/CD

The first pass verified the UI renovation. This pass was asked to prove the whole
system works as a user drives it, then run the full CI/CD pipeline and release it.
It found more than the CI gates had.

### The tool that was supposed to prove functionality was reporting false green

`api-full-validation.sh` — the repo's 19-section, curl-based functional acceptance
harness — reported **"36 passed, 7 failed"** while verifying almost nothing:

1. Every check was written as **two** lines:
   `RESP=$(curl -sf -X GET "…")` then `ok "GET …" || { echo "     → $RESP"; }`.
   The assignment's exit status is therefore discarded and `ok` runs
   unconditionally, so ✅ printed whether the request succeeded or returned 401.
   Instrumented proof from the running stack:

   ```text
   DIAG token_len=0
   DIAG /auth/me http=401
     ✅ GET /auth/me          ← reported as a pass
   ```

2. Registration omitted `consent: true`, required by the API since PRD-05/AUD-150,
   so register returned 400, no token was ever obtained, and the entire
   authenticated surface silently 401'd.

Both fixed with explicit `expect_2xx` / `expect_code` helpers that own the status
check, and consent in the registration body. Three probes that encoded wrong
assumptions were corrected against the API's own contracts (logout takes the
refresh token in the **body**; procurement offers require `farmId`; non-owner farm
access is **403**, which `tests/tenant-isolation.test.ts` states as "403 or 404").
Coverage was extended to the flows a release depends on: consent enforcement,
wrong-password 401, weather risks + provenance, AI confidence + groundedRefs,
farm → plot → event → crop lifecycle with stage, ownership isolation, non-empty
catalogues, cart add + contents, server-calculated offer payable, membership tiers,
notification preferences, farmer 403 vs admin 200 with live counts, disease upload
validation, logout revocation in both directions, and five unauthenticated-access
probes.

**Result: 91 checks, 91 pass, 0 fail** — each one now able to fail.

> **Where this fix lives.** `api-full-validation.sh` is git-ignored
> (`.gitignore:77`) and was never tracked; the repo's own archive already calls it
> "gitignored, local-only" and records a previous repair. The corrected script is
> therefore **not part of the commit set** — force-adding it would change a
> deliberate ignore policy, which is not this change set's call. Recommendation:
> promote it to a tracked `scripts/qa/` harness if it is meant to be depended on,
> because a validator nobody versions is a validator that lies.

### A real security defect: logout did not end the session on the server

`POST /auth/logout` revokes only the refresh token it is handed in the request body
(`req.body.refreshToken`, optional); the client sent `{}`. Measured on the running
stack:

| What logout sent | Replaying that refresh token afterwards |
|---|---|
| body `{}` (what the app sent) | `POST /auth/refresh` → **200** — still minting access tokens |
| body `{refreshToken}` (what the API expects) | `POST /auth/refresh` → **401** — revoked |

So logging out cleared the browser's copy and returned to /login while the
server-side row stayed valid for the token's 7-day TTL. The API suite asserts the
revocation contract (`security-matrix.test.ts:65`); the client never exercised it —
and the existing unit test **asserted `{}`**, which is how the defect shipped.

Fixed in `lib/session.tsx`. The unit test now asserts the token is sent, and
`e2e/logout-revocation.spec.ts` drives the real UI, captures the request the browser
actually made, and replays that token against the API. Proven to be a real guard:
with the fix temporarily reverted the browser test fails with
`logout sent no refresh token (body was {}), so the server revoked nothing`.

### AA contrast failures no gate was watching

| Violation | Measured | Fix |
|---|---|---|
| Home unread badge — white on `--color-critical` | 3.77:1 (needs 4.5:1) | new `--color-critical-strong` (6.5:1) |
| Notifications active-tab badge — `bg-white/20` over the green tab with an inherited white label | ≈3.4:1 | solid light pill, accent text |
| `Button variant="danger"` — white on the same accent | 3.77:1, and **2.5:1 in dark** | `--color-critical-strong` |
| AI chip + AI CTA — white on `--color-ai-indigo` (#818cf8 in dark) | **2.6:1 in dark** | new `--color-ai-indigo-strong` (5.10:1) |

The danger button and the AI surfaces are **pre-existing** defects. axe never
reported them because a danger button is only on screen while a confirmation dialog
is open — which the route scans never open — and because **the axe suite scanned
light mode only**. Both gaps are now closed: a dark-theme scan walks `/`, `/market`,
`/wallet`, `/notifications`, `/settings` and asserts the theme survived navigation,
so it cannot silently pass on the light theme. It found the two dark failures on
its first run.

### An environment gotcha, recorded so it is not re-chased

The first production-build E2E pass failed 35 tests with login never navigating. The
cause was not the app: **Git Bash's MSYS path conversion rewrote the env var** used
for the preview build.

```text
plain node sees:        "C:/Program Files/Git/api/v1"   ← mangled
with MSYS_NO_PATHCONV:  "/api/v1"                       ← intended
```

The bundle therefore contained `Program Files/Git/api/v1` and the browser tried
`file:///C:/Program Files/Git/api/v1/auth/login`. CI runs on Ubuntu and is
unaffected; on Windows the preview pass needs `MSYS_NO_PATHCONV=1`, and the bundle
is now checked for that string before the pass runs.

### Full CI/CD pipeline, executed locally

Every job `.github/workflows/ci.yml` defines, run on this machine with the
workflow's own commands.

| CI job | Step | Status | Result |
|---|---|---|---|
| quality-gates | `knip-gate.mjs` | **PASS** | only reviewed baseline items |
| quality-gates | `jscpd --threshold 3 apps/api/src apps/web/src` | **PASS** | 25 clones, 330 lines, **1.33%** (limit 3%) |
| quality-gates | `licence-gate.mjs` | **PASS** | 165 production packages on the allow-list |
| quality-gates | `drift-check.mjs` | **PASS** | migration chain reproduces the schema exactly |
| quality-gates | `todo-gate.mjs` | **PASS** | no TODO/FIXME/HACK/XXX in shipped source |
| quality-gates | `route-matrix.mjs --check` | **PASS** | up to date (67 routes) |
| quality-gates | `gen-erd.mjs --check` | **PASS** | up to date (33 models) |
| api-quality | `eslint src tests` | **PASS** | 0 errors, 137 pre-existing warnings |
| api-quality | `npm run typecheck` | **PASS** | — |
| api-quality | `prisma validate --schema prisma/schema.postgresql.prisma` | **PASS** | valid, with CI's PostgreSQL `DATABASE_URL` |
| api-quality | `vitest run --coverage` (SQLite) | **PASS** | 89 files, **489 passed + 1 skipped**, exit 0; statements 88.46%, branches 79.67% |
| api-postgres | `provision-postgres.mjs` | **PASS** | seeded from the shipping schema and migration chain |
| api-postgres | `vitest run --config vitest.config.pg.ts` | **PASS** | **487 passed + 3 skipped**, exit 0 |
| api-migration-drift | `prisma migrate status` | **PASS** | "Database schema is up to date!" (8 migrations) |
| api-migration-drift | `prisma migrate diff --exit-code` | **PASS** | "No difference detected." |
| web-quality | `npm run lint` | **PASS** | 0 errors, 0 warnings |
| web-quality | `npm run i18n:check` | **PASS** | 439 referenced, 0 missing, 0 inline ternaries |
| web-quality | `npm run test:unit -- --coverage` | **PASS** | 19 files, **181 passed**, coverage gate met |
| web-quality | `npm run build` | **PASS** | exit 0 |
| web-quality | `npm run preflight` | **PASS** | 5 families incl. the new dead-class gate |
| web-e2e | `npx playwright test` (dev server) | **PASS** | **51 passed, 0 failed**, 5.0 m |
| web-e2e | `npx playwright test` (production build via `vite preview` + `PLAYWRIGHT_BASE_URL`) | **PASS** | **51 passed, 0 failed**, 4.9 m |

Three honesty notes. The first local run of the API suite exited 1 with
"prisma generate failed … a dev server is running and holding the query engine DLL"
— a Windows conflict the repo documents; stopping the API and re-running produced
the result above. One warm-up E2E run showed a single webkit failure on the lazily
loaded legal page (a 5 s assertion against a cold chunk); the same test passed on
re-run, and the repo's CI absorbs exactly that class with `retries: 2` (its own
comment names the webkit journey and the chromium axe scans). And the "Gate: FAIL"
lines in the PostgreSQL log belong to `ai-eval-degradation.test.ts`, which
deliberately breaks the retrieval corpus to prove the AI gate *can* fail — that
test passes; no test failed.

PostgreSQL 17.11 ran in Docker on the digest CI pins
(`postgres:17-alpine@sha256:b0f9560a…`), on host port 5434 because 5433 was taken.

## 8. About Figma

The request was to run this renovation through Figma. That was **not possible in
this environment**, and no part of this work pretends otherwise:

| Check | Result |
|---|---|
| MCP servers available in this session | 6: `documents` (docx), `pdf`, `presentations` (pptx), `spreadsheets` (xlsx), `context7`, plus the browser/computer-use runtime. **None is Figma.** |
| Figma MCP entries in ZCode config (`~/.zcode/v2/*.json`) | none — no `mcp` key in `config.json`, `setting.json`, or `bot-config.v3.json` |
| Figma Dev Mode MCP server reachable (`127.0.0.1:3845`) | no response (`curl` → connection failed, both `/mcp` and `/sse`) |
| Figma desktop app installed (needed to host that server) | not present (`%LOCALAPPDATA%\Figma` and `Program Files\Figma` both absent) |
| A Figma file for this product to design from | **does not exist.** `docs/design-tokens.md:5` contains a literal placeholder: `Figma: _placeholder — https://figma.com/file/agrobridge-tokens_` |
| A Figma API token in the workspace | none |

Two consequences worth stating plainly, because they affect the plan rather than
just this run:

1. **There is nothing in Figma to read.** The repository's declared source of truth
   is code: `src/tokens.css` + `tailwind.config.js`, with `docs/design-tokens.md`
   as the written contract. A Figma MCP would have no file to point at.
2. **A Figma MCP cannot author a design anyway.** The official Figma Dev Mode MCP
   server is a *read* surface — it returns code and variables for a frame or
   selection you have open in the desktop app. It does not create frames, styles or
   components. So "design with Figma via MCP" is not a thing that exists; what
   exists is "extract from a Figma file someone already made".

If a Figma pipeline is wanted, the order that actually works is: author the design
in Figma (by a person), enable the Dev Mode MCP server in the desktop app, register
it in ZCode as an MCP server, then this agent can pull tokens/components from it.
Until step one exists, the design source of truth stays `tokens.css` — which is
what every fix above used, and why every colour change is a token change.

## 9. Git state

| Item | State |
|---|---|
| Pre-existing user changes | none existed (`git status` clean at start) |
| Commit | **not made** (the brief defaults to no commit) |
| Push | **not made** |
| Working tree reviewed | yes — `git diff --stat` inspected file by file; the over-matching codemod incident in `MyFarm`/`Market`/`Services` was detected by diff size, all 9 affected files were reverted with `git checkout --` and redone with a verified, line-anchored script |
| Untracked additions | `apps/web/e2e/farm-card.spec.ts`, `apps/web/scripts/{audit-dead-classes.mjs,capture-design-review.mjs,lib/}`, `apps/web/src/lib/weatherRisks.ts`, `docs/ui-ux-renovation/` |
| Ignored additions | `.gitignore` gained `apps/web/design-review/` (local screenshots) |
| Cross-boundary changes | none in `apps/api/**`. One infra-adjacent file: `apps/web/scripts/preflight.mjs` gained the dead-class family (a `apps/web` file; the CI workflow itself was not edited) |
| Secrets | none added. No token, phone number or credential appears in any artifact; the capture script uses only the repository's own documented demo account |
