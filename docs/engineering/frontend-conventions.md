# AgroBridge — Frontend Engineering Conventions

**Status:** Verified from source on 2026-11-12 at commit `bf0dc1f5` (branch `docs/release-record-1.4.2`).
**Scope:** `apps/web` only. For API-wide rules, money/time/phone/RBAC domain rules, and ratchets, read
`AGENTS.md` (repo root) — it outranks this document where they overlap on non-web matters.
**Token source of truth:** `docs/design-tokens.md` + `apps/web/src/tokens.css` (+ `dark.css`).
`docs/UI_UX_CONTRACT.md` self-declares as **historical** (Phase 0 visual lock, 2026-09-02) — read it for
background, not as a current merge gate.

Every rule below is enforced by a gate named in §9 or was verified in source. Do not encode anything here
as fact without checking the cited file.

---

## 1. Stack (verified from `apps/web/package.json`)

| Concern | Choice | Version | Note |
|---|---|---|---|
| UI | React | 18.3.1 | |
| Router | react-router-dom | 7.18.2 | declarative `<Routes>` |
| Language | TypeScript (strict) | 5.7.2 | `noUncheckedIndexedAccess` intentionally off |
| Build | Vite | 6.4.5 | ports: dev 5173 `strictPort`, preview 4173 |
| Styling | Tailwind CSS | 3.4.17 | theme maps to CSS custom properties (§4) |
| Motion | framer-motion | 13.1.1 | `LazyMotion` + `m` only (`main.tsx`) |
| Icons | lucide-react | 1.34.0 | |
| Mobile | Capacitor | 8.5.0 | native project committed at `apps/web/android/` |
| Unit tests | Vitest + jsdom | 4.1.12 | `src/**/*.test.{ts,tsx}` |
| E2E | Playwright + @axe-core/playwright | 1.62.1 / 4.13.0 | see §8 |
| Lint | eslint 8.57.1, typescript-eslint 8.68.0, jsx-a11y 6.10.2, react-hooks 4.6.2 | | |

**No state-management or data-fetching library.** No Redux, Zustand, React Query, axios, or SWR — the
pattern is React context + custom hooks (`lib/session.tsx`, `lib/useResource.ts`). Do not introduce one.
No styling framework beyond Tailwind (no shadcn/ui, no CSS-in-JS). No state persistence library beyond
`sessionManager.ts` / `offlineQueue.ts`.

## 2. Routing and shell (`src/App.tsx`)

- One flat route table in `App()` (`App.tsx:352-376`); the only imported route list is `LEGAL_ROUTES`
  (`src/features/legal/routes.ts` → `/privacy`, `/terms`, `/account-deletion`).
- Non-auth pages are `lazy()` imports (`App.tsx:29-43`); `Login` is eager by design (critical path).
- Every app route renders inside `Shell > ErrorBoundary key={pathname} > Suspense > PageTransition`
  (`App.tsx:356-367`). New pages follow the same wrapper order.
- Guards: `Shell` redirects unauthenticated users to `/login` with `from` state (`App.tsx:126`);
  `ReverseGuard` bounces authenticated users off `/login`/`/register`/`/reset` (`App.tsx:81-87`).
- **Role checks live inside the page and fail closed** (pattern: `features/admin-panel/Admin.tsx:39,187`).
  Nav links may hide by role (e.g. `/admin`, `App.tsx:219`) — hiding is UX, not authorization.
- Route paths (verified): `/login`, `/register`, `/reset`, `/`, `/farm`, `/advisor`, `/market`,
  `/services`, `/sell`, `/wallet`, `/notifications`, `/orders`, `/admin`, `/onboarding`, `/settings`,
  legal three, `*` → `NotFound`.

## 3. Data, state, and auth

- **Fetching:** `useResource(key, fetcher, deps)` returns `{ data, loading, refreshing, error, reload,
  setData }` (`lib/useResource.ts:60-71`). `loading` is first-load only; `refreshing` keeps old data on
  screen. Never hand-roll loading/error/retry. After a mutation, call `invalidate(key)`
  (`lib/useResource.ts:36-45`) — there is no query cache to invalidate for you.
