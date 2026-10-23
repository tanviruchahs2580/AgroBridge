# AgroBridge Frontend Audit — routes, roles, components, baseline

> **Scope:** `apps/web` · **Branch:** `main` @ `2c83e5b` · **Audit date:** 2026-10-22
> **Method:** every claim below was read from the checked-out source, the running app, or a
> command whose exact output is recorded in §7. Nothing here is inferred from the README.
>
> **Relationship to earlier documents.** `docs/UI_UX_CONTRACT.md` is explicitly marked
> historical (it locked the 2026-09-02 pixel surface at `849366f`) and is *not* a merge gate
> any more — the live structural check is `apps/web/e2e/visual-contract.spec.ts`. The current
> token contract is `docs/design-tokens.md`. This audit extends that line rather than replacing
> it; it re-verifies the token layer, the shell, and every route against HEAD.

---

## 1. Stack and constraints (as found)

| Concern | Reality in the checkout |
|---|---|
| Framework | React 18.3 + TypeScript 5.7, Vite 6, SPA (no SSR) |
| Routing | `react-router-dom` 7.18, `BrowserRouter`, all routes declared in `src/App.tsx` |
| Styling | Tailwind 3.4 with **all** colours mapped to CSS custom properties in `tailwind.config.js`; hex lives only in `src/tokens.css` + `src/dark.css` |
| Design tokens | `src/tokens.css` (light) + `src/dark.css` (`html[data-theme="dark"]`), Doc: `docs/design-tokens.md` |
| Motion | `framer-motion` 13.1 — `LazyMotion features={domAnimation}` at the root (`src/main.tsx`), components render `m`; `motion` (full) is confined to lazy route chunks |
| Icons | `lucide-react` only — no emoji, no icon font |
| i18n | Hand-rolled dictionary `src/lib/i18n.ts` (804 lines) + `t(key, lang, vars)`; language lives on the session, not the URL |
| Fonts | Self-hosted Hind Siliguri + Noto Sans Bengali woff2 in `public/fonts/` (offline/APK safe) |
| API client | `src/lib/api.ts` — `BASE = VITE_API_BASE_URL ?? "/api/v1"`, relative by default |
| Data layer | `src/lib/useResource.ts` (in-flight dedupe + `invalidate()`), `src/lib/resourceKeys.ts` for shared keys |
| Offline | `src/lib/offlineQueue.ts` — durable write queue, `clientUuid` idempotency, 72 h replay window |
| Testing | Vitest + jsdom (unit), Playwright (E2E, 3 browser projects, `workers: 1`), `@axe-core/playwright` |
| Dark mode | Real, designed second token set — not a filter |
| Bengali | Primary language (`session.lang` defaults to `bn`); dictionary is bn-first |

**Nothing was added to the dependency tree by this renovation.** The stack above is what was
found; no package was installed.

---

## 2. Route inventory (from `src/App.tsx`, HEAD)

18 routes. Guards are listed as the code declares them — client guards are *navigation*, never
authorization; authorization stays server-side (see `docs/route-role-matrix.md`, which is
machine-generated with its own drift gate).

