<!-- owner: @tanviruchahs2580 · purpose: route reference for the mounted API surface — regenerated inventory in docs/qa/route-matrix.md · last-verified: 2026-10-21 @ 6550a9a -->

# API Reference (v1)

Base URL: `/api/v1` · JSON envelope:

```json
{ "ok": true,  "data": { ... }, "requestId": "uuid" }
{ "ok": false, "error": { "code": "...", "message": "...", "details?": [...] }, "requestId": "uuid" }
```

Auth: `Authorization: Bearer <accessToken>` unless noted. Errors use proper HTTP status codes
(400 validation, 401 unauthenticated, 403 RBAC, 404 scoped-not-found, 409 conflict, 422 business
rule, 429 rate-limited, 503 temporarily overloaded).

**Rate-limit keys.** Quotas are charged to the caller, not to the address they happen to share.
The global limiter keys on the presented credential — a truncated SHA-256 of the bearer token, so a
forged header cannot mint buckets — and falls back to the address for anonymous requests;
`POST /auth/login` and `POST /auth/refresh` key on the *account* named in the body (normalised, so
`+880…`, `880…` and `01…` spellings of one number share one budget); endpoints behind `requireAuth`
key on the authenticated user. This matters because carrier-grade NAT puts thousands of this
product's users behind one address — the 10k audit measured 10 000 distinct users sharing a single,
exhausted quota. Registration is the deliberate exception: it stays address-keyed as the
mass-account-creation control (`REGISTER_RATE_LIMIT_MAX`).

**Overload responses.** A request that arrives while the instance is already working on
`MAX_CONCURRENT_REQUESTS` requests is answered immediately with `503` `OVERLOADED` and
`Retry-After: 1`, instead of joining a queue that could hold it for minutes. A request that cannot
obtain a database connection within the pool timeout is answered `503` `DB_POOL_EXHAUSTED` with
`Retry-After: 2`. Clients should honour `Retry-After`; the web client does and jitters its own
retries.

**Capped money lists and `X-Total-Count`** — the money lists documented below return a capped
slice and always carry an `X-Total-Count` response header whose value is the true number of rows
in the exact scope the slice was taken from (the caller's own records for a user, all records for
an admin, the selected `status` for the finance queue). The JSON bodies are unchanged, so a
caller that sees `X-Total-Count` greater than the number of returned rows knows the list is
truncated. This applies to `GET /orders`, `GET /payments`, `GET /wallet` and `GET /admin/withdrawals`.

## Health
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness, no auth |
| GET | `/ready` | readiness incl. DB check |

## Auth (`/auth`)
- `POST /auth/register` — `{fullName, phone(BD), password≥8, email?, langPref?}` → tokens. Farmer role.
- `POST /auth/login` — `{phone, password}` → access+refresh+user.
- `POST /auth/refresh` — `{refreshToken}` → rotated pair (old refresh revoked).
- `POST /auth/logout` — revokes provided refresh token.
- `GET/PATCH /auth/me` — profile read/update (district/upazila/address/language).
- `POST /auth/otp/request` — issues a 6-digit phone-verification code for the caller's own phone
  (stored hashed; delivered via the SMS provider — sandbox logs it). Sandbox responses outside
  production echo `devCode`; supersedes any previous unconsumed challenge.
- `POST /auth/otp/verify` — `{code}` → `{phoneVerified: true}`; marks the phone verified (required
  before wallet withdrawals). Attempt- and time-limited (422 on expired/exhausted/incorrect).
- `DELETE /auth/me` — self-service account deletion: anonymizes identity fields, disables the
  account, revokes all refresh tokens, purges uploaded disease photos, clears OTP challenges and
  profile location fields; 422 while an order or withdrawal is still unresolved. Financial/ledger
  rows are retained (see `docs/data-protection.md`).
- `GET /auth/me/export` — JSON download of everything the caller owns (profile, farms, orders,
  payments, wallet, bookings, offers, disease-case metadata, notifications, advisory history).
  `Content-Disposition: attachment; filename="agrobridge-export-<userId>.json"`, `no-store`,
  limited to 5/hour/user, audit-logged. Never includes `passwordHash` or any other user's rows.

## Farms (`/farms`)
- `GET /farms` · `POST /farms` · `PATCH /farms/:id` · `DELETE /farms/:id`
- `POST/GET /farms/:id/plots`, `PATCH /farms/:id/plots/:plotId`
- `POST /farms/crops` (auto stage + PLANTING event), `GET /farms/crops` (with calendar tasks),
  `PATCH /farms/crops/:cropId` (stage/status/yield)