- **API client:** `lib/api.ts` — base `import.meta.env.VITE_API_BASE_URL ?? "/api/v1"`; server envelope
  `{ ok, data, error }`; typed `ApiError { status, code, message, details, reference }` (status `0` =
  network/timeout). Retry is **GET-only** on network/5xx, delays `[300, 900]` ms with jitter, `Retry-After`
  honored (cap 10 s). 45 s `AbortController` timeout. Every request carries `X-Request-Id`. Use `api()`,
  `apiRaw()`, or `apiBlob()` — do not use `fetch` directly in features.
- **Tokens:** stored in `localStorage` (`ab_at` / `ab_rt` / `ab_session`) and owned **exclusively** by
  `lib/sessionManager.ts` (cross-tab sync via `BroadcastChannel`). Never touch auth storage directly.
  This is a recorded architecture decision (ADR-0003) — client-side role checks are UX only; the server
  re-reads role from the DB on every request.
- **Session context:** `lib/session.tsx` provides `{ session, loading, dark, refresh, logout, endSession,
  setLang, toggleDark }`. `session.role` is a display/UX value (`Session.role: string`).
- **Offline write queue:** only failed writes while actually offline, allow-listed by
  `lib/offlineQueueRules.ts` — `POST/PATCH/DELETE` on URLs containing `/events`, `/cart`, `/orders`,
  **never `/orders/checkout`**. Entries expire after 72 h, dedupe by `clientUuid` + payload hash, are
  purged on logout/user switch, and replay single-flight on `online`/boot. A new replayable endpoint must
  be added to the allow-list explicitly.
- **Money in the web layer:** `lib/format.ts` — `formatBDT(paisa, lang)`, `takaToPaisa`, `paisaToTaka`
  (`format.ts:57-83`). All money values crossing the wire are integer paisa. (API-side helpers:
  `apps/api/src/lib/money.ts`, `apps/api/src/shared/utils/money.ts`.)

## 4. Design tokens and styling

- **All hex lives only in `src/tokens.css` and `src/dark.css`.** Raw hex in `src/**/*.ts(x)` fails
  `preflight` (one allowlisted `<meta theme-color>` exception). `tokens.css` header states it is the
  single source of truth; `docs/design-tokens.md` documents it.
- Tailwind theme (`tailwind.config.js`) maps every color/radius/shadow/fontSize to `var(--color-*)`,
  `var(--radius-*)`, `var(--shadow-*)`. Legacy palette names (`green`, `emerald`, `amber`, `red`,
  `blue`, `indigo`, `purple`) are **re-pointed aliases to tokens** — prefer the semantic names
  (`brand`, `enterprise`, `surface`, `text`, `action`, status triplets).
- Brand: `brand-700 #15803d` is primary (buttons, nav active); full ramp `brand-50…950` in
  `tokens.css:10-20`. Supporting: `earth #78350f`, `soil-beige #f5f1e8`, `sky #0ea5e9`,
  `ai-indigo #4f46e5`, `warning #f59e0b`, `critical #ef4444`.
- **Dark mode is attribute-based:** `html[data-theme="dark"]` in `dark.css` re-points the entire token
  set; it is not a Tailwind `dark:` variant and contains no `prefers-color-scheme` media query. The OS
  fallback happens in the boot script (`index.html:61-71`) and `session.tsx applyTheme`, persisted as
  `agro_dark_mode`. New colors must define both light and dark values.
- **Fonts:** self-hosted Hind Siliguri (400–700, Bengali+Latin subsets) and Noto Sans Bengali in
  `public/fonts/` (11 woff2, preloaded in `index.html`). Stack: `"Hind Siliguri", "Noto Sans Bengali",
  system-ui, …` (`index.css:138`). No Google Fonts requests. Bangla is the default language and
  `<html lang="bn">` at rest.
- **Motion:** `lib/motion.ts` tokens (durations 0.15/0.25/0.4 s, named easings/springs, press scale
  0.98). Global keyframes `enterprise-enter` (0.5 s) and `agro-shake` live in `tokens.css` with
  `prefers-reduced-motion` kill switches; `main.tsx` wraps the app in `MotionConfig reducedMotion="user"`.