| # | Route | Component | Guard | Title key | Notes |
|---|---|---|---|---|---|
| 1 | `/login` | `features/auth/Login` | `ReverseGuard` | `login` | **Eager**, critical path. `#phone` + password |
| 2 | `/register` | `features/auth/Register` | `ReverseGuard` | `register` | lazy |
| 3 | `/reset` | `features/auth/Reset` | `ReverseGuard` | `resetTitle` | lazy; forgot → OTP → reset |
| 4 | `/` | `features/home/Home` | `Shell` | `home` | dashboard: farm readiness, weather, tasks, crops, alerts |
| 5 | `/farm` | `features/farms/MyFarm` | `Shell` | `myFarm` | farm/plot/crop forms, stage-aware care |
| 6 | `/advisor` | `features/advisor/Advisor` | `Shell` | `aiAgent` | AI chat + disease-photo intake |
| 7 | `/market` | `features/marketplace/Market` | `Shell` | `market` | catalog → cart → checkout → payment intent |
| 8 | `/services` | `features/services/Services` | `Shell` | `services` | listings, booking lifecycle |
| 9 | `/sell` | `features/sell-crop/SellCrop` | `Shell` | `sellCrop` | procurement offer |
| 10 | `/wallet` | `features/wallet/Wallet` | `Shell` | `wallet` | summary, transactions, withdrawal, membership |
| 11 | `/notifications` | `features/notifications/Notifications` | `Shell` | `notifications` | list + preferences |
| 12 | `/orders` | `features/orders/MyOrders` | `Shell` | `myOrders` | order history + cancel |
| 13 | `/admin` | `features/admin-panel/Admin` | `Shell` + UI role check | `admin` | metrics, users, audit, withdrawals |
| 14 | `/onboarding` | `features/onboarding/Onboarding` | `Shell` | `onboarding` | district → area → first farm |
| 15 | `/settings` | `features/settings/Settings` | `Shell` | `settings` | profile, OTP verify, data export, delete account |
| 16 | `/privacy` | `features/legal/Legal` (`docId="privacy"`) | **public by design** | `privacyPolicy` | Play requires a public URL |
| 17 | `/terms` | `features/legal/Legal` (`docId="terms"`) | **public by design** | `termsOfService` | |
| 18 | `/account-deletion` | `features/legal/Legal` (`docId="deletion"`) | **public by design** | `dataDeletionInfo` | |
| 19 | `*` | `NotFound` (in `App.tsx`) | public | `notFoundTitle` | `Compass` + back-home CTA |

**Shell composition** (`App.tsx:115-238`): skip link → sticky `agro-header` (brand mark, settings,
theme toggle, `EN/বাং`, admin link for `ADMIN`/`SUPER_ADMIN`, logout) → `TopBar` → offline banner →
`Sidebar` (md+) + `main#main` → fixed `BottomNav` (mobile).

**Per-route wrappers:** `ErrorBoundary key={pathname}` so a crash on one route cannot persist to
the next; `Suspense fallback={<PageFallback/>}`; `PageTransition` on every route.

### Layout variant of the sign-in screens

`/login`, `/register`, `/reset` render through `features/auth/AuthShell` — a photo-backed panel on
`md+` and a full-bleed photo with a dark-glass credential panel below `md` (the scoped
`.auth-photo-mobile` skin in `src/index.css:225-268`). These are intentionally *not* wrapped in
`Shell`, so they carry no sidebar/bottom nav.

---

## 3. Screen → API action map (grep of `api(...)` call sites)

| Screen | Reads | Writes |
|---|---|---|
| Home | `GET /farms`, `GET /notifications`, `GET /weather` | — (read-only dashboard) |
| MyFarm | `GET /farms`, `GET /weather` | `POST /farms`, `POST /farms/:id/plots`, `POST /farms/crops` |
| Advisor | `GET /ai/history`, `GET /disease/cases` | `POST /ai/advisory`, `POST /disease/cases`, `POST /ai/history/:id/feedback` |
| Market | `GET /products`, `GET /cart`, `GET /auth/me` | `POST /cart/items`, `DELETE /cart/items/:id`, `POST /orders/checkout`, `POST /payments/intent`, `POST /payments/:id/confirm` |
| Services | `GET /services`, `GET /bookings`, `GET /farms` | `POST /bookings`, `POST /bookings/:id/status` |
| SellCrop | `GET /farms`, `GET /procurement` | `POST /procurement/offers` |
| Wallet | `GET /wallet`, `GET /wallet/summary`, `GET /wallet/withdrawals`, `GET /payments`, `GET /membership/plans` | `POST /wallet/withdrawals`, `POST /payments/intent`, `POST /payments/:id/confirm` |
| Notifications | `GET /notifications`, `GET /notifications/preferences` | `POST /notifications/read`, `PATCH /notifications/preferences` |
| MyOrders | `GET /orders` | `DELETE /orders/:id` |
| Admin | `GET /admin/analytics/summary`, `GET /admin/audit-logs`, `GET /admin/ai-usage`, `GET /admin/users`, `GET /admin/withdrawals` | `PATCH /admin/users/:id`, `POST /admin/withdrawals/:id/decision` |
| Settings | `GET /auth/me` | `PATCH /auth/me`, `POST /auth/otp/request`, `POST /auth/otp/verify`, `DELETE /auth/me`, `GET /auth/me/export` |
| Onboarding | — | `POST /farms` |
| Legal | — (static content in `features/legal/content.ts`) | — |

---

## 4. Shared component inventory (`src/components/`)