- `GET /farms/:id/events?limit=` · `POST /farms/:id/events` — supports `clientUuid` idempotent replay
  for offline sync.

## Weather (`/weather`)
- `GET /weather?lat&lng&cropStage?` → `{provider, source, fetchedAt, cached, current, forecast[3],
  risks[]}` with bilingual risk advisories. `fetchedAt` is when the provider data was retrieved
  (reused responses keep the ORIGINAL time and set `cached: true`); `current.observedAt` is the
  provider's observation time when it supplies one. Successful fetches are cached per rounded
  location for `WEATHER_CACHE_TTL_SECONDS`; provider failures are never served from cache.
  Rules/thresholds: `docs/weather.md`.

## AI (`/ai`)
- `POST /ai/advisory` `{question, lang, cropName?}` → `{answer, confidence, provider, model,
  kbVersion, promptVersion?, lowConfidenceFlag, groundedRefs}`. Rate limited to `AI_HOURLY_LIMIT`
  (default 30) per hour **per authenticated account** — keyed by user, not by address; the earlier
  address-keyed behaviour meant one carrier-NAT address shared a single hourly budget.
  `kbVersion` identifies the knowledge-base revision that answered; `promptVersion` exists only
  for the hosted provider. `confidence` is a retrieval-support heuristic — clients must not
  present it as a probability (`docs/ai.md`).
- `GET /ai/history` → last 20 rows `{id, question, answer, confidence, lowConfidenceFlag,
  groundedRefs, feedbackReason, feedbackAt, createdAt}`. `groundedRefs` is resolved against the
  current KB at read time: entries removed after the answer was stored are dropped, never served
  as live citations.
- `POST /ai/history/:id/feedback` — `{reason: 3..500}` records why an answer was not useful on
  the caller's own row (404 otherwise); a repeat report overwrites. Audit-logged.

## Disease (`/disease`)
- `POST /disease/cases` — multipart `image` (JPEG/PNG/WebP ≤8MB) + optional `cropCycleId`,
  `cropGuess`. Queued as `PENDING_REVIEW`; no fabricated diagnosis.
- `GET /disease/cases` · `GET /disease/cases/:id`
- `POST /disease/cases/:id/review` — ADMIN only: `{diagnosis, severity, recommendation}`.

## Marketplace
- `GET /products?page&pageSize&category&search` · `POST /products` (`products:manage`)
- `GET /cart` · `POST /cart/items` `{productId, qty}` · `DELETE /cart/items/:productId`
- `GET /orders` — newest first, capped at 100 rows; `X-Total-Count` is the order count for the
  caller's scope (own orders, or all orders for an admin). · `GET /orders/:id`
- `POST /orders/checkout` — atomic stock decrement + tier discount. Optional `clientRequestId`
  (8–100 chars, opaque) makes the call idempotent: the first request that creates an order with
  that key owns it, and a later request with the same key replays that same order with 200 and
  causes no stock/ledger side effects (contract: one key = one order, even if the key is later
  re-used for a different cart).
- `DELETE /orders/:id` — removes a finished order (refused with 422 while PENDING/CONFIRMED/SHIPPED).
  Sandbox payment rows go with the order; real-gateway payment records are kept for audit.

## Services & bookings
- `GET /services` (with active providers) · `POST /services` (`services:manage`)
  · `POST /services/providers` (`providers:manage`)
- `POST /bookings` (future-dated, price = base × area) · `GET /bookings`
- `POST /bookings/:id/assign` (`bookings:assign`) · `POST /bookings/:id/status` · `POST /bookings/:id/rating`

## Procurement (`/procurement`)
- `POST /procurement/offers` — auditable calc: grade multiplier (A/B/C) + moisture deductions.
- `GET /procurement`
- `POST /procurement/:id/review` (`procurement:review`) — actions: `QC_PASS → ISSUE_PO → COLLECT` or `REJECT`.

## Payments / wallet / membership
- `POST /payments/intent` `{purposeType: ORDER|BOOKING|MEMBERSHIP, purposeId}` → `{paymentId, refNo,
  amountPaisa, providerMode, redirectUrl?, messageBn?, messageEn?}`. Live gateways return the hosted
  checkout `redirectUrl`; sandbox returns `providerMode: "sandbox"` plus the no-real-money notice.
  A production deployment with no gateway configured refuses instead of fabricating a payable intent.
