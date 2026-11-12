# AgroBridge Quick Services — Implementation Report

> Companions: `docs/qa/quick-services-implementation-2026-11-12.md` (this file) follows the handoff's
> `IMPLEMENTATION_REPORT_TEMPLATE.md`. Every bracketed field is replaced with an observed fact; where a
> check could not be run it says so. The owner's handoff package (spec, component contract, token
> estimates, reference PNG) lives outside the repository; nothing from it is shipped as UI.

## 1. Executive summary

- **Status:** Complete — with one documented judgment call (the header action's destination) and one
  pre-existing defect found outside this scope (§8).
- **Implementation date:** 2026-11-12
- **Repository / branch:** `tanviruchahs2580/AgroBridge`, branch `feat/quick-services-redesign`
  (PR: *feat(web): দ্রুত সেবা — the Quick Services section gets the approved surface*).
- **Framework/runtime confirmed:** React 18 + Vite 6 + TypeScript 5.7 + Tailwind 3 + react-router-dom 7,
  `lucide-react` icons, `apps/web` workspace. No dependency was added.
- **Scope:** the Quick Services section on the Home screen only — its surface, geometry, cards, icon
  treatment, typography and unread indicator. Unrelated screens, routes, API, schema, auth and
  business logic are untouched (diff below).

## 2. Initial inspection

- **Existing Quick Services location:** `apps/web/src/features/home/Home.tsx:390-439` — section heading
  `t("quickActions")` (দ্রুত সেবা) over a `grid grid-cols-2 gap-3 lg:grid-cols-4` of four `Link` tiles
  (icon-above-label, `bg-surface-card`), with the unread count badge on the notifications tile.
- **Existing route/action for এআই কৃষি সহকারী:** `<Link to="/advisor">` → `features/advisor/Advisor.tsx`
  (route `App.tsx:358`).
- **Existing route/action for সেবা:** `<Link to="/services">` → `features/services/Services.tsx`.
- **Existing route/action for ফসল বিক্রি:** `<Link to="/sell">` → `features/sell-crop/SellCrop.tsx`.
- **Existing route/action for নোটিফিকেশন:** `<Link to="/notifications">` →
  `features/notifications/Notifications.tsx`.
- **Existing `সব দেখুন` behaviour:** **gap** — the section had no header action, and the repository has no
  all-services route (`App.tsx` route table: `/`, `/farm`, `/advisor`, `/market`, `/services`, `/sell`,
  `/wallet`, `/notifications`, `/orders`, `/settings`, `/admin`, legal, auth). `t("viewAll")` (সব দেখুন)
  already existed and is used by Advisor for "show all cases".
- **Canonical unread state source:** `useResource(RESOURCE_KEYS.notifications, () => api("GET",
  "/notifications"))` in Home — the same resource the tile already read; `unread` and `unreadKnown`
  (false while that read has failed) are passed to the component. No new state, no shadow copy.
- **Existing theme/font/icon conventions reused:** `tokens.css` (hex lives only there), `dark.css`
  attribute theming, Hind Siliguri Bengali stack, `lucide-react`, `rounded-card`/`rounded-chip` radius
  scale, `motion-reduce` handling, `--ring-color`-style focus conventions (white ring on dark
  surfaces, as the readiness panel already uses).
- **Related tests and scripts:** `apps/web/package.json` — `typecheck`, `lint` (0-warning budget),
  `test:unit`, `i18n:check`, `build`, `preflight`; e2e specs navigate by direct route, so none depends
  on this section's markup (checked: `a11y.spec.ts`, `perf-throttled.spec.ts`,
  `scenarios-clinical.spec.ts` all use `page.goto`).
- **Existing defects/ambiguities affecting this scope:** (a) no all-services destination exists
  (§8.1); (b) the top bar overflows the viewport at ≤320px and under 125% text scaling — pre-existing,
  outside this section, not touched (§8.2).

## 3. Changed files

| File | Change | Reason |
|---|---|---|
| `apps/web/src/tokens.css` | Added the section-scoped `--qs-*` token group (surface, card, borders, text, four accents + their ink colours) with the rationale comment | The design's hex/alpha values live in the token layer, never in the component; section-scoped because the handoff forbids changing the app-wide theme |
| `apps/web/src/index.css` | Added `.qs-section`, `.qs-atmosphere`, `.qs-card` (+ hover/press and an `@supports` opaque fallback) | Section-scoped surfaces; **no backdrop-filter** (cheap on low-end devices, readability independent of compositor support); atmosphere is two static radial gradients — no blur, no animation |
| `apps/web/src/features/home/QuickServices.tsx` | **New.** Presentational component: header + `সব দেখুন` action + 2×2 cards, receiving `lang`, `unread`, `unreadKnown` | Handoff component contract: presentation only, no state, no request, no business logic; destinations passed as literals reused from the previous section |
| `apps/web/src/features/home/Home.tsx` | Replaced the inline section with `<QuickServices …/>`; dropped the now-unused icon imports (`Bell`, `Coins`, `Tractor`) | Same data flow (`unread`/`unreadKnown` passed straight through); one component owns the section |
| `apps/web/src/features/home/Home.test.tsx` | Added 6 tests: composition label set, the five destinations, unread=3, unread=0, read-failure, no-raw-hex + class contract | Behaviour pinning for the redesign; also asserts the unread state is not inside an `aria-hidden` subtree |
| `docs/qa/quick-services-implementation-2026-11-12.md` | This report | Handoff deliverable |