| Component | File | Role |
|---|---|---|
| `Button`, `IconButton` | `ui.tsx` | 6 variants × 3 sizes; 44 px min target; the disabled treatment is a muted *token* surface (not `opacity-50`) so AA contrast holds |
| `Card` | `ui.tsx` | `default` (hover lift) / `static` / `subdued`, `padded` opt-out |
| `Label`, `Input`, `Select`, `Field` | `ui.tsx` | The house form pattern; `Input`/`Select` shake on `aria-invalid` |
| `Badge` | `ui.tsx` | 8 semantic tones |
| `Skeleton` | `ui.tsx` | `.skeleton-shimmer`, `aria-hidden` |
| `EmptyState`, `ErrorBanner` | `ui.tsx` | Empty/error house patterns; `ErrorBanner` has `role="alert"` + copy-to-clipboard |
| `BottomNav`, `Sidebar` | `ui.tsx` | Responsive navigation; both honour `VITE_FEATURE_NEW_SHELL === "false"` |
| `PageHeader`, `SectionHeader`, `StatTile` | `ui.tsx` | Page/section/metric furniture |
| `ToastProvider` / `useToast` | `ui.tsx` | `aria-live` region, 3 max, 4 s (6 s error), swipe-to-dismiss |
| `Modal` | `ui.tsx` | Portal + focus trap + scroll lock + Escape + focus restore |
| `ConfirmProvider` / `useConfirm` | `ui.tsx` | Promise-based confirm dialog |
| `Stepper` | `ui.tsx` | Booking/checkout progress |
| `useDialogA11y` | `ui.tsx` | Shared dialog behaviour; inerts `#main`, `header`, `nav[aria-label]`, `aside` |
| `Spinner`, `getFocusable` | `ui.tsx` | Loading + focus utilities |
| `ErrorBoundary` | `ErrorBoundary.tsx` | Per-route crash containment |
| `PageTransition`, `Splash`, `TopBar` | components | Motion wrapper, cold-start splash, legacy top bar |
| `ServiceCard`, `ServiceCardSkeleton` | `service/ServiceCard.tsx` | Services grid card |
| `AgriIcons` (`RiceEarMedallion`, `AgriIconBox`) | `icons/AgriIcons.tsx` | Brand/agricultural iconography |

Deliberately **absent** (and not to be invented): no charting library (there are no charts to
render — metrics are numeric tiles backed by real API responses), no date library (`Intl` is used),
no table abstraction (there are no `<table>` data grids; list rows are used instead), no
state-management library (`useResource` + React state covers the write paths).

---

## 5. Design-token and dependency inventory (verified, not assumed)

**Token sources — exactly two, and they must stay in sync:**

- `src/tokens.css` — light set. Brand 50–950, stone 50–900, enterprise supporting colours
  (earth/soil/sky/ai-indigo/warning/critical), surface system, semantic text, status triplets
  (danger/success/info/warning × bg/border/text), action/link/accent, gradients, glass, spacing
  (4/8 pt), radius, elevation, focus ring, type scale.
- `src/dark.css` — `html[data-theme="dark"]` re-points every semantic token; `prefers-color-scheme`
  mirrors when no explicit choice is stored.

**Tailwind mapping (`tailwind.config.js`)** — the important, easily-missed part: the *default*
palette names (`green`, `emerald`, `amber`, `red`, `blue`, `sky`, `indigo`, `purple`, `orange`) are
re-pointed at the tokens so pre-existing utility classes are dark-aware. That means
`text-green-700` is legal here while `text-lime-600` would silently be a raw Tailwind colour and
break in dark mode.

**Type scale (7 steps):** `xs 11/16` · `sm 13/18` · `base 16/24` · `lg 18/28` · `xl 20/28` ·
`2xl 28/36` · `display 34/44`.

**Motion tokens (`src/lib/motion.ts`):** duration `fast .15 / normal .25 / slow .4`; ease
`enter [.16,1,.3,1] / exit [.4,0,1,1] / emphasis [.2,0,0,1]`; springs `snappy/gentle/soft`;
press scale `.98`. `MotionConfig reducedMotion="user"` at the root, `prefers-reduced-motion`
global CSS guard in `index.css:206-215`.

**Reused animation primitives:** `.animate-enterprise` (10 px rise + fade, 0.5 s), `.animate-shake`
(validation), `.animate-success-pulse` — all three switched off under `prefers-reduced-motion`.

