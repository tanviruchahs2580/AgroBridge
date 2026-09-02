# Phase 9 — Observability Wiring (Local Prep, No Compose Edit)

**Status:** DOCUMENTED ONLY — no `docker-compose.prod.yml` edit (per UI-locked constraint)
**Date:** 2026-09-02
**Repo:** `tanviruchahs2580/AgroBridge` @ `849366f`
**Sources audited (read-only):**
- `docker-compose.prod.yml` (87 lines, services `db`, `api`, `web`; networks `internal`/`edge`; volumes `pgdata`/`uploads`)
- `monitoring/prometheus.yml` (17 lines, `global.scrape_interval 15s`, `rule_files: [/etc/prometheus/alert_rules.yml]`, scrape `api:4000/metrics`)
- `monitoring/alert_rules.yml` (63 lines, 6 alerts)
- `monitoring/grafana-dashboard.json` (109 lines, uid `agrobridge-overview`, 6 panels)
- `apps/api/src/lib/metrics.ts` (54 lines, `prom-client` Registry + 5 AgroBridge metrics)
- `docs/operations.md` (§ Metrics / Alert rules)

---

## 1. Current State (as read)

| File | Verdict |
|---|---|
| `docker-compose.prod.yml:10-56` | Runs `db` (postgres:17-alpine, `internal`, `mem_limit: 1g`), `api` (`ghcr.io/agrobridge/.../api:${API_IMAGE_TAG}`, `PORT 4000`, `DATABASE_URL`, `healthcheck: wget /health`), `web` (nginx, ports 80/443, `internal`+`edge`). **No** `prometheus` or `grafana` services. |
| `monitoring/prometheus.yml:1-17` | **Exists, not mounted anywhere.** `global.scrape_interval: 15s`, `evaluation_interval: 15s`, `rule_files: [/etc/prometheus/alert_rules.yml]`, `scrape_configs: job_name agrobridge-api, metrics_path /metrics, static_configs targets ["api:4000"]`. Comment says "Mount as /etc/prometheus/prometheus.yml; alert_rules.yml alongside it." |
| `monitoring/alert_rules.yml:1-63` | **Exists, not evaluated anywhere.** Group `agrobridge` with 6 rules: `High5xxRate` (5xx >5% 5m, critical), `ApiHighLatencyP95` (p95 >0.5s 10m, warning), `DbDown` (`agrobridge_db_up==0` 2m, critical), `PaymentFailures` (failed intents >5/10m 5m, critical), `AiFallbackSpike` (fallback_success >10/15m, warning — note `15m` vs `docs/operations.md:58` `10m >20` drift), `InstanceDown` (`up==0` 3m, critical). |
| `monitoring/grafana-dashboard.json:1-109` | **Exists, not provisioned anywhere.** Dashboard `agrobridge-overview` (6h, 30s refresh) with 6 panels (IDs 1-6): request rate by route, 5xx ratio, latency p50/p95, DB up stat, AI fallbacks stat, payment failures timeseries. Datasource `${DS_PROMETHEUS}` (prometheus). No provisioning folder mounted. |
| `apps/api/src/lib/metrics.ts:6-42` | Exports `agrobridge_http_requests_total{method,route,status}`, `agrobridge_http_request_duration_seconds{method,route,status}` (buckets 5ms-5s), `agrobridge_db_up`, `agrobridge_ai_requests_total{provider,status}`, `agrobridge_payment_intents_total{purpose_type,status}` + default `agrobridge_process_*` / `nodejs_heap_*`. `collectDefaultMetrics({register, prefix: "agrobridge_"})`. Middleware `metricsMiddleware` increments on `res.finish`. |
| `docs/operations.md:12-60` | Documents `GET /metrics` unauthenticated on internal network only, scrape example `targets: ["api:4000"]`, and alert rules (drift vs file: rule names `AgroBridge*` vs `High5xxRate` etc.). |

**Gap:** All observability artifacts are authored but **no compose service runs them**; `chaos-drills.md` empty. `/metrics` is exposed on `api:4000` (internal network) but nothing scrapes it in prod.

---

## 2. Compose Services to Add (proposed, NOT yet applied)

