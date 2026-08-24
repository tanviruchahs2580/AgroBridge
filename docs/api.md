# API Reference (v1)

Base URL: `/api/v1` · JSON envelope:

```json
{ "ok": true,  "data": { ... }, "requestId": "uuid" }
{ "ok": false, "error": { "code": "...", "message": "...", "details?": [...] }, "requestId": "uuid" }
```

Auth: `Authorization: Bearer <accessToken>` unless noted. Errors use proper HTTP status codes
(400 validation, 401 unauthenticated, 403 RBAC, 404 scoped-not-found, 409 conflict, 422 business
rule, 429 rate-limited).

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

## Farms (`/farms`)
- `GET /farms` · `POST /farms` · `PATCH /farms/:id` · `DELETE /farms/:id`
- `POST/GET /farms/:id/plots`, `PATCH /farms/:id/plots/:plotId`
- `POST /farms/crops` (auto stage + PLANTING event), `GET /farms/crops` (with calendar tasks),
  `PATCH /farms/crops/:cropId` (stage/status/yield)
- `GET /farms/:id/events?limit=` · `POST /farms/:id/events` — supports `clientUuid` idempotent replay
  for offline sync.

## Weather (`/weather`)
- `GET /weather?lat&lng&cropStage?` → `{provider, current, forecast[3], risks[]}` with bilingual
  risk advisories.

## AI (`/ai`)
- `POST /ai/advisory` `{question, lang, cropName?}` → `{answer, confidence, provider, model,
  lowConfidenceFlag, groundedRefs}`. Rate limited to 30/hour/user.
- `GET /ai/history`

## Disease (`/disease`)
- `POST /disease/cases` — multipart `image` (JPEG/PNG/WebP ≤8MB) + optional `cropCycleId`,
  `cropGuess`. Queued as `PENDING_REVIEW`; no fabricated diagnosis.
- `GET /disease/cases` · `GET /disease/cases/:id`
- `POST /disease/cases/:id/review` — ADMIN only: `{diagnosis, severity, recommendation}`.

## Marketplace
- `GET /products?page&pageSize&category&search` · `POST /products` (`products:manage`)
- `GET /cart` · `POST /cart/items` `{productId, qty}` · `DELETE /cart/items/:productId`
- `GET /orders` · `GET /orders/:id` · `POST /orders/checkout` (atomic stock decrement + tier discount)

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
- `POST /payments/intent` `{purposeType: ORDER|BOOKING|MEMBERSHIP, purposeId}`
- `POST /payments/:id/confirm` — sandbox confirmation; applies business side-effect atomically.
- `POST /payments/payouts` (`procurement:pay`) — credits farmer wallet from COLLECTED PO.
- `GET /payments` · `GET /wallet` (balance + ledger) · `GET /membership/plans`

## Notifications
- `GET /notifications` → `{items, unread}` · `POST /notifications/read` `{ids?} | {all:true}`

## Admin (`/admin`, elevated roles)
- `GET /admin/metrics` — live counters (farmers, farms, orders, revenue…).
- `GET /admin/users?role&status&search&page&pageSize` · `PATCH /admin/users/:id` (role/status;
  suspends sessions immediately).
- `GET /admin/audit-logs` (`audit:read`) · `GET /admin/ai-usage`
