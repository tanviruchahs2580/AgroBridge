# Feature Preservation Matrix

> **Change set:** the 2026-10-22 UI/UX renovation (`docs/ui-ux-renovation/audit.md`)
> **Baseline:** `main` @ `2c83e5b` · **Rule applied:** no route, role, action, API
> contract or domain invariant was removed, renamed or replaced.
>
> **Status vocabulary** (identical to §15.2 of the master prompt):
> `PRESERVED` — behaviour verified unchanged after the change;
> `PRESERVED (fixed)` — behaviour preserved *and* a defect in it repaired;
> `NOT RUN` — not exercised in this change set, with the reason stated.
>
> **Honesty note.** `PRESERVED` here means the action still exists with the same
> contract and the same request/response shape, and that the screens rendering it
> were exercised. It does **not** mean every write path was executed end-to-end
> against the API in this change set — the rows say which ones were (see the
> *Evidence* column and `verification-report.md` §Commands).

## How to read the evidence column

| Evidence token | Meaning |
|---|---|
| `E2E:farmer-journey` | exercised by `apps/web/e2e/farmer-journey.spec.ts` in the final run |
| `E2E:visual-contract` | route renders, no overflow, no error boundary — 8 critical pages × light/dark/360px |
| `E2E:<spec>` | the named spec in `apps/web/e2e/` |
| `UNIT:<file>` | the named Vitest file |
| `PREFLIGHT` | `npm run preflight --workspace apps/web` (built artifacts) |
| `GREP:<file>` | source-level proof that the call site is unchanged |
| `NOT RUN` | named reason |

---

## 1. Identity, session and authorization

| Route/area | Role | Existing action | Component / API contract | Expected result | Status | Evidence |
|---|---|---|---|---|---|---|
| `/login` | public | phone + password sign-in | `Login.tsx` → `POST /auth/login` | session established, reverse-guard bounce | PRESERVED (fixed) | E2E:farmer-journey, E2E:visual-contract, UNIT:Login.test.tsx |
| `/login` | public | field validation on blur/submit | `Login.tsx` → `Field` + `errors-ui` | mapped message per field | PRESERVED (fixed) | UNIT:Login.test.tsx (2 tests) |
| `/register` | public | create account + consent capture | `Register.tsx` → `POST /auth/register` | tokens set, `refresh()`, redirect `/farm` | PRESERVED | E2E:visual-contract, UNIT:Register.test.tsx |
| `/reset` | public | forgot → OTP → reset | `Reset.tsx` → `POST /auth/password/forgot`, `POST /auth/password/reset` | reset completed, session revoked server-side | PRESERVED | UNIT:Reset.test.tsx |
| session hydration | any | deep link while unauthenticated | `App.tsx` `Shell` → `Navigate state.from` | returns to intended path | PRESERVED | E2E:visual-contract (signed-in pages) |
| `/settings` → logout | any | logout | `App.tsx` header → session `logout()` | session cleared | PRESERVED | E2E:settings-account |
| `/settings` | any | delete account | `Settings.tsx` → `DELETE /auth/me` | account deleted, then logout | PRESERVED | E2E:settings-account |
| `/settings` | any | phone OTP request/verify | `Settings.tsx` → `POST /auth/otp/request`, `/auth/otp/verify` | verified badge | PRESERVED (fixed) | E2E:settings-account |
| `/settings` | any | personal data export | `Settings.tsx` → `GET /auth/me/export` | JSON download | PRESERVED (fixed) | E2E:settings-account |
| `/admin` guard | ADMIN, SUPER_ADMIN | non-admin sees denial | `Admin.tsx` role check + `EmptyState` | `adminOnly` screen, no data fetch | PRESERVED | E2E:admin-guard, E2E:visual-contract |
| role-aware nav | any | admin link only for elevated roles | `App.tsx:206` | link hidden otherwise | PRESERVED | GREP:App.tsx |

Authorization remains **server-enforced** throughout; nothing was moved into client
logic. `docs/route-role-matrix.md` (machine-generated, with its own drift gate) is
the authority for the role↔route mapping and was not modified.

## 2. Farms, plots and crop cycles

| Route/area | Role | Existing action | API contract | Expected result | Status | Evidence |
|---|---|---|---|---|---|---|
| `/farm` | any | read farms (+plots, +crop cycles) | `GET /farms` | list or empty state | PRESERVED | E2E:farm-card, E2E:visual-contract |
| `/farm` | any | create farm | `POST /farms` | farm appears, `farms` invalidated | PRESERVED (fixed) | E2E:farm-card |
| `/farm` | any | create plot on a farm | `POST /farms/:id/plots` | plot appears | **PRESERVED (fixed)** | E2E:farm-card — the inline form used to be destroyed by the card's click handler; now asserted |
| `/farm` | any | create crop cycle on a plot | `POST /farms/crops` | crop appears, weather invalidated | PRESERVED | GREP:MyFarm.tsx |
| `/farm` | any | open farm detail | `setSelectedFarm` | detail view with plots | PRESERVED (fixed) | E2E:farm-card |
| `/farm` | any | stage-aware care suggestions | `lib/labels.farmCareSuggestion` | tone + label + task | PRESERVED (fixed) | UNIT, E2E:visual-contract |
| `/farm` | any | weather risk line | `GET /weather` | only actionable risks shown | **PRESERVED (fixed)** | E2E:visual-contract — was showing a favourable INFO advisory as a warning |
| `/onboarding` | any | district → area → first farm | `POST /farms` | farm created, onboarding flag set | PRESERVED (fixed) | E2E:visual-contract (route renders) |
| `/onboarding` | any | skip for now | `localStorage.ab_onboarded` | redirect `/` | PRESERVED | GREP:Onboarding.tsx |

