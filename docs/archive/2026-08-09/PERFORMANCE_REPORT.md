# AgroBridge — Performance Report

Date: 2026-08-25  
Environment: This session had **no running API server and no Docker**, so no new load test was executed. This report documents the existing harness, previous baseline, and the method to reproduce. No numbers are faked.

## 1. Harness
- Tool: `autocannon 7.15.0` via `apps/api/scripts/loadtest.mjs`
- Profiles (each 10s burst, default):
  - `GET /health` (baseline, no DB)
  - `GET /products?pageSize=12` (auth + DB)
  - `POST /auth/login` (bcrypt cost 12)
  - `GET /weather?lat=25.9&lng=89.1` (mock weather provider)
  - `POST /ai/advisory` (grounded KB, quota-limited 30/h/user)
- Invocation: `BASE_URL=http://localhost:4000 node scripts/loadtest.mjs`
- Prerequisites: seeded DB, `POST /auth/login` with `01700000002/Demo@1234` succeeds, token cached for auth bursts

## 2. Previous Baseline (from `docs/testing.md`, measured on Windows + embedded PostgreSQL 17.5, 10s bursts)

| Endpoint | req/s | p50 | p90 | p99 | Notes |
|---|---|---|---|---|---|
| GET /health | ~6200 | 1ms | 2ms | 5ms | No DB/auth, liveness |
| GET /products?pageSize=12 | ~400 | 23ms | 32ms | 45ms | Auth + Prisma query |
| GET /weather (mock) | ~620 | 14ms | 20ms | 39ms | Provider mock + risk engine |
| POST /auth/login (bcrypt 12) | ~7–8 | 1200ms | 1500ms | 1900ms | CPU-bound hash compare |
| POST /ai/advisory | quota-bound | — | — | — | 30/h/user → 429 after quota |

Hardware class: single developer Windows box (not production hardware). Throughput scales with horizontal replicas; login is intentionally bcrypt-bound.

## 3. This Session — Rehearsal Attempt
- Command attempted: `BASE_URL=http://localhost:4000 node scripts/loadtest.mjs`
- Result: **NOT EXECUTED** — no API process listening on 4000 (`docker compose up` would be required, but Docker daemon absent)
- Evidence: `docker --version` → not found; `npm run dev --workspace apps/api` not started this session to avoid port conflicts

## 4. What to Run on Staging/Production

### 4.1 Spin Staging
```bash
export POSTGRES_PASSWORD=<strong> API_DATABASE_URL=postgresql://agrobridge:<strong>@db:5432/agrobridge \
       JWT_ACCESS_SECRET=$(openssl rand -hex 32) JWT_REFRESH_SECRET=$(openssl rand -hex 32)
docker compose up --build -d
docker compose exec api npx prisma migrate deploy
curl -f http://localhost:4000/health
curl -f http://localhost:4000/ready
```

### 4.2 Load Profile
```bash
# Normal load (10 concurrent, 30s)
BASE_URL=http://localhost:4000 npx autocannon -c 10 -d 30 http://localhost:4000/health
BASE_URL=http://localhost:4000 node scripts/loadtest.mjs

# Peak (100 concurrent, 60s) — watch DB connections
BASE_URL=http://localhost:4000 npx autocannon -c 100 -d 60 http://localhost:4000/api/v1/products?pageSize=12 -H "Authorization: Bearer $TOKEN"

# Spike (0→200 in 10s) + recovery
# Sustained (10 concurrent, 10 min) via `autocannon -d 600`
```

Record: p50/p90/p95/p99, throughput, error%, CPU/RAM (docker stats), DB latency, connection pool wait.

### 4.3 Expected Bottlenecks & Recommendations
- **Login**: ~8 req/s per core at cost 12. Mitigation: scale API replicas, add Redis-backed login throttle with progressive delay, consider argon2id with lower cost for better perf/security trade-off.
- **Products**: ~400 req/s on single replica is healthy; add DB read replica + index on `Product.isActive, category` if catalogue grows >10k.
- **AI**: Quota is intentional; no perf fix needed — ensure fallback to offline engine when OpenAI timeout (20s) trips.
- **General**: Enable `NODE_ENV=production` (disables dev skip on rate limiter), put nginx/CDN in front for static + API caching where safe.

## 5. Verdict This Session
- **Performance**: `NOT TESTED` (no running server) — harness ready, previous baseline reference preserved, reproduction steps documented.
- Production should not be declared performant until staging loadtest with above profiles is executed and p95 < 200ms for read paths (excluding login) is demonstrated.

