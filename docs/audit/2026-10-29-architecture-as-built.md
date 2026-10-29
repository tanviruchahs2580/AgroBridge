# Architecture — as built (candidate SHA 980bf41, baseline 287a8b1)

Recovered from source, not from docs. Every node cites the current code, with line
numbers re-resolved at the candidate SHA by `.audit/scripts/resolve-citations.py`
(the fixes moved code inside several files, so baseline line numbers would be stale
by construction). Where a
claim could not be checked in this run it says so.

## 1. Context and containers

```
                    ┌──────────────────────────────────────────────┐
   farmer/buyer ──▶ │ Web SPA (apps/web)  React 18 + Vite + Tailwind│
   dealer/admin     │ 19 routes, single i18n dictionary (bn/en)    │
                    │ localStorage access+refresh tokens (no cookie)│
                    └───────────────┬──────────────────────────────┘
                                    │  HTTPS, Bearer access token
                    ┌───────────────▼──────────────────────────────┐
                    │ API (apps/api)  Express 4 + Prisma 6, ESM     │
                    │ app.ts mounts: helmet → cors → json → context │
                    │ → metrics → admission+global limiters → /api  │
                    └──┬────────┬────────┬────────┬────────┬────────┘
                       │        │        │        │        │
             ┌─────────▼──┐ ┌───▼────┐ ┌─▼─────┐ ┌▼──────┐ ┌▼─────────┐
             │ PostgreSQL │ │ Redis  │ │OpenWea│ │OpenAI │ │SSLCommerz│
             │ (prod)     │ │(absent │ │ther   │ │compat │ │  (or     │
             │ SQLite(dev)│ │ in prod│ │       │ │(opt.) │ │ sandbox) │
             └────────────┘ └────────┘ └───────┘ └───────┘ └──────────┘
```

- Middleware order: `apps/api/src/app.ts:58` trust proxy → `:61` helmet (CSP only in production) →
  `app.ts:62-72` CORS allow-list → body parsers → `requestContext` → metrics
  middleware → admission + global rate limiters on `/api/` → `/health`, `/ready`
  (which now reports payments at `:132`) and the guarded `/metrics` → the v1
  router, with **`/payments` (webhook) mounted first at `:148`, unauthenticated by
  design,** and `auth` at `:149`.
- Auth is applied per router (`requireAuth`), not at mount level: 15 routers call
  it themselves. The generated route matrix is the inventory (85 routes, 8 public)
  and `route-matrix.test.ts` fails if source and matrix drift.
- Dialect: three schema copies (`prisma/schema.prisma` sqlite,
  `prisma/schema.postgresql.prisma`, `prisma/postgres/schema.prisma` postgresql +
  binary targets) and two migration chains; the client is generated at install time
  by `scripts/generate-prisma.mjs` (Vercel → PostgreSQL, else SQLite), while the
  Vercel and Docker builds each force-regenerate the PG client.

## 2. Request lifecycle (money path example: checkout → payment)

```
POST /orders/checkout        marketplace/routes.ts:359
  ├─ requireAuth + financial limiter + Idempotency-Key header
  ├─ zod body = shipping fields + clientRequestId only (no price field)
  ├─ $transaction :387
  │   ├─ cart rows claimed (cart-as-token); order carries clientRequestId  :344
  │   ├─ product.updateMany {stockQty: {gte: qty}} → decrement   :429   ← atomic gate
  │   └─ order.create (CONFIRMED, UNPAID, price snapshot)  :433
  └─ lost-race replay on P2002 (unique userId+clientRequestId)  :479-492

POST /payments/intent        payments/routes.ts:180
  ├─ keyed replay fast path  :208-214
  ├─ live gateway session created BEFORE persisting  :250-263
  └─ $transaction :268 : re-check key → supersede stale PENDING → create Payment(PENDING)

gateway (buyer pays) ─┬─ POST /payments/webhook/sslcommerz   webhook.ts:24
                      └─ GET  /payments/:id/status           payments/routes.ts:499
  ├─ signature verified (MD5, constant time)  webhook.ts:34
  ├─ status ∈ {VALID, VALIDATED}; amount + currency match  webhook.ts:46-76
  ├─ claim PENDING→SUCCEEDED (conditional updateMany)  webhook.ts:90-98
  └─ applyPaymentSideEffects(tx, payment)  payments/routes.ts:144, called at :391 and webhook.ts:98
       ├─ ORDER  : order must still be CONFIRMED+UNPAID → PAID   (payments/routes.ts:154, AUD-101)
       ├─ BOOKING: booking must still be REQUESTED/ASSIGNED → PAID
       └─ MEMBERSHIP: extend from expiry, inside the same tx
```