- `POST /payments/:id/confirm` — sandbox confirmation; applies business side-effect atomically.
- `GET /payments/:id/status` — reconciliation probe: re-verifies a PENDING payment with the
  provider (live mode) and settles it if paid; `{status, reconciled, providerMode?}`.
- `POST /payments/gateway/return/:outcome` — public, unauthenticated hosted-checkout return
  (`outcome` = `success|fail|cancel`): asks the provider whether money actually moved, then
  303-redirects the buyer back to the web origin (`/orders?payment=…&ref=…`). Trusts nothing in the
  request; the signed gateway webhook remains the primary settlement path.
- `POST /payments/payouts` (`procurement:pay`) — credits farmer wallet from COLLECTED PO.
- `POST /payments/:id/refund` (`payments:refund`) — platform-initiated refund for ORDER payments:
  moves the payment `SUCCEEDED → REFUNDED` atomically and records a compensating wallet entry.
  Sandbox provider: simulated, and the notification says the entry is a wallet adjustment, not
  gateway money. Live provider: the refund must first be issued in the gateway dashboard, then
  recorded here as `{reason, gatewayRef (4–64)}` — the supplied reference is stored as the
  payment's `refundRef` and the wallet entry documents it; without `gatewayRef` the request is
  refused with 422 before any write (the endpoint never claims money returned that it cannot
  prove). Membership purchases are non-refundable while active.
- `GET /payments` — newest first, capped at 100 rows (own payments, or all payments for an
  admin); `X-Total-Count` carries the scope's true count. · `GET /wallet` (balance + ledger;
  the ledger is capped at 50 transactions and `X-Total-Count` is the caller's ledger-row count)
  · `GET /membership/plans`

## Wallet withdrawal queue (`/wallet/withdrawals`)
- `POST /wallet/withdrawals` `{amountPaisa ≥ 10000, channel: BKASH|NAGAD|BANK}` — places a
  withdrawal request: the amount is **held** (`heldPaisa`) so it cannot be double-spent while
  pending; phone verification required in production; destination is masked. 201 with the
  withdrawal row (`status: PENDING`, `refNo` `WDL…`); 422 when the available balance
  (`balance − held`) is insufficient.
- `GET /wallet/withdrawals` — the caller's own requests, newest first (max 50).
- Finance decisions live under Admin: `GET /admin/withdrawals?status=PENDING|APPROVED|REJECTED|PAID`
  — the finance queue, capped at 100 rows with `X-Total-Count` set to the selected status' true
  count — and `POST /admin/withdrawals/:id/decision` `{action: APPROVE|REJECT|MARK_PAID, note?}`
  (`finance:withdrawals`). APPROVE debits the wallet and releases the hold; REJECT releases the
  hold; MARK_PAID completes an already-approved manual bKash/Nagad/bank transfer.

## Organizations (`/organizations`, multi-tenant)
- `POST /organizations` `{name, type: COOPERATIVE|CORPORATE|NGO|GOVT, district?}` — ADMIN/SUPER_ADMIN
  or CORPORATE/COOPERATIVE only; creator joins as org ADMIN.
- `GET /organizations` — privileged roles see all; everyone else only organizations they belong to
  (`_count.farms` included).
- `GET /organizations/:id` · `GET /organizations/:id/farms` — members only (admins any).
- `POST /organizations/:id/members` `{phone, role?}` · `DELETE /organizations/:id/members/:userId`
  — org ADMIN (or platform admin) manages membership; farm queries for CORPORATE/COOPERATIVE roles
  are scoped to `ownerId` OR organization membership.

## Analytics (`/analytics`)
- `POST /analytics/events` `{events: [{name(lower_snake_case), sessionId?, props?}] ≤ 20}` —
  first-party product analytics ingest (202, fire-and-forget; no PII in props). Feeds the
  activation/funnel KPIs; self-hosted, nothing is sent to third parties.

## Notifications
- `GET /notifications` → `{items, unread}` · `POST /notifications/read` `{ids?} | {all:true}`

## Admin (`/admin`, elevated roles)
- `GET /admin/metrics` — live counters (farmers, farms, orders, revenue…).
- `GET /admin/users?role&status&search&page&pageSize` · `PATCH /admin/users/:id` (role/status;
  suspends sessions immediately).
- `GET /admin/audit-logs` (`audit:read`) · `GET /admin/ai-usage`
- `GET /admin/withdrawals?status=` · `POST /admin/withdrawals/:id/decision` (`finance:withdrawals`)
  — the finance withdrawal queue (see the wallet withdrawal section above).
