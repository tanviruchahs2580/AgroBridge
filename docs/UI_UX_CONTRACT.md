# UI/UX Contract — Locked Visual Surface

**Effective from:** 2026-09-02 (Phase 0)
**Applies to commit:** `849366f` (HEAD)
**Rule:** Nothing the user sees, touches, or experiences may change. Any PR touching `apps/web` must attach a pixel-diff report; non-zero diff blocks merge unless page is on allow-list and declared.

## 1. Locked Routes (default: LOCKED unless on allow-list)

| Route | File | Layout Locked | Notes |
|---|---|---|---|
| `/login` | `apps/web/src/pages/Login.tsx` | **LOCKED** | Eager loaded (`App.tsx:18`), `+880` phone + password, `Demo` hint, no Google/FB (easy farmer) |
| `/register` | `apps/web/src/pages/Register.tsx` | **LOCKED** | Lazy, phone+password+confirm |
| `/` | `apps/web/src/pages/Home.tsx` | **LOCKED** | Hero `87%` + 4-card grid + `AI Ask` + `দ্রুত সেবা` 4 + `Smart Alerts` — not `28°C` complex (see `v1.2.0-easy-dashboard` revert base) |
| `/farm` | `apps/web/src/pages/MyFarm.tsx` | **LOCKED** | Farm/plot/crop forms, `Tractor` header, addFarm CTA |
| `/market` | `apps/web/src/pages/Market.tsx` | **LOCKED** | Product grid, cart modal, checkout wizard |
| `/sell` | `apps/web/src/pages/SellCrop.tsx` | **LOCKED** | Grade select, moisture, price calc |
| `/services` | `apps/web/src/pages/Services.tsx` | **LOCKED** | `ServiceCard` hero 148px + floating IconBox 40px + `Popular/New` + `Verified` + `⭐4.9` + price tabular + dual CTA, search + chips `সব/যন্ত্রপাতি/পরামর্শ/পরীক্ষা` |
| `/advisor` | `apps/web/src/pages/Advisor.tsx` | **LOCKED** | Chat + compress/upload |
| `/wallet` | `apps/web/src/pages/Wallet.tsx` | **LOCKED** | Summary + monthly cards + skeleton |
| `/notifications` | `apps/web/src/pages/Notifications.tsx` | **LOCKED** | Tablist `role=tab` (known a11y gap, but visual locked) |
| `/admin` | `apps/web/src/pages/Admin.tsx` | **LOCKED** | Breadcrumb `Home`, admin tables |
| `/onboarding` | `apps/web/src/pages/Onboarding.tsx` | **LOCKED** | Feature-flag `VITE_FEATURE_ONBOARDING` |
| `*` | `App.tsx:82 NotFound` | **LOCKED** | `Compass` + `notFoundTitle` + `backHome` |

**Router:** `App.tsx:245-258` — `ReverseGuard` for `/login|/register`, `Shell` for all authenticated routes, `Suspense fallback PageFallback` (`Skeleton`), `ErrorBoundary key={pathname}` per route, `PageTransition` only on `/services`.

**Splash:** `components/Splash.tsx` native `colors.xml #0A2F1F` + React overlay `from-[#0A2F1F] via-[#1A4A32] to-[#2E7D4F]` seed→stem→leaves — locked.

## 2. Shared Components — Fixed Behavior Contract

| Component | File | Contract |
|---|---|---|
| `TopBar` | `components/TopBar.tsx` | `bg-[#14532d]` header, `🌾` + `appName`, lang toggle `EN/বাং`, admin link, logout — spacing/color locked |
| `BottomNav` / `Sidebar` | `components/ui.tsx:214` | `primaryNav` 5 + `secondaryNav` 3, `BottomNav` `aria-current` (known `undefined` gap — locked), `Sidebar` md+ |
| `Skeleton` / `ErrorBanner` / `EmptyState` | `ui.tsx` | House pattern every page: `Skeleton` → `ErrorBanner role=alert` → `EmptyState` — retry copy locked |
| `PageTransition` / `motion` | `components/PageTransition.tsx`, `lib/motion.ts` | `MotionConfig` + `enterprise-enter 0.5s` + `agro-shake` — durations locked, `prefers-reduced-motion` disables |
| `Offline banner` | `App.tsx:162` | `bg-amber-100` + `queued` count — text `offlineBanner` locked |
| `Toast` / `Confirm` | `ui.tsx:298` `aria-live polite` | 4s auto-dismiss — locked |