---

## 6. Known gaps carried into this renovation

These were true at HEAD *before* any edit in this change set, and are stated here so later
verification cannot confuse them with regressions:

1. `apps/api/.env.local` in the working tree points `DATABASE_URL` at a live Neon PostgreSQL
   instance. It is git-ignored (`apps/api/.gitignore`), so nothing leaks through Git, and the API
   only loads `.env` (`dotenv/config`), so a plain `npm run dev` uses SQLite. It is still a
   foot-gun: any tool that *does* read `.env.local` would talk to production. Not changed here.
2. `apps/api/prisma/dev.db` is stale — it predates the `20261019140000_login_attempt_throttle`
   migration, so signing in against it fails with `The table main.LoginAttempt does not exist`.
   This is why verification below uses a freshly migrated `verify.db`.
3. The legacy `components/TopBar.tsx` still renders under the header on every authenticated route.
   It duplicates navigation already present in the header + `Sidebar` + `BottomNav`.

---

## 7. Baseline record (before any edit)

Environment: Windows 10, Node (`.nvmrc`), npm workspaces. All commands run from the repo root
unless stated.

| # | Command | Result | Evidence |
|---|---|---|---|
| B1 | `git status --short --branch` | clean tree, `## main...origin/main` | no local changes existed at start |
| B2 | `npm run typecheck --workspace apps/web` | **PASS** (exit 0) | `tsc --noEmit -p tsconfig.json` |
| B3 | `npm run test --workspace apps/web` | **PASS** — 19 files, 181 tests, 0 failures, 75.65 s | Vitest 3.2.7 |
| B4 | `npm run build --workspace apps/web` | **PASS** (exit 0), built in 25.02 s | see chunk table |
| B5 | `curl -s -X POST :4000/api/v1/auth/login` (demo farmer) | **PASS** after fresh DB | `{"ok":true,...}` |
| B6 | `npx playwright test` | recorded in `verification-report.md` | run against the local stack |

**Baseline production-build chunks (B4), gzip in parentheses:**

| Chunk | Size |
|---|---|
| `index-*.js` (entry) | 423.75 kB (134.38 kB) |
| `Services-*.js` | **73.93 kB (21.04 kB)** |
| `Legal-*.js` | 29.75 kB (9.19 kB) |
| `Home-*.js` | 22.95 kB (5.43 kB) |
| `MyFarm-*.js` | 17.40 kB (4.69 kB) |
| `Market-*.js` | 15.96 kB (5.29 kB) |
| `Settings-*.js` | 12.29 kB (3.90 kB) |
| `Wallet-*.js` | 12.07 kB (4.04 kB) |
| `Admin-*.js` | 11.64 kB (3.68 kB) |
| `Advisor-*.js` | 9.89 kB (3.94 kB) |
| `Notifications-*.js` | 8.38 kB (3.15 kB) |
| `MyOrders-*.js` | 7.17 kB (2.54 kB) |
| `SellCrop-*.js` | 6.14 kB (2.27 kB) |
| `Onboarding-*.js` | 3.04 kB (1.16 kB) |

`Services-*.js` is 3–4× every other route chunk. §8.1 explains why and whether it is a defect.

No pre-existing test failures were observed. There is therefore no "pre-existing failure"
allow-list for this change set: any red below is a regression.

---

## 8. Findings

Severity is judged against WCAG 2.2 AA, the product's own stated contract (docs), and real user
impact. Each finding names the file and line at HEAD so it can be re-checked independently.

### 8.1 Tailwind classes that emit **no CSS at all** (P1 — verified, styling silently missing)

A class that does not exist in `tailwind.config.js` produces no rule, so the element renders
**unstyled** and the build stays green. `apps/web/scripts/audit-dead-classes.mjs` (added by this
change set) cross-references every class token in `src/` against the compiled CSS. Result at HEAD,
reproducible with `node scripts/audit-dead-classes.mjs`:

```
class tokens checked: 165 | emitting no CSS: 3
  bg-warning                <- features/home/Home.tsx
  bg-surface-card-subdued   <- features/advisor/Advisor.tsx, features/home/Home.tsx
  decoration-link/40        <- features/legal/Legal.tsx
```

Confirmed individually with `node scripts/audit-dead-classes.mjs <class>…`:

| Class | Sites | Effect |
|---|---|---|
| `bg-surface-card-subdued` | `Home.tsx:190,263,267,279,290,387`; `Advisor.tsx:331` | The card header strips, the humidity/wind tiles, the favourability strip and the history rows have **no background** — they read as floating text with a border. The intended token is `bg-surface-subdued` (`tailwind.config.js` maps `surface.subdued`, so `bg-surface-card-subdued` is a name that never existed). |
| `bg-warning` | `Home.tsx:147` | The "farm readiness" risk dot is transparent, so the indicator **disappears exactly when there is a risk** (`hasRisk`). The `warning` group only defines `bg`/`border`/`text` keys, so `bg-warning` has no rule; the sibling usage at `Home.tsx:376` already uses `bg-enterprise-warning`. |
| `decoration-link/40` | `Legal.tsx:32` | The link underline gets no colour. `link` is mapped as a bare `var(--color-link)`, and an opacity modifier needs the `<alpha-value>` placeholder, so `/40` cannot resolve. |

Grep-based checks are not sufficient here and were misled twice during this audit (`.bg-warning-bg`
matches a loose `bg-warning` search; `.bg-white\/10` is escaped in the output CSS so `grep "bg-white/10"`
misses it). The script above is the reliable method and is the reason it is committed.

### 8.2 `Field` error text is not associated with its control (P1, accessibility)

`src/components/ui.tsx:258-262` renders the error paragraph with no `id`:

```tsx
{error && <p role="alert" className="mt-1 text-xs font-medium text-danger-text">{error}</p>}
```

Thirteen call sites set `aria-describedby` to a `<field-id>-err` element that does not exist:
`Login.tsx:90,108`, `Register.tsx:94,108,126`, `Reset.tsx:117,146,161`,
`SellCrop.tsx:119,127,135,139`. The announcement still happens (`role="alert"`), but the
field → error association WCAG 2.2 AA expects is broken, and the `aria-describedby` attribute
silently points at nothing. Every one of those sites follows the identical
`htmlFor="X"` + `aria-describedby="X-err"` convention, which means the fix belongs in the
primitive, not in thirteen places.

Three further error paragraphs bypass `Field` and are equally unassociated:
`Services.tsx:454` (schedule date), `Services.tsx:467` (area), `MyFarm.tsx:189` (farm name) —
each sets `aria-invalid` on the input but no `aria-describedby`, and the paragraph has no `id`.

### 8.3 Primitives ship English-only copy into Bengali screens (P1, localization)

| Primitive | Default | Consequence |
|---|---|---|
| `ErrorBanner` | `copyLabel = "Copy"`, `copiedLabel = "Copied!"` (`ui.tsx:313-314`) | 14 call sites omit the labels, so a Bengali user gets an English button on the error banner. The dictionary keys exist (`errCopy` / `errCopied`, `i18n.ts:314-315`) and are passed by only `Login`, `Register`, `Reset`. |
| `Modal` | `closeLabel = "Close"` (`ui.tsx:604`) | `Market.tsx:420-423` and `Wallet.tsx:340` build dialogs without it, so those close buttons are labelled and titled "Close". |
| `BottomNav` badge | `<span className="sr-only"> new notifications</span>` (`ui.tsx:378`) | Wrong text *and* unreachable: it sits inside the `aria-hidden` icon span, so AT gets no badge information at all. The only badge call site is the **wallet** tab for queued offline writes (`App.tsx:144`), so the text is also factually wrong about what the badge means. |
| `Sidebar` | no `aria-label` (`ui.tsx:392`) | Two unlabelled/labelled `nav` landmarks; the bottom nav has a label, the sidebar does not, so they cannot be told apart. |

### 8.4 Structural duplication in shared patterns (P2, consistency)

- **`BlockError` is copy-pasted nine times** with identical bodies
  (`Admin.tsx:22-30`, `Advisor.tsx:44-52`, `MyFarm.tsx:33-41`, `Market.tsx:80-88`,
  `Notifications.tsx:75-83`, `MyOrders.tsx:36-44`, `Services.tsx:47-55`, `SellCrop.tsx:30-38`,
  `Wallet.tsx:24-32`). Nine copies of "ErrorBanner + Retry button" is nine places to fix the next
  time the retry affordance changes.