- Type scale has 9 steps (`2xs 10px` … `display 34px`) in `tokens.css:178-196` /
  `tailwind.config.js:206-219`; radius adds `card 20 / button 12 / input 14 / chip 999 / iconBox 14 px`
  (`tokens.css:145-152`).

## 5. Shared components (`src/components/ui.tsx`, ~903 lines)

Available primitives — **reuse before inventing** (exported from `ui.tsx`):
`Spinner`, `Button` (primary/cta/soft/outline/ghost/danger; loading state; 44 px min target),
`IconButton` (requires `aria-label`), `Card` (default/static/subdued), `Label`, `Input`, `Select`,
`Field` (label+control+`role=alert` error with id association), `Badge` (8 tones), `Skeleton`,
`EmptyState`, `ErrorBanner` (`role=alert`, error code + copy button), `BlockError` (error + retry),
`BottomNav` / `Sidebar` (gated by `VITE_FEATURE_NEW_SHELL`), `PageHeader`, `SectionHeader`, `StatTile`,
`ToastProvider`/`useToast` (4 s auto-dismiss; `role=status`/`alert`), `Modal` (portal, focus trap,
Escape, focus restore), `ConfirmProvider`/`useConfirm`, `Stepper`. Also `UiLangProvider`/`useUiLang` for
primitives that own copy.

## 6. UI state contract (enforced pattern)

Every meaningful data-driven surface handles, in this order of preference for reads:

1. **Loading** → `Skeleton` (aria-hidden shimmer), never a blank pane.
2. **Empty** → `EmptyState` (title + action; deliberately no description text).
3. **Error** → `BlockError`/`ErrorBanner` with `onRetry={…reload()}`; field errors are `role="alert"`
   and associated to inputs.
4. **Offline / degraded** → App-level offline banner + queue badge (`App.tsx`, banner at ~244); do not
   fabricate data while offline.
5. **Pending writes** → `Button` loading state / toasts; never a dead or silently-disabled control.

Reference implementations: `features/marketplace/Market.tsx:394-417` (error/skeleton/empty),
`features/farms/MyFarm.tsx:173-179`. Do not display fabricated content as production data.

## 7. Localization (Bangla-first) — hard ratchets

- All copy goes through `lib/i18n.ts`: flat `dict` of `{ bn, en }` entries, `t(key, lang, vars?)`,
  `otherLang(lang)` for toggles (toggle labels name the *target* language).
- `npm run i18n:check` (in `apps/web`) fails on: any `t("key")` missing from the dictionary, unused keys,
  and **any inline `lang === "bn" ? "…" : "…"` string-literal ternary** — hard-zero ratchet; new copy must
  enter `lib/i18n.ts`.
- `session.lang` seeds from `GET /auth/me` `langPref` and persists via `PATCH /auth/me`;
  `document.documentElement.lang` is kept in sync (`session.tsx:149-152`). UI language survives a failed
  persist.
- Long/mixed Bangla content: no truncation without `title`/aria description; design for label-length
  variance between bn/en (see `docs/ui-copy.md`, `docs/glossary-bn-en.md`).

## 8. Testing, a11y, and QA infrastructure

- **Unit:** `vitest run` (jsdom). Coverage ratchet: statements 64 / branches 52 / functions 62 / lines 66
  (`vitest.config.ts:28-39`) — raise-only.
- **E2E (`playwright.config.ts`):** `chromium` = Pixel 5 profile, viewport 390×844, locale `bn-BD`,
  isMobile; `firefox`/`webkit` desktop projects restricted to `farmer-journey` + `settings-account`
  specs. `workers: 1`; baseURL `http://127.0.0.1:5173` (override `PLAYWRIGHT_BASE_URL`); webServer starts
  `vite` on 5173 unless an external URL is provided. Login uses the seeded local test account defined in
  `e2e/a11y.spec.ts` (synthetic data — never real user credentials).