> **Constraint honored:** `docker-compose.prod.yml` was **not edited**. Paste the YAML below into `services:` when ready. No host ports are published by default — keep monitoring on `internal` only; expose via reverse-proxy or SSH tunnel if needed.

### 2.1 Full YAML snippet (additive)

```yaml
# ── Add to docker-compose.prod.yml → services: ──────────────────────────
  prometheus:
    image: prom/prometheus:v2.53.4
    restart: unless-stopped
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'
      - '--web.console.libraries=/usr/share/prometheus/console_libraries'
      - '--web.console.templates=/usr/share/prometheus/consoles'
      - '--web.enable-lifecycle'
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./monitoring/alert_rules.yml:/etc/prometheus/alert_rules.yml:ro
      - prometheus_data:/prometheus
    networks:
      - internal
    expose:
      - "9090"
    # Uncomment to allow host/admin access via SSH tunnel or private network:
    # ports:
    #   - "127.0.0.1:9090:9090"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:9090/-/healthy"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
    mem_limit: 512m
    cpus: 0.5

  grafana:
    image: grafana/grafana:11.4.0
    restart: unless-stopped
    depends_on:
      prometheus:
        condition: service_healthy
    environment:
      GF_SECURITY_ADMIN_USER: ${GF_SECURITY_ADMIN_USER:-admin}
      GF_SECURITY_ADMIN_PASSWORD: ${GF_SECURITY_ADMIN_PASSWORD:?set GF_SECURITY_ADMIN_PASSWORD in .env}
      GF_USERS_ALLOW_SIGN_UP: "false"
      GF_USERS_AUTO_ASSIGN_ORG: "true"
      GF_SERVER_HTTP_PORT: "3000"
      GF_SERVER_DOMAIN: ${GF_SERVER_DOMAIN:-localhost}
      GF_SERVER_ROOT_URL: ${GF_SERVER_ROOT_URL:-http://localhost:3000/}
      GF_SECURITY_DISABLE_LOGIN_FORM: "false"
      GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH: /etc/grafana/provisioning/dashboards/agrobridge-overview.json
      GF_FEATURE_TOGGLES_ENABLE: publicDashboards
      # Provisioning: auto-wire Prometheus datasource
      GF_PATHS_PROVISIONING: /etc/grafana/provisioning
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana-dashboard.json:/etc/grafana/provisioning/dashboards/agrobridge-overview.json:ro
      - ./monitoring/grafana-datasource.yml:/etc/grafana/provisioning/datasources/datasource.yml:ro
      - ./monitoring/grafana-dashboard-provider.yml:/etc/grafana/provisioning/dashboards/provider.yml:ro
    networks:
      - internal
    expose:
      - "3000"
    # Uncomment for direct admin access (keep behind TLS via web nginx if exposed):
    # ports:
    #   - "127.0.0.1:3000:3000"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/api/health | grep -q ok"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
    mem_limit: 512m
    cpus: 0.5

# ── Add to top-level volumes: ──────────────────────────────────────────
volumes:
  pgdata:
  uploads:
  prometheus_data:
  grafana_data:

# ── networks: unchanged (internal is internal:true, edge is external) ──
networks:
  internal:
    internal: true
  edge:
```

### 2.2 Required side files (create alongside the YAML)

**`monitoring/grafana-datasource.yml`** (new, mount above):
```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
```

**`monitoring/grafana-dashboard-provider.yml`** (new):
```yaml
apiVersion: 1
providers:
  - name: 'AgroBridge'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    editable: true
    options:
      path: /etc/grafana/provisioning/dashboards
```

### 2.3 Env additions (`.env` beside `docker-compose.prod.yml`)

```dotenv
GF_SECURITY_ADMIN_PASSWORD=<64-char random, same vault as JWT secrets>
# optional overrides
GF_SECURITY_ADMIN_USER=admin
GF_SERVER_DOMAIN=agrobridge.example.com
GF_SERVER_ROOT_URL=https://agrobridge.example.com/grafana/
```

### 2.4 Optional: `alertmanager` (deferred, but wiring-ready)

The 6 alerts in `alert_rules.yml` fire inside Prometheus; to route to Slack/Email, add:

```yaml
  alertmanager:
    image: prom/alertmanager:v0.27.0
    restart: unless-stopped
    command: ['--config.file=/etc/alertmanager/alertmanager.yml', '--storage.path=/alertmanager']
    volumes:
      - ./monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
      - alertmanager_data:/alertmanager
    networks: [internal]
    expose: ["9093"]
    mem_limit: 256m
```

and in `monitoring/prometheus.yml` add:
```yaml
alerting:
  alertmanagers:
    - static_configs: [{ targets: ["alertmanager:9093"] }]
```

Provide `monitoring/alertmanager.yml` with `receivers: [{ name: slack, slack_configs: [{ api_url: $SLACK_WEBHOOK_URL, channel: "#agrobridge-alerts" }] }]` or email. Keep `ALERTMANAGER_URL` env out of git.

---

## 3. Scrape Config — Exact (as authored)

**File:** `monitoring/prometheus.yml:7-17` — no change needed, just mount it.

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - /etc/prometheus/alert_rules.yml

scrape_configs:
  - job_name: agrobridge-api
    metrics_path: /metrics
    scrape_interval: 15s
    static_configs:
      - targets: ["api:4000"]
```

Notes:
- `api:4000` is the compose DNS name + container `PORT` (see `docker-compose.prod.yml:37` `PORT: "4000"` and `apps/api/src/lib/metrics.ts` registry). Do **not** use `localhost:4000` inside Prometheus — that would point at the Prometheus container itself.
- `/metrics` is **unauthenticated but internal-only** (`docs/operations.md:14`, `docker-compose.prod.yml:81-83` `internal: true`). Do not publish it through `web` nginx; if external scraping is ever needed, put it behind `GF_SECURITY_ADMIN_PASSWORD`-style auth or mTLS.
- `evaluation_interval` matches `scrape_interval` so alert `for:` durations (`5m`, `10m`, `2m`) are evaluated promptly.
- Prometheus verifies with `curl http://prometheus:9090/api/v1/targets` should show `agrobridge-api` `health: up`.

If you need host debugging, map `prometheus` `9090` to `127.0.0.1:9090` and query `http://localhost:9090/targets`.

---

## 4. Grafana Dashboard Panels — Needed (current + additions)

### 4.1 Current dashboard (`monitoring/grafana-dashboard.json:12-108`) — 6 panels, keep as-is

| ID | Title | Type | Query / Metric | Threshold / Note |
|----|-------|------|----------------|------------------|
| 1 | Request rate by route (5m) | timeseries 12×8 | `sum by (route) (rate(agrobridge_http_requests_total[5m]))` | Golden signal: traffic |
| 2 | 5xx ratio (5m) | timeseries 12×8 | `sum(rate(agrobridge_http_requests_total{status=~"5.."}[5m])) / sum(rate(...[5m]))` | Alert `High5xxRate >0.05` |
| 3 | Latency p50/p95 | timeseries 12×8 | `histogram_quantile(0.50/0.95, sum(rate(agrobridge_http_request_duration_seconds_bucket[5m])) by (le))` | Alert `ApiHighLatencyP95 >0.5s` |
| 4 | DB up | stat 6×4 | `agrobridge_db_up` (0/1, red/green) | Alert `DbDown ==0` |
| 5 | AI fallbacks (15m increase) | stat 6×4 | `sum(increase(agrobridge_ai_requests_total{status="fallback_success"}[15m]))` | Alert `AiFallbackSpike >10/15m` (drift vs `operations.md:58` `>20/10m` — reconcile to `10/15m` per file) |
| 6 | Payment failures (10m increase) | timeseries 12×8 | `sum by (purpose_type) (increase(agrobridge_payment_intents_total{status="failed"}[10m]))` | Alert `PaymentFailures >5/10m` |

Datasource for all: `prometheus` (`uid: prometheus`, templated as `${DS_PROMETHEUS}` in JSON). Time `now-6h → now`, refresh `30s`.

### 4.2 Panels to add (recommended, additive — no visual change to app)

Wire these additional panels via a second dashboard or by extending the same `agrobridge-overview.json` (add `id: 7..`):