- **`careColor` (`MyFarm.tsx:22-26`) and `careToneClass` (`Home.tsx:55-59`) are byte-identical
  tone→class maps** in two files; `lib/labels.ts` already owns the tone vocabulary.
- **`CROPS` is defined twice** — `MyFarm.tsx:18-19` (local) and `SellCrop.tsx:18` (local, importing
  `CROP_KEYS` from `lib/labels` even though `labels.ts` also exports the list).
- **Filter chips are re-implemented five times** with three different recipes: `Market.tsx:338-351`,
  `Notifications.tsx:196-212`, `MyOrders.tsx:111-124`, `Services.tsx:242-252`, `Legal.tsx:89-101`.
- **Primitives bypassed by hand-copied class strings**: `Services.tsx:228-236` re-types `Input`'s
  spec on a raw `<input type="search">`; `Services.tsx:255-264` re-types `Select`;
  `Advisor.tsx:371-378` re-types `Input` on the app's only `<textarea>`;
  `ServiceCard.tsx:148-161` re-types two `Button` variants; `ServiceCard.tsx:168-187` hand-writes
  eight shimmer divs instead of using `Skeleton`; `Settings.tsx:284,324,346,365,410` hand-roll a
  `Loader2` spinner instead of the `Button loading` prop.
- **`stone-50` replaces the `surface-subdued` token** for identical "quiet panel" roles in
  `Market.tsx:536,556`, `Admin.tsx:360,381`, `Notifications.tsx:229`, `Advisor.tsx:227`,
  `MyOrders.tsx:200` — three different radii/tones for one job.

### 8.5 Type scale has holes that call sites fill with arbitrary values (P2, consistency)

`tailwind.config.js` defines 7 type steps, but components reach outside them:

| Arbitrary class | Occurrences | Files |
|---|---|---|
| `text-[15px]` | 4 | `Home.tsx` ×3, `Admin.tsx` |
| `text-[22px]` | 3 | `Home.tsx`, `Notifications.tsx`, `AuthShell.tsx` |
| `text-[18px]` | 3 | `AuthShell.tsx` ×3, `ui.tsx` nav icons |
| `text-[11px]` | 3 | `Advisor.tsx` ×2, `Home.tsx` |
| `text-[10px]` | 3 | `Home.tsx` ×2, `MyOrders.tsx` |
| `text-[26px]` | 1 | `Splash.tsx` |
| `text-[17px]` | 1 | `Home.tsx` (the `<h1>`) |
| `text-[12.5px]` | 1 | `AuthShell.tsx` |

The consequence is visible as broken hierarchy, not just untidy classes: page `<h1>` sizes differ
per screen — `Home` 17 px, `MyOrders`/`Legal`/`PageHeader` 20 px, `Services` 28 px. `text-[10px]`
and `text-[12.5px]` sit outside any documented step, which means a reviewer cannot tell whether
they are deliberate.

### 8.6 Wrong ARIA and unannounced state (P1/P2, accessibility)

| Finding | Location | Why it matters |
|---|---|---|
| `Modal` focus trap is gated on *closability*, not on being open | `ui.tsx:608` — `useDialogA11y(Boolean(onClose), onClose)` | `Market.tsx:422` passes `onClose={step === SUCCESS_STEP ? closeWizard : undefined}`, so checkout steps 0–3 render `role="dialog" aria-modal="true"` with **no focus trap, no initial focus, no focus restore** — the background header/nav stay reachable behind a modal. |
| `role="button"` on a `Card` that contains buttons and a form | `MyFarm.tsx:276-291` | Children of `role="button"` are presentational, so the nested `Button`s and inputs are invalid inside it. |
| File input is `display:none` | `Advisor.tsx:197-199` (`className="hidden"`) | The disease-photo upload cannot be reached or activated by keyboard at all. |
| Unread notifications conveyed by tint only | `Notifications.tsx:264` | No text/icon/visually-hidden "unread" — colour-only status (WCAG 1.4.1). |
| Nested live regions | `App.tsx:223-228`, `ui.tsx:543` + `552-553`, `Wallet.tsx:369` | The same message can be announced twice, and `Wallet.tsx:369` nests `role="alert"` inside `role="alert"`. |
| `Splash` `aria-label` on a roleless `div` | `Splash.tsx:125` | The attribute is ignored, so the intended accessible name does not exist. |
| Splash's live region is English-only | `Splash.tsx:248` | `Loading {n} percent — {status}` on a bn-first app. |
| Nested `<main>` when the boundary catches | `ErrorBoundary.tsx:33` + `App.tsx:233` | Two `main` landmarks. |
| Failed advisory rendered as an AI answer bubble | `Advisor.tsx:128` | A network failure is presented with the same visual grammar as a real answer, in a product whose whole premise is not presenting unverified output as truth. |
| `<th>` without `scope` | `Admin.tsx:245-251` (7 cells) | Header-to-cell association depends on AT heuristics in the users table. |
| Heading level gaps | `Onboarding.tsx` (no `h1`, four `h2`s), `MyFarm.tsx:147` (detail view starts at `h2`), `Advisor.tsx:224`, `MyOrders.tsx:202`, `Market.tsx:390` (`h3` under `h1`), `EmptyState` hardcodes `h3` (`ui.tsx:303`) | Document outline is not navigable by level. |
| Touch targets below 44 px | `ui.tsx:137` (`Button size="sm"` = 36 px, used in `Admin`, `Notifications`, `Advisor`, `MyFarm`), `Notifications.tsx:51` (28 px switch), `Onboarding.tsx:65`, `Reset.tsx:178`, `Advisor.tsx:344`, `Home.tsx:159,335`, `Services.tsx:184`, `MyFarm.tsx:145` | Sub-44 px targets on a touch-first farmer app. |

