# Runbook — edge protection rule specification (OA-04)

The owner applies these rules at the edge (Vercel project settings, firewall/WAF, or the platform's
bot protection); engineering cannot and must not touch them (R2/§11). This is the specification the
owner asked for, written so each rule states what it protects and what a false positive costs.

## Context

The API already enforces per-route budgets at the application layer (`docs/security.md` §Rate
limiting): login 20/15 min per address, refresh per token, OTP per phone, webhook flood cap 600/15
min. What the edge adds is protection for things the app cannot see: volumetric floods, scrapers,
credential-stuffing at scale, and the LibreSSL/TLS handshake cost of junk traffic.

## Rules to apply (in priority order)

| # | Rule | Rationale | False-positive cost |
|---|---|---|---|
| 1 | Allow-list the health/readiness paths (`/health`, `/ready`) from all rate limiting and WAF challenges — the uptime probe depends on them | Probe false alarms page the on-call for nothing (G5) | None |
| 2 | Allow-list the SSLCommerz webhook path (`/api/v1/payments/webhook/sslcommerz`) from IP-level rate limiting; challenge (not block) unmatched signatures | Real IPNs come from a handful of gateway addresses and must never 429 (PAY-03); the webhook's own limiter + signature check is the gate | A blocked IPN delays settlement — reconciliation covers it, but prefer challenge |
| 3 | Rate-limit unauthenticated POSTs on `/api/v1/auth/*` at the edge at ~10× the app budget per IP | Absorbs distributed credential stuffing before it reaches the app limiters (carrier-grade NAT puts many farmers behind one address — do NOT go tighter) | A CGNAT village failing to log in for 15 min; prefer 429 with `Retry-After` over drop |
| 4 | Block obvious non-browser HTTP client patterns on the web origin only (`User-Agent` empty/curl/python-requests) | The web SPA is browser-only; the API origin must NOT get this rule (the Android app is a native client) | None on API; on web, block only `GET /` + asset paths |
| 5 | Enable managed bot challenge (not block) for paths with no API contract: `/admin/*` from non-allow-listed ASNs | Admin surface is small and allow-listable | Owner's own office IP — allow-list it first |
| 6 | TLS: require ≥ 1.2, keep HSTS preload as shipped | App already sends HSTS | None |

## Explicitly do NOT apply

- Do **not** rate-limit `/api/v1/payments/gateway/return/*` by IP — the buyer's browser lands there
  straight from the gateway redirect; blocking it strands a paid buyer on the gateway page.
- Do **not** geo-block Bangladesh or allow-list only `iad1` — farmers travel; the API functions may
  move region per DR-11.
- Do **not** challenge `/metrics` or `/ready` — the first is token-gated at the app layer and the
  probe must stay clean.

## Verification (after applying)

1. Uptime probe stays green for one full interval set (15-min cadence, `.github/workflows/uptime-probe.yml`).
2. A sandbox checkout completes end to end from a clean browser (rule 2 did not catch the return leg).
3. Login from a mobile carrier connection succeeds (rule 3 threshold is above CGNAT reality).