Ownership scoping and validation live in the API and were untouched. The offline
queue's `clientUuid` idempotency and 72 h replay window are untouched; see §9.

## 3. Weather and agricultural intelligence

| Route/area | Role | Existing behaviour | API | Expected result | Status | Evidence |
|---|---|---|---|---|---|---|
| `/`, `/farm` | any | current conditions + provenance | `GET /weather` | temp, condition, humidity, wind, "as of / source / cached copy" | PRESERVED | E2E:visual-contract |
| `/` | any | district-scoped weather | `session.district` | refetch on profile change | PRESERVED | GREP:Home.tsx (`[session?.district]` dependency kept) |
| `/` | any | actionable risk advisories | `actionableRisks` | risk + action, or quiet state | PRESERVED (fixed) | E2E:visual-contract |
| `/` | any | failed weather read | own resource error | honest "unavailable" + retry | **PRESERVED (fixed)** | was a bare `—`; now `weatherUnavailable` + retry |
| `/`, `/farm` | any | Bengali/English labels, units, dates | `lib/labels`, `lib/format` | localized | PRESERVED | UNIT:i18n.test.ts, E2E:english-mode |

No weather, forecast, price or advisory value is generated client-side. The
mock/cached provenance line is unchanged and still names its source.

## 4. AI Agro Agent + disease intake

| Route/area | Role | Existing action | API | Expected result | Status | Evidence |
|---|---|---|---|---|---|---|
| `/advisor` | any | ask a question | `POST /ai/advisory` | answer + support band + refs + engine/KB provenance | PRESERVED | E2E:console-health |
| `/advisor` | any | failed advisory request | — | shown as an **error**, not as an answer | **PRESERVED (fixed)** | failed turns render `ErrorBanner`; previously the error string was pushed as `role:"ai"` and wore the answer bubble |
| `/advisor` | any | disease photo intake | `POST /disease/cases` | upload → `PENDING_REVIEW` | PRESERVED (fixed) | keyboard reachable now (`sr-only` + `peer`, was `display:none`) |
| `/advisor` | any | case list | `GET /disease/cases` | list with PENDING/REVIEWED badges | PRESERVED | E2E:visual-contract |
| `/advisor` | any | advisory history + report issue | `GET /ai/history`, `POST /ai/history/:id/feedback` | row updated from response, never optimistically | PRESERVED | UNIT:historyRefresh.test.tsx, feedback.test.tsx |
| `/advisor` | any | low-confidence / disclaimer | `confidenceSupportKey`, `advisoryDisclaimer` | coarse band, never a percentage | PRESERVED | UNIT:supportLabel.test.ts, answerMeta.test.ts |

No diagnosis, confidence score or provider success is fabricated. The disclaimer
and the "pending expert review" wording are unchanged.

## 5. Marketplace, cart, orders, payments

| Route/area | Role | Existing action | API | Expected result | Status | Evidence |
|---|---|---|---|---|---|---|
| `/market` | any | catalog read + category filter | `GET /products?pageSize=50&category=` | grid / empty state | PRESERVED | E2E:visual-contract |
| `/market` | any | add to cart / remove | `POST /cart/items`, `DELETE /cart/items/:id` | cart updated from server | PRESERVED | GREP:Market.tsx |
| `/market` | any | checkout wizard | `POST /orders/checkout` | order created, idempotency key per attempt | PRESERVED (fixed) | wizard steps now focus-trapped; the key logic is untouched |
| `/market` | any | payment intent + confirm | `POST /payments/intent`, `POST /payments/:id/confirm` | server-calculated totals | PRESERVED | GREP:Market.tsx |
| `/orders` | any | order history + expand | `GET /orders` | rows, items, breakdown | PRESERVED (fixed) | E2E:visual-contract |
| `/orders` | any | cancel/delete order | `DELETE /orders/:id` | confirmation then removal | PRESERVED | GREP:MyOrders.tsx (`useConfirm` kept) |
| `/services` | any | service catalog | `GET /services` | cards with real aggregated rating or explicit "no ratings" | PRESERVED (fixed) | E2E:visual-contract |
| `/services` | any | booking create | `POST /bookings` | booking created | PRESERVED (fixed) | field errors now associated with their inputs |
| `/services` | any | booking status transition | `POST /bookings/:id/status` | lifecycle moves forward only | PRESERVED | GREP:Services.tsx |
| `/sell` | any | procurement offer | `POST /procurement/offers` | offer submitted → QC | PRESERVED | E2E:visual-contract |
| `/wallet` | any | balance, ledger, withdrawals, membership | `GET /wallet`, `/wallet/summary`, `/wallet/withdrawals`, `/payments`, `/membership/plans` | real rows or failure-specific states | PRESERVED | E2E:visual-contract |
| `/wallet` | any | withdraw request | `POST /wallet/withdrawals` | confirmation, then request | PRESERVED (fixed) | the error wrapper no longer nests two `role="alert"` |
| `/wallet` | any | membership checkout | `POST /payments/intent` + confirm | sandbox-labelled activation | PRESERVED | GREP:Wallet.tsx |