## 3. Design Tokens — Immutable (single source `tokens.css:5`)

- **Brand 50–950:** `50 #f0fdf4` … `700 #15803d` (primary) … `950 #052e16` (`--color-brand-*`)
- **Stone 50–900:** `50 #fafaf9` … `900 #1c1917`
- **Supporting:** `earth #78350f`, `soil-beige #f5f1e8`, `sky #0ea5e9`, `ai-indigo #4f46e5`, `warning #f59e0b`, `critical #ef4444`, `surface-bg #f8faf5/card #fff/border #e7e5e4`
- **Semantic text:** `primary #1A1F1C / secondary #57534E / tertiary #78716C / muted #A8A29E`
- **Spacing:** 4/8pt grid `space-1 0.25rem` … `space-8 2rem`
- **Radius:** `lg 0.5rem / xl 0.75 / 2xl 1 / card 20px / button 12px / chip 999px / iconBox 14px`
- **Shadow:** `sm/md/lg/card/cardHover/button` per `tokens.css:92`
- **Type scale:** `xs 11/16 / sm 13/18 / base 16/24 / lg 18/28 / xl 20/28 / 2xl 28/36` (`tailwind.config.js:84`)
- **Manifest:** `theme #166534 / bg #fafaf9` (`vite.config.ts:35-36`) — PWA splash stays `#fafaf9` (native splash is separate `#0A2F1F`)

All hex lives ONLY in `tokens.css`/`tailwind.config.js` per contract; exceptions (`bg-[#15803D]` in `TopBar.tsx:25`) are grandfathered and locked.

## 4. Immutable User Flows

- **Auth:** `Login → session → ReverseGuard bounce` (`App.tsx:64`), `Register → Login`, `OTP none` (SMS mock) — copy/flow locked even though OTP delivery is known gap (Phase 4, not UI)
- **Checkout/Payment:** `Market addToCart → cart modal (onClose only on success step) → checkout → shipping (optional) → order UNPAID → POST /payment/intent → confirm/webhook → SETTLED` — texts locked
- **Farm creation:** `MyFarm addFarm → farm → plot → cropCycle → stage` — forms locked
- **Service booking:** `Services → ServiceCard → booking → assign → status` — `› /farm` anchors are locked (even though they bypass router — locked behavior)
- **Wallet:** `summary skeleton → loadError forever shimmer` is current locked behavior (known bug, but visual locked — fix requires contract exception)

## 5. Allow-List (MAY change — Phase 0: empty)

> Default is locked. This list is intentionally near-empty at Phase 0. Items added here require explicit sign-off and must declare expected pixel diff in PR description.

- *(none)* — all 12 routes locked
- Docs-only changes (`docs/**`, `*.md`) are exempt (no visual output)
- Backend/infra-only (`apps/api/**`, `docker/**`, `.github/workflows/**`, `monitoring/**`) exempt but must leave `apps/web/dist` byte-identical — verified via `vite build` hash after any shared-type change

## 6. Verification Rule

- Before any `apps/web` change: `npx playwright test --update-snapshots` baseline exists for 8 pages (Home/Login/Register/My Farm/Market/Services/Notifications/Admin) — stored under `apps/web/e2e/__screenshots__`
- CI gate: `apps/web` PR → attach `playwright-report` pixel-diff; non-zero → block merge unless allow-listed
- Shared contract change (e.g., Zod schema in `packages/contracts`) → re-run `Web TypeCheck·Build` + baselines, confirm `dist` hash unchanged or diff declared

*If unsure whether a change is backend or UI — treat as UI and stop for confirmation (§1).*