Two claims guard the same row and only one can win: `PENDING → SUCCEEDED`
(settlement) and `PENDING → FAILED` (cancellation or supersede,
`lib/pendingIntents.ts`). That is what stops a cancelled order from being paid
after its stock was released.

## 3. Offline sync

```
apps/web/src/lib/offlineQueue.ts               allow-list: offlineQueueRules.ts
  localStorage "agrobridge.mutationQueue"        POST/PATCH/DELETE to /events, /cart,
  entry: {url, method, body, clientUuid,                        /orders
          payloadHash, queuedAt, ownerId}        NEVER_QUEUE: /orders/checkout  offlineQueueRules.ts:29
  72h TTL, dedupe by clientUuid+hash, owner stamping,
  sequential replay, 401/403 one retry, 409/422 → dropped as "conflict",
  network/5xx retained, single in-flight flush mutex
```
Server side, each queueable write is idempotent by construction: farm events carry a
unique `clientUuid` scoped to owner+farm (`farms/routes.ts:436-470`), cart/order
writes ride the checkout key or the cart-as-token claim. Conflict policy is
status-driven — 409/422 drops the entry and tells the user — with no server-side
version vector, so ordering is client-only (recorded as a limitation, D-06).
No service worker is registered; `public/sw.js` exists only to unregister and clear
caches, so the app never pretends to work offline beyond the queue.

## 4. AI Agro Agent (as built)

```
POST /ai/advisory  aiagent/routes.ts:41  → requireAuth :19 → per-user hourly limiter :24-39
  → zod (5..1000 chars, lang bn|en) :44-50
  → context: display name, district, active crop+stage, tier :56-85   (no weather)
  → gateway.askAgroAgent  providers/ai/gateway.ts:40
      → resolveProvider :12-17  (hosted adapter iff AI_PROVIDER=openai-compatible + key)
      → monthly budget gate :26-53  (cost per 1K tokens, Asia/Dhaka month)
      → provider.ask:
          offline-engine: normalize+match knowledge.ts:199-319 → top-2 → confidence → citations
          openai-compat  : sanitizeQuestion :105 → retrieve :106 → fenced prompt :61-92
                           → fetch 20s timeout, 1 retry on 429/5xx :109-124
      → usage log (tokens/cost/requestId) :101-139
      → AdvisoryQuery persisted with engine+kbVersion+requestId :141-162
      → prod failure → 502 + markDown("ai"); non-prod → offline fallback :80-92
```
- Corpus: **7 hand-written bilingual entries** in `providers/ai/knowledge.ts:33`
  with a source ledger whose fields are all null/`UNSOURCED` (`:22-26`). KB content
  hash is `KB_VERSION` (`:151-178`).
- Confidence (offline): `matchQuality = min(1, 0.75 + max(0, top-1.5)*0.125)`,
  multiplied by the entry's own confidence, +0.03 for a second match, capped 0.95;
  empty retrieval → 0.3 and an explicit insufficient-information answer
  (`offline-engine.ts:34-49` abstention, `:56-60` confidence). The UI renders a coarse "Source match" band and says
  it is not a probability (`supportLabel.ts`).
- Prompt injection posture: sanitizer strips role markers/fences/brackets; retrieved
  KB text is fenced as `REFERENCE_DATA` with an instruction to treat it as data;
  51 table-driven cases assert the posture (`ai-prompt-injection.test.ts`). Live
  model obedience is unverifiable offline (stated in the test itself).

## 5. Weather intelligence