### 8.7 `Services` route chunk carries the full framer-motion engine (P3, documented trade-off)

`src/features/services/Services.tsx:2` and `src/components/service/ServiceCard.tsx:1` import
`motion` from `framer-motion`, while every module on the entry path renders `m` under the root
`LazyMotion`. `ServiceCard` uses `layout` + `whileHover` + `whileTap`.

Measured effect (B4): the `Services` chunk is 73.93 kB raw / 21.04 kB gzip — 3–4× every other route
chunk. The built file contains framer-motion's layout-projection internals
(`attachResizeListener`, `checkIsScrollRoot`, `layoutVersion`, `removeRelativeTarget`).

Assessment: the *placement* is correct and deliberate (the entry bundle is protected; only the
route that needs layout animation pays). The narrower issue is that `layout` requires
framer-motion's `domMax` feature set, which `main.tsx:30` deliberately does not load
(`domAnimation`) — so the bytes are paid for a capability that is not actually active. This is
recorded as an open item (§9) rather than silently changed, because both directions have a real
cost.

### 8.8 Localized-string gaps (P2, localization)

| Finding | Location |
|---|---|
| "AgroBridge" hardcoded while neighbouring lines use `t()` | `AuthShell.tsx:156` (dict has `appName`, used at `:118`) |
| Language self-names as raw literals in two pickers | `Register.tsx:145`, `Settings.tsx:294-295` |
| Raw crop enum leaks into the Bengali UI where `cropLabel` exists | `Home.tsx:299` (`{primaryCrop.cropName}`; the same file uses `cropLabel(task.cropName, lang)` at `:209`) |
| Raw role enum rendered | `Onboarding.tsx:75` (`{session?.role}`; `roleLabel` exists in `lib/labels.ts:102`) |
| Service counts hardcoded in marketing cards, duplicating `FILTER_MAP` | `Services.tsx:194,199,204` |
| Toast copy prefixes `✅` although `ToastProvider` already renders a `Check` icon | `i18n.ts` (`queueSyncedToastOne/Many`) |

---

## 9. Deliberately **not** changed (and why)

| Item | Reason |
|---|---|
| `Services`/`ServiceCard` `motion` import (§8.1) | `layout` needs `domMax`; loading `domMax` at the root would move ~20 kB gzip onto the entry path that every user pays, to fix a route that only some users open. The current trade-off is the smaller total. Recorded as a follow-up rather than "fixed" by making the entry bundle worse. |
| `apps/api/**`, Prisma schema, migrations | Out of scope by contract; this is a frontend renovation. |
| `api()` call sites, request/response shapes | Treat as frozen contract boundaries. |
| `components/TopBar.tsx` | Removing it is a navigation/IA change with no evidence it is unused; `VITE_FEATURE_NEW_SHELL` already gates the newer shell, so the flag path must keep working. |
| `docs/UI_UX_CONTRACT.md` | Historical document, explicitly superseded; preserved as-is. |