**Not changed:** any route, any API module, `apps/api/**`, schema/migrations, auth, `App.tsx`, other
Home sections, `tokens.css` existing values (only additions), the reference PNG (not added to the repo).

## 4. Behaviour preservation

Verified in a real browser (Playwright, local dev stack: API `:4000`, web `:5373`, dev DB demo farmer
seeded through the app's own login endpoint) by clicking each control and reading the resulting URL:

| Action | Existing behaviour preserved? | Evidence |
|---|---|---|
| এআই কৃষি সহকারী | **Verified** | real click → `/advisor` |
| সেবা | **Verified** | real click → `/services` |
| ফসল বিক্রি | **Verified** | real click → `/sell` |
| নোটিফিকেশন | **Verified** | real click → `/notifications` |
| সব দেখুন | **Verified (decision — §8.1)** | real click → `/services`; there is no all-services route, so the action reuses the only existing services listing rather than inventing a screen |
| Unread indicator | **Verified** | unread=3 → count badge + accessible name `"না পড়া 3 নোটিফিকেশন"`; unread=0 (real dev state) → no badge; failed read → `!` marker + `"আনপড়া সংখ্যা জানা যায়নি"` in the accessible name |
| Back navigation | **Verified** | after each destination, `goBack()` renders the dashboard with all four cards present |

## 5. Visual and accessibility verification

| Check | Result | Evidence / limitation |
|---|---|---|
| Reference composition followed | **Verified** | screenshots at 390 (light, dark) and 1280 (dark): dark forest-green panel, header + pill, 2×2 cards, icon circle → label → chevron |
| PNG is not used as rendered UI | **Verified** | code inspection: no image element, background-image or asset from the handoff; the reference was never copied into the repo |
| Bengali font shaping | **Verified** | Hind Siliguri renders labels incl. conjuncts; labels wrap to two lines intentionally (`এআই কৃষি সহকারী`), no clipping (measured `scrollHeight ≤ clientHeight` on every label) |
| Enlarged font scaling | **Verified (browser proxy)** | root font-size 125% at 390px: no label clipping, cards grow (74→87px); the 8px horizontal overflow measured is the pre-existing top bar, not this section (§8.2). A real Android device/emulator was **not available** — this is the closest obtainable evidence |
| Contrast and visible focus/press state | **Verified** | measured in-browser, composited over the section gradient (worst end): card label **6.71:1**, heading **14.3:1**; focus ring = white `focus-visible:ring-2` on every control (the app's dark-surface convention); press state changes the card surface + `active:scale-[0.99]` |
| Minimum touch target | **Verified** | card heights measured 74–87px; header pill `min-h-[44px]`; chevron is decorative and inside the card target |
| Narrow viewport | **Verified with a documented exception** | 320px: section itself fits, grid collapses to one column via `max-[359px]:grid-cols-1`, no label clipping; the page overflows 22px from the top bar — pre-existing, out of scope (§8.2) |
| Normal viewport | **Verified** | 390px and 1280px: 2×2 preserved, card 159px / 417px wide, no overflow |
| No horizontal overflow/clipping | **Verified for this section** | offender scan at 320/390/390@125%: **zero** overflowing elements inside the section (`inQuickServices: false` on all offenders) |
| Reduced motion behaviour | **Source-verified** | `motion-reduce:transition-none motion-reduce:active:scale-100` on cards and pill; the app's global reduced-motion block also applies. Not exercised with an OS-level preference in this environment |

## 6. Commands and test results

| Command / test | Result | Notes |
|---|---|---|
| `npm run typecheck` | **Pass** | `tsc --noEmit -p tsconfig.json`, no output |
| `npm run lint` | **Pass** | eslint exit 0, 0 warnings (the web budget is 0) |
| `npm run test:unit` | **Pass** | 43 files / **285 tests** (6 new Quick Services tests; 279 before) |
| `npm run i18n:check` | **Pass** | 0 missing keys, **0 inline language ternaries** (hard-zero ratchet held) |
| `npm run build` | **Pass** | built in 16.87s |
| `node scripts/preflight.mjs` | **Pass** | 12/12 checks; images 1861.7/2600 kB; raw-hex ban held; 153 Tailwind classes resolved; no dead classes |
| Manual app test (browser) | **Pass** | Playwright/chromium against the local stack — destinations, badge states, overflow scans, contrast, screenshots (§4, §5) |
| `apps/api` suites | Not run | No API change; the API suite is unaffected by this diff (CI runs it in the same PR) |

## 7. Screenshots / evidence

- **Before:** the pre-redesign tile grid is captured in the earlier audit screenshots on this machine
  (`apps/web/design-review/`, gitignored) — the current section is a light 2×2/4-column tile grid.
- **After (this change, real browser):**
  - `%TEMP%/qs-qa/qs-light-390.png` — light, 390px
  - `%TEMP%/qs-qa/qs-dark-390.png` — dark, 390px
  - `%TEMP%/qs-qa/qs-dark-1280.png` — dark, 1280px
  - `%TEMP%/qs-qa/qs-unread-390.png` — unread=3 badge (intercepted payload)
  - `%TEMP%/qs-qa/qs-unavailable-390.png` — read-failure marker
- **Device / emulator / viewport:** chromium via Playwright, viewports 1280×900 / 390×844 / 320×900;
  no Android device or emulator on this machine.
- **Relevant log output:** dev API log (`%TEMP%/api-dev2.log`) and Vite log clean; no new browser
  console errors during the flows.

## 8. Risks, blockers and unresolved issues

**8.1 `সব দেখুন` has no all-services destination (decision, not a defect).** The repository has no
all-services route, and the handoff forbids inventing one. The header action therefore reuses
`/services`, the only existing services listing — the same destination as the সেবা card. This is the one
judgment call in the implementation: if the owner intends the action to lead elsewhere (a future
services hub), it is a one-line change
(`apps/web/src/features/home/QuickServices.tsx`, the header `Link`'s `to`). The alternative — omitting
the pill — was rejected because the definition of done requires the composition to be recognisably
faithful to the approved reference, which includes the action.

**8.2 Pre-existing defect found during verification, deliberately not fixed.** At ≤320px viewport width
and at 125% root-font scaling the **top bar's** right-hand controls (language chip + logout,
`flex shrink-0 items-center gap-2`) extend past the viewport, producing 22px / 8px of horizontal page
overflow. The offender scan attributes it entirely to the top bar (`inQuickServices: false`); the Quick
Services section itself has zero overflowing elements at every tested configuration, and this diff does
not touch the Shell/top bar. Fixing it would mean changing an unrelated screen, which the handoff
excludes — recorded here for the owner.

**8.3 Two accessibility details worth a native review.** (a) The notifications card's accessible name
reads *"না পড়া 3 নোটিফিকেশন"* (state first, then label) because the icon container precedes the label
in DOM order — understandable and complete, but a native-speaker review may prefer the label first.
(b) Icon-vs-circle contrast, measured from the approved token pairs: AI `#E9FFF2` on `#00B85A` =
**2.51:1**, services `#F0F8FF` on `#087ED0` = **3.99:1**, crop `#FFF3C6` on `#D99A08` = **2.20:1**,
notifications `#E9FFF3` on `#078B4D` = **4.17:1**. Two pairs sit below 3:1. The icons are decorative
(`aria-hidden`) and the adjacent text label carries the meaning, so WCAG 1.4.11 (non-text contrast for
graphics *required to understand* the content) is not engaged — noted anyway because it is a
consequence of the approved palette, and raising the two low pairs is a token-value change the owner
can decide on (darkening the ink or the circle, both one-line edits in `tokens.css`).

**8.4 Not verified in this environment.** A real Android device/emulator run (no device, no
`adb` on this machine — Android builds are CI-only per the repo's own rules); OS-level
"reduce motion" and OS-level large-font settings were approximated in the browser (CSS emulation)
rather than exercised on Android.

## 9. Final declaration

- [x] Existing features and navigation semantics preserved (all five destinations verified by real
      clicks, back navigation verified).
- [x] No unrelated business logic/API/schema changes (diff limited to the five files in §3 plus this
      report; no route, no API module touched).
- [x] All five actions tested (§4) — none left unverified.
- [x] No fabricated verification claims — limitations in §5/§8.4 say what was and was not run.
- [x] Final diff reviewed: no debug UI, no placeholder route, no unused asset, no reference PNG, no
      unused imports left in `Home.tsx` (typecheck + lint would have failed on them).

**Agent conclusion:** The Quick Services section is implemented as real app UI in
`apps/web/src/features/home/QuickServices.tsx`, reusing the exact destinations, the canonical unread
state and the existing theme/icon/typography systems; it matches the approved reference's composition
and palette in both themes and at phone/desktop widths with no overflow attributable to the section,
with measured contrast above AA and the unread state exposed to assistive technology. The single
judgment call (`সব দেখুন` → `/services`) and one pre-existing top-bar overflow are recorded above with
their evidence and the exact place to change them.