```
GET /weather?lat&lng  modules/weather/routes.ts
  → cache key = coords rounded 2dp, TTL WEATHER_CACHE_TTL_SECONDS (600s)  modules/weather/cache.ts:50
  → single-flight coalescing via the inFlight map (25 concurrent → 1 call) modules/weather/cache.ts:100
  → OpenWeather adapter: 8s timeout, units=metric, wind m/s→km/h ×3.6
    (`providers/weather/openweather.ts:43`), rain mm (1h/3h), observedAt only from
    provider `dt` (never invented), forecast bucketed by Asia/Dhaka day
  → provenance envelope {provider, source, fetchedAt, cached, observedAt}  routes.ts:42-55
  → advisory rules (spray/rain/heat/irrigation/fungal risk) with thresholds weather/types.ts:39+ (DISEASE_RISK)
```
Failures are never cached or served as stale (`modules/weather/cache.ts:13-16`); the UI prints the
provenance line (`weatherProvenance.ts`, `Home.tsx:307`).

## 6. Disease image intake and review

```
POST /disease/cases  disease/routes.ts:61 (per-user 20/h limiter :43-52)
  multipart only → declared MIME allow-list → 8MB cap
  → deep magic-byte format detection; the sniffed format is bound at :101 and is
  → cropCycle ownership check :97-104                  what decides stripping (:123),
  → EXIF stripped for JPEG (by sniffed format)         extension and stored type (AUD-104)
  → storage.save(randomUUID name, bytes, contentType: sniffed format) :126
  → DiseaseCase{status: PENDING_REVIEW (:147), confidence:null, diagnosis:null,
                recommendation: "do not apply any treatment"} :132-149
POST /disease/cases/:id/review  :213  (permission disease:review)
  → atomic updateMany claim (409 on a lost race) → audit + notify  :217-251
```
No classifier exists; `AI_ONLY` is declared in the schema and never assigned. There is
no download route, so image bytes are never served back. The reviewer queue has no
list endpoint for admins (AUD-112) and the result is not rendered to the farmer
(AUD-113).

## 7. Financial integrity (wallet, ledger, procurement payout)

```
Wallet.balancePaisa / heldPaisa are mutable, but every write is paired with a
WalletTransaction row in the same transaction:
  refund      DEBIT   payments/routes.ts:604-638
  payout      CREDIT  payments/routes.ts:700-733
  withdrawal  hold/increment → approve DEBIT / reject release  admin/routes.ts:221-290
WalletTransaction is append-only in code (only create/aggregate/read exist).
Invariant asserted by apps/api/scripts/reconcile-wallet.mjs:
  balancePaisa == sum(CREDIT) - sum(DEBIT)  and  heldPaisa == sum(PENDING withdrawals)

Procurement: offer (self-declared grade/moisture fix netPayablePaisa)
  → review transitions SUBMITTED→QC→PURCHASE_ORDER→COLLECTED (claim-atomic table)
  → payout claims COLLECTED→PAID atomically, creates Payment(POUT-) + wallet CREDIT
  Both review and payout now refuse the actor's own offer through one shared
  predicate, `lib/separationOfDuties.ts:36` (AUD-102), and are region-confined when
  the actor has a region.
```

## 8. Trust boundaries and high-risk stateful modules

| Boundary | Where | Control |
|---|---|---|
| Internet → API | `app.ts:58-99` | trust proxy, helmet/CORS, admission + global limiters |
| Public → payment callback | `app.ts:148`, `webhook.ts:34-76` | gateway signature + status + amount/currency |
| Authenticated → object | `requireAuth` + service-layer `where` clauses | ownership/tenant scoping, negative-tested |
| Role → privileged action | `middleware/rbac.ts` | 13 roles, permission map, generated matrix |
| App → provider | `providers/*` via `resilience.ts` | timeout, bounded retry, circuit breaker (bulkhead unused) |
| Upload → storage | `disease/routes.ts`, `providers/storage` | content-verified type, random name, EXIF by bytes |
| Production config | `config/env.ts:225-290` (`paymentSandboxProblem` at :233, placeholder guard at :267) | fail-closed guards for secrets, placeholders, payment mode |

Highest-risk stateful modules (in order): `modules/payments` (claim/ledger),
`modules/marketplace` + `modules/services` (stock/order/booking state),
`modules/procurement` (money-adjacent state machine), `providers/ai` (spend +
answer provenance), `lib/offlineQueue` (client-side data loss window).