- **A11y (`e2e/a11y.spec.ts`):** AxeBuilder default rules, **no exclusions**, fails on any
  critical/serious violation; scans `/login` (+ failed-submit state), authenticated
  `/`, `/market`, `/wallet`, `/services`, `/orders`, `/sell`, `/settings`, `/notifications`, and the same
  set in dark theme.
- **Lighthouse (`lighthouserc.json`):** a11y ≥ 0.9 (error), performance ≥ 0.7 (warn), FCP ≤ 3000 ms,
  LCP ≤ 5000 ms, TBT ≤ 500 ms, CLS ≤ 0.1 — all `pessimistic` aggregation (preflight asserts the method).
- **`scripts/preflight.mjs` (post-build):** vercel.json header parity; CSP SHA-256 allow-list for inline
  scripts; `connect-src` covers the production API origin; byte budgets (entry ≤ 132 kB gzip, all JS
  ≤ 225 kB, all CSS ≤ 15 kB, fonts ≤ 520 kB, images ≤ 2600 kB); **raw-hex ban**; dead-Tailwind-class ban;
  Lighthouse `pessimistic` check.
- Viewports for manual checks (from the device profile + master spec): 360×800, 390×844, 768×1024,
  1440×900.

## 9. Quality gates — exact commands (from `apps/web/`)

```bash
npm run typecheck        # tsc --noEmit (also covered by root npm run typecheck)
npm run lint             # eslint src --ext .ts,.tsx
npm run test:unit        # vitest run
npm run i18n:check       # key parity + inline-ternary ratchet
npm run build            # tsc --noEmit && vite build
node scripts/preflight.mjs   # after build; CSP + budgets + hex/class bans
npm run test:e2e         # Playwright (needs local API on 4000 + web on 5173, or PLAYWRIGHT_BASE_URL)
```

Root-level structural gates that also apply: `npm run qa:knip`, `npm run qa:jscpd`,
`node scripts/qa/lint-budget.mjs` (web lint-warning budget = **0** — a new warning fails CI),
`node scripts/drift-check.mjs`, `node scripts/qa/link-check.mjs`, `node scripts/qa/claims-check.mjs`.

## 10. Deliberate decisions — do not "fix" (see also root `AGENTS.md` §8)

- **The service worker is a kill switch.** `public/sw.js` unregisters and clears; `VitePWA` is imported
  but deliberately not added to `plugins` (`vite.config.ts`). Do not enable it; raise it as a question.
- No Sentry on web (`ErrorBoundary` uses `console.error`) — known, documented gap.
- Wallet "loadError forever shimmer" is a locked known bug in the historical contract — do not silently
  redesign around it; raise it.
- `.nvmrc` pins Node 22; this machine's ambient Node is 24 — results are disclosed as
  not-transferable per root `AGENTS.md` §2.

## 11. Known documentation drift (verified 2026-11-12; fix the docs when touching these areas)

1. `docs/design-tokens.md:41-42` shadow values differ from `tokens.css:156-157` (md/lg are layered
   green-tinted shadows in code).
2. `docs/design-tokens.md:56` describes dark mode as "swaps stone 50/100/900" + media query; code swaps
   the full token set under `html[data-theme="dark"]` with no media query (`dark.css:12`).
3. `docs/UI_UX_CONTRACT.md:57` surface-bg/border hexes differ from `tokens.css:66,69`.
4. `UI_UX_CONTRACT.md:46` locks `TopBar bg-[#14532d]`; the header is now `agro-header` gradient
   (`App.tsx:164`, `index.css:200-203`) — contract is historical, so this is drift, not a defect.
5. `docs/design-tokens.md:46` Noto range `U+0980-09FF` vs code `U+0980-09FE` (`index.css`).
6. ~~Docs list 6 type steps / partial radii; code has 9 steps and `input 14px` radius.~~ Resolved
   2026-11-13 for typography: the doc's Typography section now carries the full 9-step scale, the
   heading roles, the tracking rules and the numeral policy, matched to `tokens.css`/`index.css`.
   The radii half remains open.
7. `ui.tsx:17` comment cites `src/lib/tokens.ts`, which does not exist (stale comment).