Monetary values still come from the server (`formatBDT` over `paisa`); no client
calculation was introduced. Sandbox labelling is unchanged.

## 6. Notifications, admin, public and legal routes

| Route/area | Role | Existing action | API | Expected result | Status | Evidence |
|---|---|---|---|---|---|---|
| `/notifications` | any | list, tabs, mark read/all | `GET /notifications`, `POST /notifications/read` | counts and rows update | PRESERVED (fixed) | unread now has a text equivalent, not tint only |
| `/notifications` | any | preferences | `GET`/`PATCH /notifications/preferences` | switch state from server | PRESERVED (fixed) | switch hit area now 44 px, travel now transform-based |
| `/admin` | ADMIN+ | metrics, users, audit, withdrawals, AI usage | `GET /admin/analytics/summary`, `/admin/users`, `/admin/audit-logs`, `/admin/ai-usage`, `/admin/withdrawals` | live API values only | PRESERVED (fixed) | E2E:admin-guard, E2E:visual-contract |
| `/admin` | ADMIN+ | suspend/activate user, withdrawal decision | `PATCH /admin/users/:id`, `POST /admin/withdrawals/:id/decision` | confirmation, then mutation | PRESERVED (fixed) | `<th scope="col">` added; actions unchanged |
| `/privacy`, `/terms`, `/account-deletion` | public | read legal documents | static `features/legal/content.ts` | renders signed out | PRESERVED (fixed) | link underline colour restored (was a dead class) |
| `*` | public | not found | `NotFound` | guidance + home link | PRESERVED | E2E:visual-contract |
| global | any | offline write queue visibility | `offlineQueue` subscription in `App.tsx` | banner + queued count | PRESERVED (fixed) | badge now names what it means ("offline changes waiting to sync") instead of a wrong, AT-hidden "new notifications" |

## 7. Cross-cutting behaviour

| Concern | Contract before | Status | Evidence |
|---|---|---|---|
| Bengali/English toggle | session `lang`, dictionary, no inline ternaries | PRESERVED (fixed) | `i18n:check` → 439 referenced, 0 missing, 0 inline ternaries |
| Dark theme | `html[data-theme="dark"]`, designed dark token set | PRESERVED | E2E:visual-contract (dark pass), `dark.css` untouched |
| Offline banner + queue | `lib/offlineQueue.ts`, 72 h replay, toasts | PRESERVED | E2E:offline.spec.ts |
| Reduced motion | `MotionConfig reducedMotion="user"` + global media query | PRESERVED | E2E:keyboard.spec.ts, index.css unchanged |
| Error containment | per-route `ErrorBoundary key={pathname}` | PRESERVED (fixed) | fallback no longer nests a second `<main>` |
| Request correlation + retries | `lib/api.ts` (GET-only retry, one `X-Request-Id`) | PRESERVED | UNIT:api.test.ts (36 tests), api-retry.test.ts |
| Console health | no console errors / failed requests on critical routes | PRESERVED | E2E:console-health.spec.ts |
| API base URL / CORS / CSP | relative `/api/v1`, vercel.json headers | PRESERVED | PREFLIGHT (CSP hash + API origin) |

## 8. Deliberately out of scope

| Item | Why |
|---|---|
| `apps/api/**`, Prisma schema, migrations | The brief is a frontend renovation; the API is a frozen contract boundary. |
| `docs/route-role-matrix.md` | Machine-generated with a drift gate; regenerating it is not a UI change. |
| `components/TopBar.tsx` | `VITE_FEATURE_NEW_SHELL` still gates the newer shell; removing the legacy bar is a product decision, not a defect. |
| `Services`/`ServiceCard` full-`motion` import | Removing it would move framer-motion's `domMax` features onto the entry bundle every user pays. Recorded as a follow-up in `verification-report.md`. |
| `Button`'s `disabled`-during-submit behaviour | Disabling the focused control can drop focus to `<body>`. Fixing it needs an `aria-disabled` pattern across every async action — a cross-cutting change, not a fix for this pass. |