| Panel | Query | Purpose |
|-------|-------|---------|
| **Instance up** | `up{job="agrobridge-api"}` | Alert `InstanceDown` health; complements `agrobridge_db_up` |
| **Rate-limited 429s** | `sum(rate(agrobridge_http_requests_total{status="429"}[5m]))` | Rate-limit drift (Phase 5) |
| **Heap / RSS** | `agrobridge_nodejs_heap_size_used_bytes`, `agrobridge_process_resident_memory_bytes` | From `collectDefaultMetrics` — OOM guard (`mem_limit 1g`) |
| **CPU seconds** | `rate(agrobridge_process_cpu_seconds_total[5m])` | Saturation signal |
| **AI provider split** | `sum by (provider,status) (rate(agrobridge_ai_requests_total[5m]))` | Quota vs offline fallback |
| **Payment success ratio** | `sum(rate(agrobridge_payment_intents_total{status="succeeded"}[5m])) / sum(rate(agrobridge_payment_intents_total[5m]))` | Business KPI (GMV health) |
| **Auth failures** | `sum(rate(agrobridge_http_requests_total{route=~"/auth.*",status=~"4.."}[5m]))` | Brute-force / lockout |
| **Saturation — event loop lag** | `agrobridge_nodejs_eventloop_lag_seconds` | Node liveness |

Keep `maxDataPoints` default; use `percentunit` for ratios, `s` for latency, `short` for counters. Add templating `$route`, `$status` if >10 routes.

### 4.3 Alerts → dashboard linkage

Each alert in `monitoring/alert_rules.yml:6-63` already has `summary`/`description`/`runbook: docs/operations.md`. When wiring Grafana alerting (optional, parallel to Prometheus), mirror the same exprs as Grafana managed alerts so on-call sees the same threshold in both.

---

## 5. Verification Steps (after the YAML is applied in a future PR)

```bash
# 1. Lint compose (no daemon needed)
docker compose -f docker-compose.prod.yml config | grep -E "prometheus|grafana|alert_rules"

# 2. Bring stack (requires .env with POSTGRES_PASSWORD, API_DATABASE_URL, JWT_*, GF_SECURITY_ADMIN_PASSWORD)
docker compose -f docker-compose.prod.yml up -d --wait

# 3. Check targets
curl -sf http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health, lastError: .lastError}'
# expect: job "agrobridge-api" health "up"

# 4. Query a metric
curl -sf http://localhost:9090/api/v1/query?query=agrobridge_http_requests_total | jq .

# 5. Grafana login
# http://localhost:3000 (or tunneled) → admin / $GF_SECURITY_ADMIN_PASSWORD → Datasource Prometheus = http://prometheus:9090 → Dashboard AgroBridge — Overview should show 6 panels with data after traffic.

# 6. Fire a test alert (optional)
# Stop db briefly: docker compose -f docker-compose.prod.yml stop db
# Wait 2m → Prometheus /alerts should show DbDown firing; Grafana panel 4 turns red.
```

**Log shipping note:** Metrics are pull-based; logs remain `pino` JSON on stdout — ship via Loki/CloudWatch sidecar per `docs/operations.md:8-10`, not via Prometheus.

---

## 6. Drift to Reconcile (before prod)

- Alert name drift: `monitoring/alert_rules.yml` uses `High5xxRate`, `ApiHighLatencyP95`, etc. while `docs/operations.md:40-59` uses `AgroBridgeHigh5xx`, `AgroBridgeHighLatency`, etc. Standardize on the file names (they are what fires) and update the doc.
- Threshold drift: `alert_rules.yml:49` `AiFallbackSpike >10/15m` vs `docs/operations.md:58` `>20/10m` — align to `10/15m`.
- `grafana-dashboard.json` datasource `uid: ${DS_PROMETHEUS}` vs provisioning `uid: prometheus` — either template the datasource or set `uid: prometheus` in the JSON.
- Scrape is unauthenticated — document `internal: true` as the access control (done) and never expose `9090/3000` on `edge`.

---

## 7. Next PR (when push allowed)

1. Create branch `feat/observability-wiring` → add YAML in §2.1 + side files §2.2 → `docker compose -f docker-compose.prod.yml config` green → `up -d` + `curl /targets` → PR → CI green (Trivy will scan new images `prom/prometheus:v2.53.4` + `grafana/grafana:11.4.0` — expect 0 HIGH after patch).
2. No app code change, no UI copy/layout change.
3. This document is the gate — do not edit `docker-compose.prod.yml` until this wiring doc is merged.
