# Phase 14 — Security Hardening (Local Prep, No Deploy)

**Status:** DOCUMENTED ONLY — no `docker/web.nginx.prod.conf` or `vercel.json` header edit applied yet (per UI-locked constraint; CSP is the only header that can break rendering)
**Date:** 2026-09-02
**Repo:** `tanviruchahs2580/AgroBridge` @ `849366f`
**Sources audited (read-only):**
- `docker/web.nginx.prod.conf:7-12` — 5 prod headers (no CSP, no X-XSS, no immutable cache for images)
- `docker/web.nginx.conf:8-12` — local nginx 3 headers (XCTO/XFO/Referrer only)
- `apps/web/vercel.json:1-7` — rewrites only (no headers at all; Vercel default is HSTS only on HTTPS)
- `apps/api/src/app.ts:39,51,82` + `apps/api/src/middleware/context.ts:15` — helmet, request-ID, `/health|/ready|/metrics`
- `apps/api/src/middleware/validate.ts:7` + `apps/api/src/middleware/audit.ts:14` + `apps/api/src/lib/logger.ts:3` — Zod validation, audit logging, redaction
- `.github/workflows/ci.yml:217-314` — 9 jobs incl. `gitleaks`, `trivy-scan`, `security-scan` (npm audit)
- `.github/workflows/codeql.yml:1-36` — CodeQL already green (`javascript-typescript`, `security-extended`)
- `.github/workflows/deploy-staging.yml:1-142` — staging scaffold (health gates, no DAST)
- `.github/dependabot.yml:1-12` — npm + github-actions weekly
- `docs/security.md`, `docs/testing.md:28` — security controls + 8 security-observability tests
- `apps/web/index.html:15-17` + `apps/web/vite.config.ts:22-67` — fonts + PWA manifest origins for CSP allow-list

---

## 1. Current State — Header Matrix (as read)

| Header | `apps/api` (helmet) `app.ts:39` | `docker/web.nginx.prod.conf:7-12` (prod nginx) | `docker/web.nginx.conf:8-12` (local) | `apps/web/vercel.json:1-7` (Vercel prod) | Verdict |
|---|---|---|---|---|---|
| **X-Content-Type-Options `nosniff`** (`XCTO`) | ✅ `helmet` default → `nosniff` | ✅ `add_header X-Content-Type-Options "nosniff" always;` | ✅ same | ❌ **absent** — Vercel HSTS-only by default, no XCTO | **Drift** — nginx has it, Vercel does not. Add to `vercel.json` + keep nginx (see §2.1). |
| **X-Frame-Options `DENY`** (`XFO`) | ✅ `helmet` → `SAMEORIGIN` by default (not DENY) | ✅ `DENY always` | ✅ `DENY always` | ❌ absent | **Drift + mild mismatch:** nginx/web `DENY` is stricter than helmet `SAMEORIGIN`. Web tier (SPA) must be `DENY`; API `SAMEORIGIN` is fine (no framing). Unified doc should state `DENY` for web, `SAMEORIGIN` for API. |
| **Referrer-Policy `strict-origin-when-cross-origin`** | ✅ `helmet` default | ✅ `strict-origin-when-cross-origin always` | ✅ same | ❌ absent | Drift — add to Vercel |
| **Strict-Transport-Security `max-age=31536000; includeSubDomains`** (`HSTS`) | ❌ `helmet` HSTS is disabled in this app (no `helmet({hsts:…})` — only global `contentSecurityPolicy: isProd ? undefined : false` at `app.ts:39`). HSTS is supplied **only** by nginx (`docker/web.nginx.prod.conf:11`) | ✅ `max-age=31536000; includeSubDomains always` | ❌ absent (`web.nginx.conf` has none) | ⚠️ Vercel supplies `Strict-Transport-Security` automatically on `*.vercel.app` (HSTS 63072000 incSubDomains) but **not declared in `vercel.json`** — implicit. | **Partial** — HSTS is live on both prod surfaces but only declared explicitly in `docker/web.nginx.prod.conf`. Declare explicitly in `vercel.json` with `63072000; includeSubDomains; preload` (Phase 1 proposal) for auditability. |
| **Permissions-Policy** `camera=(), microphone=(), geolocation=(self)` | ❌ not set by helmet | ✅ `camera=(), microphone=(), geolocation=(self) always` | ❌ absent (local conf has none) | ❌ absent | Drift — add to Vercel; add to local nginx for parity |
| **Content-Security-Policy** (`CSP`) | ⚠️ `helmet({ contentSecurityPolicy: isProd ? undefined : false })` — **disabled in non-prod, default helmet CSP in prod** (helmet default is `default-src 'self'` plus `base-uri`, `font-src 'self' https: data:`, `img-src 'self' data:`, `script-src 'self'`, etc.) | ❌ **absent** — no `add_header Content-Security-Policy` | ❌ absent | ❌ absent | **Gap — CSP only via API helmet prod default, missing from both web tiers (nginx + Vercel) where it matters most** (XSS mitigation for SPA). Needs unified CSP in `vercel.json` + nginx that mirrors helmet prod defaults plus allow-list for `fonts.googleapis|gstatic`, `https:` images (Unsplash + `data:` for PWA icons), and `connect-src` to Render API (see §2.1). |
| **Cache-Control immutable for `/assets/*`** | n/a (web tier) | ❌ only local `web.nginx.conf:28` has `7d immutable` for static; prod `web.nginx.prod.conf` has **none** for assets | ✅ `7d immutable` for `js|css|svg|png|jpg|woff2` | ❌ absent (`vercel.json` has only rewrites) | Gap — Phase 1 already proposes `vercel.json` `Cache-Control: public, max-age=31536000, immutable` for `/assets/(.*)`; prod nginx needs equivalent `location ~* \.(js|css|svg|png|jpg|avif|webp|woff2)$` with `expires 1y`. |
| **X-Request-Id** | ✅ `middleware/context.ts:15-16` — inbound `x-request-id` or `randomUUID()`, outbound `X-Request-Id`; included in `ok()` envelope `requestId` (`context.ts:20-21`) and consumed by `logger`/`errorHandler` | ❌ not propagated in `proxy_set_header X-Request-Id`? Actually `docker/web.nginx.prod.conf:20` sets `Host, X-Real-IP, X-Forwarded-*` but **no** `X-Request-Id` forward | ❌ same gap | n/a | **Gap** — browser-issued `X-Request-Id` is lost through nginx proxy; add `proxy_set_header X-Request-Id $http_x_request_id` (or generate) + `add_header X-Request-Id` echo. |
| **CORS** | ✅ `cors({ origin: env.WEB_ORIGIN.split(","), credentials:true, methods:["GET","POST","PATCH","DELETE"] })` `app.ts:40-45`; `helmet` sets `Cross-Origin-Opener-Policy` etc. | n/a | n/a | n/a | OK — restricted to `WEB_ORIGIN`, `x-powered-by` disabled (`app.ts:37`), correct. |

**Read-only evidence for “everywhere”:**

```nginx
# docker/web.nginx.prod.conf:7-12 — exactly 5 headers, no CSP
  # Security headers (prod)
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=(self)" always;

# apps/web/vercel.json:1-7 — zero headers
{ "buildCommand":"npm run build","outputDirectory":"dist","installCommand":"npm install","framework":"vite","rewrites":[{ "source":"/(.*)","destination":"/index.html" }] }
```

**Result:** the 4 easy headers (XCTO/XFO/Referrer/Permissions) and HSTS are **present in prod nginx but missing from Vercel** (where the SPA is actually served — `https://agrobridge-web.vercel.app` today) and **CSP is missing everywhere that serves HTML**. This is the Phase 14 fix scope.

---

## 2. Plan — Unified Hardening (no visual change; CSP is encoding-safe with allow-list, 0-diff gated)

### 2.1 Confirm CSP/XFO/Referrer/Permissions/XCTO everywhere — additive headers diff

#### A. CSP allow-list derivation (why these origins)

| Origin | Why required | Evidence | CSP directive |
|---|---|---|---|
| `'self'` | All JS/CSS/assets via `/assets/*`, `/icons/*`, PWA `manifest.webmanifest` | `vite.config.ts`, `dist/index.html` modulepreload | `default-src 'self'` + `script-src 'self'` + `style-src 'self' 'unsafe-inline'` (Tailwind inline styles need `'unsafe-inline'`; alternative is hash-based but tailwind needs inline — keep). |
| `https://fonts.googleapis.com` + `https://fonts.gstatic.com` | `apps/web/index.html:15-17` `<link href="https://fonts.googleapis.com … Hind Siliguri + Inter + Noto Sans Bengali">` + `index.html:21` preloads | If CSP blocks this, Bengali typography breaks — flagged in Phase 1 doc. | `style-src … https://fonts.googleapis.com`, `font-src 'self' https://fonts.gstatic.com` |
| `https:` + `data:` + `blob:` for images | `Home.tsx:28-29` Unsplash `https://images.unsplash.com …` + `public/images/services/*` (self) + `<canvas>` `data:` URIs from PWA icons + `blob:` for image `URL.createObjectURL` in disease upload preview | `apps/api/src/modules/aiagent/disease.ts` + `apps/web/src/pages/Services.tsx` | `img-src 'self' data: blob: https:` — permissive for images is intentional; no XSS risk because `script-src` remains `'self'`. |
| Render API origin | SPA `fetch` to `https://agrobridge-api-node.onrender.com` via `VITE_API_BASE_URL` (`apps/web/src/lib/api.ts:4`, `vite.config.ts:74` proxy) + `workbox` `runtimeCaching` for `/api/v1/products` (`vite.config.ts:50-54`) | `deploy-staging.yml` / `app.ts:40` `WEB_ORIGIN` | `connect-src 'self' https://agrobridge-api-node.onrender.com https://api.agro.example.com` — list both Render prod + future custom domain; `self` covers nginx same-origin `/api` proxy. |
| `frame-ancestors 'none'` | Equivalent to `XFO DENY` for CSP-aware browsers; required per Phase 1 | `docker/web.nginx.prod.conf:9` `DENY` | `frame-ancestors 'none'` |

> **No other origins required** — no `maps.googleapis.com`, no analytics beacon to third-party (analytics POSTs to `connect-src 'self'` `/api/v1/analytics` only, `apps/web/src/lib/analytics.ts:13`).

#### B. Proposed `apps/web/vercel.json` headers (overwrite file, ready to apply)

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm install",
  "framework": "vite",
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/images/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(self)" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://agrobridge-api-node.onrender.com https://api.agro.example.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Resource-Policy", "value": "same-origin" }
      ]
    }
  ],
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**UI impact:** None — CSP above is exactly Phase 1 proposal plus `base-uri`/`form-action` hardening and a second `connect-src` alias. It is the only header that could affect rendering; value is **permissive for current images/fonts** so `visual-contract` remains 0-diff. Flag in PR description: “CSP allow-lists `fonts.googleapis|gstatic`, `https:` images, Render `connect-src` — no other origins.”

#### C. Proposed `docker/web.nginx.prod.conf` additive patch (ready to apply)

```nginx
server {
  listen 80 default_server;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  # Security headers (prod) — unify with vercel.json + helmet defaults
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=(self)" always;
  add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://agrobridge-api-node.onrender.com https://api.agro.example.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
  add_header Cross-Origin-Opener-Policy "same-origin" always;
  add_header Cross-Origin-Resource-Policy "same-origin" always;

  # Request-Id propagation (so API requestId survives the nginx hop) — §2.5
  proxy_set_header X-Request-Id $http_x_request_id;
  add_header X-Request-Id $request_id always;  # $request_id is nginx's random UUID if map is unavailable

  location /api/ {
    proxy_pass http://api:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-Id $http_x_request_id;
  }

  # Immutable cache for hashed assets (including Phase 13 AVIF/WebP derivatives)
  location ~* \.(js|css|svg|png|jpg|jpeg|avif|webp|woff2?)$ {
    expires 1y;
    add_header Cache-Control "public, immutable" always;
    # security headers are inherited via `always`, no need to repeat
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

For the local tier, copy the same 4 header lines + `X-Request-Id` handling to `docker/web.nginx.conf:8-12` so `docker-compose.yml` dev parity matches prod (minus `preload` flag).

**“Everywhere” after patch:**

| Surface | Headers live |
|---|---|
| **Vercel SPA** (`vercel.json`) | XCTO+XFO+Referrer+Permissions+HSTS+CSP+COOP+CORP + immutable `/assets|/images` — all 8 |
| **Prod nginx** (`web.nginx.prod.conf`) | same 8 plus `X-Request-Id` propagation and asset cache |
| **API helmet** (`app.ts:39`) | XCTO+XFO(SAMEORIGIN)+Referrer+CSP(default in prod)+HSTS(declared via nginx, not helmet) — consistent |
| **Local nginx** | 5+ (no preload) — parity |

---

### 2.2 SAST — already green, confirm + keep

| Tool | File | Status | Next |
|---|---|---|---|
| **CodeQL** | `.github/workflows/codeql.yml:4-36` — triggers `push main`, `pull_request main`, `schedule: weekly Mon 03:17`, `security-extended` queries, `javascript-typescript` | ✅ Already wired, green per `baseline.md` (`CI 9/9 green`). Pin comment at line 21/24/29/33: “replace tag with full commit SHA before production” — should be SHA-pinned in Phase 14 same as `ci.yml` (see drift). | Keep as-is; add branch protection requirement for CodeQL check (Phase 12 `governance-branch-protection.md`). No change to logic. |

**No visual change** — SAST is CI-only.

### 2.3 Dependency scanning — Dependabot + npm audit, confirm

| Tool | File | Status | Evidence |
|---|---|---|---|
| **Dependabot** | `.github/dependabot.yml` — `npm` `/` weekly + `github-actions` `/` weekly | ✅ Active, 10 PRs frozen per Phase 12 doc (not a gap, just staged merges) | Weekly scan covers `@prisma/client`, `helmet`, `zod`, `express-rate-limit`, etc. |
| **npm audit** | `.github/workflows/ci.yml:300-301` `npm audit --audit-level=high || echo "::warning::..."` in `security-scan` job + `.github/workflows/ci.yml` is **not blocking** (warning only) | ⚠️ Non-blocking | **Proposed hardening:** add `npm audit` gate that **fails** on HIGH/CRITICAL if an `audit:high` runnable reports fixed versions (keep `--audit-level=high` plus `ignore-unfixed: true` equivalent via `.npm-audit-ignore` allow-list cross-referencing `SECURITY_WAIVERS.md` like Trivy). For Phase 14, document as additive: add `audit-ci` or `npm audit signatures` job that runs `npm audit --audit-level=high --json | node scripts/audit-gate.mjs` and enforces allow-list. |
| **Trivy container scan** | `.github/workflows/ci.yml:256-284` `trivy-scan` on `agrobridge-api:scan` `severity:HIGH,CRITICAL exit-code:1 ignore-unfixed:true` | ✅ Green, blocking | Covers OS/library CVEs in `docker/api.Dockerfile` base image. |

**Dependency scanning after Phase 14 is thus:** Dependabot (weekly) **+** npm audit (CI, tightened to blocking on HIGH/CRITICAL with allow-list) **+** Trivy (container, blocking). This satisfies `SECURITY.md` promise `Dependency scanning — npm audit on every push/PR`.

### 2.4 Secret scanning — already wired, confirm

| Tool | File | Status |
|---|---|---|
| **Gitleaks** | `.github/workflows/ci.yml:217-228` `gitleaks` job — `actions/checkout fetch-depth:0` + `gitleaks/gitleaks-action@ff9810…` pin `v2.3.9`, `GITHUB_TOKEN`, `timeout 20m` | ✅ green |
| **Heuristic fallback** | `ci.yml:303-313` `security-scan` step — `BEGIN␣PRIVATE␣KEY` (private-key header) + `postgres://…:…@` scan with allow-list `dummy|ci-password|example|changeme` | ✅ defense-in-depth |
| **Logger redaction** | `apps/api/src/lib/logger.ts:3,8` `redactPaths` incl. `authorization, cookie, *.password, *.token, S3_SECRET_ACCESS_KEY` | ✅ live — `docs/REMEDIATION_REPORT.md:40` already fixed top-level `password` leak |

**No change needed** — Phase 14 links these three as “secret scanning”.

### 2.5 DAST against staging — new `dast` job (only new CI job in Phase 14)

DAST runs **only after staging deploy** and only on demand / after staging deploy — not on every PR (to avoid hitting prod). Wired as a new job in `ci.yml` (isolated, does not block other jobs if staging secrets are absent — `if: vars.STAGING_BASE_URL != ''` guard).

**Tool choice: OWASP ZAP baseline scan** (`zaproxy/action-baseline`) — zero-config, passive crawl, HIGH/CRITICAL fail, HTML+JSON report artifact. Alternative is `nikto` or `nuclei` but ZAP baseline is the simplest that produces `WARN-NEW` arrivals on header regressions (e.g., missing CSP).

**Prerequisites:** `deploy-staging.yml` must have finished and `vars.STAGING_BASE_URL` must be set (Phase 1 follow-up). `STAGING_BASE_URL` defaults to `https://staging.agro.example.com` placeholder — Phase 14 doc calls out that the variable must be set before the job does useful work.

---

### 2.6 Request-ID validation — confirm + tighten

| Layer | Implementation | Validation | Evidence |
|---|---|---|---|
| **Ingress propagation** | `apps/api/src/middleware/context.ts:14-18` `req.requestId = (req.headers["x-request-id"] as string) || randomUUID()` + `res.setHeader("X-Request-Id", req.requestId)` | ⚠️ **No validation** — any header value is trusted (could be 10 KB string, newline injection, or non-UUID). | `context.ts:15` |
| **Logging** | `apps/api/src/lib/logger.ts:8` `base: {service:"agrobridge-api"}` + `requestId` is added by `errorHandler` / explicit log calls; `context.ts` itself does not log | okay | |
| **Nginx propagation** | today: not forwarded (gap) → proposed `proxy_set_header X-Request-Id $http_x_request_id` | after patch: validated | |

**Hardening (proposed, additive, non-visual):**

```ts
// apps/api/src/middleware/context.ts — validate request-ID before accepting it
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQ_ID_MAX = 128;

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const raw = req.headers["x-request-id"] as string | undefined;
  const candidate = raw?.trim();
  const validated = candidate
    && candidate.length <= REQ_ID_MAX
    && /^[A-Za-z0-9._~\/+=-]+$/.test(candidate)  // allow UUIDv4 + w3c traceparent + short tokens
    // or strictly: UUID_RE.test(candidate) — keep permissive to avoid breaking mobile/web pre-set IDs
    ? candidate
    : randomUUID();
  req.requestId = validated;
  res.setHeader("X-Request-Id", validated);
  // Also emit w3c traceparent for observability correlation (no break)
  res.setHeader("X-Trace-Id", validated);
  next();
}
```

**Why permissive regex not strict UUID:** Capacitor apps may set `x-request-id` via `crypto.randomUUID()` (UUID) but also `traceparent` (`00-<trace>-<span>-01`). Rejecting non-UUID would turn a non-visual correlation loss into a functional change. So: allow `A-Za-z0-9._~\/+=-` up to 128 chars, reject control chars / newlines (prevents log injection / CRLF split). Keep `randomUUID()` fallback for missing/invalid.

**Test harness (additive, no visual):** `tests/request-id.test.ts` — case: valid UUID passthrough, oversized truncates to new UUID, CRLF string → new UUID, missing → new UUID, response echo `X-Request-Id`. Already covered loosely by `security-observability.test.ts:22` `expect(res.headers["x-request-id"]).toBeDefined()` — refines it.

---

### 2.7 Input validation — already via Zod, confirm

| Surface | Implementation | Evidence |
|---|---|---|
| **Body/query/params** | `apps/api/src/middleware/validate.ts:7-28` — `validate({ body, query, params })` with `safeParse` + `badRequest` mapping of `issues[].path + message`, assigns coerced values back | All farmer/market/service/booking/payment routes use `validate({ body: z.object({...}) })` — e.g., `apps/api/src/modules/farms/routes.ts:13,70,87` `farmBody`, `apps/api/src/modules/marketplace/routes.ts:21,69`, `apps/api/src/modules/services/routes.ts:41`. |
| **Body limits** | `apps/api/src/app.ts:48-49` `express.json({limit:"1mb"}), urlencoded({limit:"200kb"})` + `disease.ts` 8 MB multipart cap with magic-byte check | `PRODUCTION_CERTIFICATION_REPORT.md:35` PASS |
| **BD phone regex** | `z.string().regex(/^01[3-9]\\d{8}$/)` in auth + marketplace shipping | marketplace checkout `shippingPhone` `apps/api/src/modules/marketplace/routes.ts:181-183` (optional) |
| **File upload** | MIME allowlist + magic sniff + cap | `disease.ts:16` + `docs/ai.md:30` |

**No gap** — input validation is enterprise-ready (122 `req.auth!` / 33 `params!` type unsafety is Phase 2, not a validation gap). Phase 14 adds only **response validation** (§2.8) to complement it.

### 2.8 Response validation — contracts (new, additive)

**Gap:** `apps/web/src/lib/api.ts:282` `return json.data as T` is an unchecked cast — `packages/contracts` Zod schemas planned in Phase 7 (see `docs/generated/remaining-phases-3-7-8-9-11-12.md:35`) are not yet authoritative in the critical paths `Market.tsx:127` cart, `Wallet.tsx:213` summary. Phase 14 makes response validation live on the **API side** first (safer — no UI risk), and web side as opt-in `contract.fetch`.

**A. API-side: validate outgoing `ok(res, data)` payloads against contract schemas (fail closed in test, warn in prod)**

Create `packages/contracts` (or `apps/api/src/lib/contracts.ts` if workspace package is not yet configured — keep additive):

```ts
// packages/contracts/src/farms.ts — example, not exhaustive
import { z } from "zod";
export const FarmSchema = z.object({
  id: z.string().uuid(), name: z.string().min(2), ownerId: z.string(),
  plots: z.array(z.object({ id: z.string(), cropCycles: z.array(z.object({ id: z.string(), cropName: z.string(), stage: z.string() })) })),
});
export const FarmListOut = z.array(FarmSchema);
// similarly: CartOut, WalletOut, OrderOut, etc.
```

Wire a helper:

```ts
// apps/api/src/middleware/context.ts — add after ok()
export function okValidated<T>(res: Response, schema: z.ZodSchema<T>, data: unknown, status=200) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    // In test: throw to fail the offending handler. In prod: log and still send (soft-fail until contracts stabilize)
    if (process.env.NODE_ENV === "test") throw new Error(`Contract violation: ${JSON.stringify(parsed.error.issues)}`);
    logger.warn({ issues: parsed.error.issues }, "contract violation — sending raw data");
    return ok(res, data, status);
  }
  return ok(res, parsed.data, status);
}
```

Adopt incrementally: start with `farms/routes.ts:64` `FarmListOut` and `marketplace/routes.ts:63` product list and `Wallet` summary — the three hot paths audited in §1.2. Roll out one route per commit with handler-level unit test.

**B. Web-side: validate critical fetch responses (Market cart, Wallet summary) before render**

```ts
// apps/web/src/lib/contract.ts — new
import { z } from "zod";
import { api, ApiError } from "./api.js";
export async function contractFetch<T>(method:string, path:string, schema: z.ZodSchema<T>, body?:unknown): Promise<T> {
  const data = await api<unknown>(method, path, body);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiError(502, "BAD_RESPONSE", "Malformed server response", parsed.error.issues);
  return parsed.data;
}
```

Use at `Market.tsx:127` (`queryKeys.market.cart`) and `Wallet.tsx:213` — rest of pages stay on `api<T>()` until rollout proves 0-diff (same JSON, only validated).

**Test gate:** `apps/api/tests/contracts.test.ts` — feed malformed `farm.findMany` row with missing `cropName` → expect 500 in `test` mode; malformed cart response → `BAD_RESPONSE` in web contract fetch.

---

### 2.9 Audit logging — confirm + minor hardening

| Surface | Implementation | Evidence | Phase 14 action |
|---|---|---|---|
| **Audit helper** | `apps/api/src/middleware/audit.ts:6-28` `audit({actorId, action, entityType, entityId, ip, meta})` → `prisma.auditLog.create({metaStr: JSON.stringify(meta)})`, never blocks response (logs warn on failure) | `audit.ts:14-22` | — Keep. |
| **Call sites** | `marketplace/routes.ts:249-254` `ORDER_CHECKOUT`, `payments/routes.ts` intent/confirm, `admin/routes.ts:222` `WITHDRAWAL_*`, `organizations/routes.ts`, `auth/routes.ts` registration/login | `grep audit(` 7 files | — Keep. |
| **IP capture** | `auditMiddleware` passes `req.ip` (`audit.ts:34`); but `app.set("trust proxy", env.TRUST_PROXY)` so `req.ip` respects `X-Forwarded-For` via nginx | `app.ts:36` | — Confirm `TRUST_PROXY` is set to `1` in prod (not `false`) so IP is real client, not `api` container. Document in `docs/operations.md`. |
| **Request-ID inside audit** | not yet stored | gap | **Proposed:** include `requestId: req.requestId` in `meta` for every call via `auditMiddleware` + per-call `audit({requestId: req.requestId, ...})` (requires `auditLog` model to have `requestId` column or inline in `metaStr`). Improves incident correlation with `context.ts`. Add `requestId` to top-level `audit({requestId, ...})` param and serialize into `metaStr.requestId` (no schema migration required for v1; column can be added in Phase 10 migration window). |
| **Retention** | `audit_logs` append-only, no rotation described | gap for compliance | Document retention policy (e.g., 365d) and index on `createdAt` + `actorId` — already indexed by Prisma default on `createdAt`. |

**Validation / correctness gate:** `apps/api/tests/audit.test.ts` (new) — after `ORDER_CHECKOUT` or `ADMIN_USER_UPDATE`, query `auditLog` table for `action` + `actorId` + `requestId` parity with response `X-Request-Id`.

---

### 2.10 Additional defense-in-depth (no UI impact, included in Phase 14 PR)

| Control | Current | Proposed |
|---|---|---|
| **Global rate limiting** | `apps/api/src/app.ts:54-64` globalLimiter `env.RATE_LIMIT_WINDOW_MINUTES * 60s`, `env.RATE_LIMIT_MAX`, `standardHeaders:true`, `skip: NODE_ENV==="development"`, `store: sharedStore` (Redis if `REDIS_URL`) | Keep. Phase 5 SPRINT2 fixes `rateLimitRedis.ts:43` TTL drift (15m hardcode vs 1h OTP) — note as dependency, not part of Phase 14. |
| **Per-endpoint limits** | Auth login 5/15m, OTP 3/h, AI per-hour (memory) | Phase 5 — keep documented. |
| **Helmet completeness** | `helmet({contentSecurityPolicy: isProd ? undefined : false})` enables defaults in prod (incl. CSP default if missing). Good — endpoint CSP now mirrors web headers. | Verify `helmet` version `8.x` and defaults; no change. |
| **CORS** | `WEB_ORIGIN` allowlist, credentials, limited methods | No change — already locked. |
| **Body & multipart guards** | 1 MB JSON / 200 KB urlencoded / 8 MB multipart + magic bytes | No change. |
| **Log redaction** | `logger.ts:3` redactPaths 10 entries incl. `S3_SECRET_ACCESS_KEY` | No change — already fixed (`REMEDIATION_REPORT.md:40`). |

---

## 3. CI YAML snippet — new `dast` job (to insert in `.github/workflows/ci.yml`)

Place after `trivy-scan` (or `deploy-staging` in a dedicated `dast.yml` — either works). Below is the `ci.yml`-embedded variant per the task spec. Requires `vars.STAGING_BASE_URL` to be set (e.g., `https://staging.agro.example.com`) — job skips gracefully if absent.

```yaml
  # ── NEW in Phase 14 — must be added verbatim to .github/workflows/ci.yml ──
  dast:
    name: Security — DAST (OWASP ZAP baseline against staging)
    runs-on: ubuntu-latest
    timeout-minutes: 30
    # Run only after staging deploy, or manually, and only when staging URL is configured.
    # This keeps PR CI fast and avoids scanning prod.
    if: >-
      vars.STAGING_BASE_URL != '' &&
      (github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/v') || github.ref == 'refs/heads/main')
    needs: [docker-build]
    env:
      STAGING_BASE_URL: ${{ vars.STAGING_BASE_URL || 'https://staging.agro.example.com' }}
    steps:
      - name: Guard — staging URL must be configured
        run: |
          if [ -z "${{ vars.STAGING_BASE_URL }}" ]; then
            echo "::notice::STAGING_BASE_URL not set — skipping DAST (set repo VARIABLE STAGING_BASE_URL to enable)"
            exit 0
          fi
          echo "Scanning ${{ env.STAGING_BASE_URL }}"
          curl -fsS --max-time 15 "${{ env.STAGING_BASE_URL }}/" | grep -q '<div id="root">' || { echo "::warning::Staging web not reachable — ZAP will report no results"; }

      - name: ZAP Baseline Scan (passive + spider, alerts HIGH/CRITICAL fail)
        uses: zaproxy/action-baseline@v0.14.0
        with:
          target: ${{ env.STAGING_BASE_URL }}
          rules_file_name: .zap/rules.tsv
          cmd_options: >-
            -a
            -j
            -I
            -r zap-report.html
            -J zap-report.json
            -w zap-md-report.md
          # -a: include alpha rules, -j: JSON, -I: fail only on HIGH/CRITICAL (not LOW/MEDIUM noise)
          # Baseline is crawled passively — safe for staging; active scan is a separate nightly job if desired.

      - name: Assert header regressions (CasperJS-light — header audit without ZAP)
        if: always()
        run: |
          echo "::group::Header audit (Casper-light)"
          base="${{ env.STAGING_BASE_URL }}"
          # Follow redirects, capture headers
          for url in "$base/" "$base/api/v1/health" 2>/dev/null; do :; done || true
          # Check SPA root headers
          h=$(curl -skI "$base/" || true)
          echo "$h" | tr -d '\r' | grep -qi '^X-Content-Type-Options:\s*nosniff' || echo "::warning::Missing X-Content-Type-Options on $base/"
          echo "$h" | tr -d '\r' | grep -qi '^X-Frame-Options:\s*DENY'        || echo "::warning::Missing X-Frame-Options DENY on $base/"
          echo "$h" | tr -d '\r' | grep -qi '^Referrer-Policy:'               || echo "::warning::Missing Referrer-Policy on $base/"
          echo "$h" | tr -d '\r' | grep -qi '^Content-Security-Policy:'       || echo "::error::CSP missing on $base/ — Phase 14 gap"
          echo "$h" | tr -d '\r' | grep -qi '^Permissions-Policy:'             || echo "::warning::Missing Permissions-Policy on $base/"
          echo "::endgroup::"

      - name: Upload ZAP reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: zap-dast-reports
          path: |
            zap-report.html
            zap-report.json
            zap-md-report.md
            report_html.html
            report_json.json
          if-no-files-found: warn

      - name: Upload SARIF to code scanning (optional — shows ZAP findings alongside CodeQL)
        if: always() && hashFiles('report_json.json') != ''
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: report_json.json
```

**Supporting files (create alongside the job):**

`.zap/rules.tsv` (per-ZAP false-positive tuning — new file):

```
# tsv: ruleId   status   newLevel
# Ignore low-risk ZAP noise that AgroBridge intentionally allows
10020	IGNORE	(INFO)	# X-Frame-Options DENY is set, but ZAP also checks CSP frame-ancestors — we have both, ignore legacy rule
10038	IGNORE	(INFO)	# Content-Security-Policy — we tune separately via header audit above
```

**Hardening for the scan itself:**

```yaml
# Optional: aggressive weekly variant — separate workflow `.github/workflows/dast-full.yml`
# Runs `zaproxy/action-full-scan` (active scan) only on `schedule: cron: "0 2 * * 1"` against staging,
# with `allow_issue_writing: false` so findings file an artifact, not an auto-PR.
```

**Why `needs: [docker-build]` and not `needs: [deploy-staging]`:** `ci.yml`’s `docker-build` is on every branch (always available), while `deploy-staging` lives in its own workflow file. To keep DAST self-contained in `ci.yml`, gate it on a var + ref filter instead of cross-workflow `needs`. A follow-up `workflow_call` from `deploy-staging.yml → dast.yml` can be added later (not required for Phase 14).

---

## 4. Verification Steps (after patch in a future PR)

### 4.1 Headers everywhere (live probe)

```bash
# 1. Render the committed vercel.json headers (no daemon needed)
cat apps/web/vercel.json | python3 -m json.tool | grep -A2 -E "Cache-Control|Content-Security|Strict-Transport"

# 2. Lint nginx configs (requires docker locally)
docker run --rm -v "$PWD/docker/web.nginx.prod.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t

# 3. After deploy to Vercel staging domain (or prod preview):
STAGING="https://staging.agro.example.com"   # or https://agrobridge-web.vercel.app for preview
curl -s -D - "$STAGING/" -o /dev/null | tr -d '\r' | grep -iE '^(X-Content-Type-Options|X-Frame-Options|Referrer-Policy|Strict-Transport-Security|Permissions-Policy|Content-Security-Policy|X-Request-Id):'
# expect all 6 present; CSP value must contain default-src 'self' and frame-ancestors 'none'

curl -s -D - "$STAGING/assets/index-"*.js -o /dev/null 2>/dev/null | grep -i Cache-Control | grep -q immutable && echo "immutable OK"

# 4. Header drift check — same shape on both tiers
curl -skI https://agrobridge-web.vercel.app/ | tr -d '\r' | sort -f > /tmp/vercel.headers
cat docker/web.nginx.prod.conf | grep add_header | sed 's/.*add_header //; s/ always;//' | sort -f > /tmp/nginx.headers
diff -u /tmp/nginx.headers /tmp/vercel.headers || true  # only delta should be value of HSTS max-age (31536000 vs 63072000)
```

### 4.2 Security scans (CI)

```bash
# SAST
gh workflow view CodeQL --web    # expect green on main + schedule weekly

# Dependency
npm audit --audit-level=high     # expect 0 HIGH/CRITICAL or allow-listed waivers in SECURITY_WAIVERS.md

# Secret scan
gitleaks detect --source . -v --redact --exit-code 1   # expect clean (mirrors ci job)

# DAST locally (without waiting for CI)
docker run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://staging.agro.example.com -r /tmp/zap.html -J /tmp/zap.json -I
cat /tmp/zap.json | jq '.site[0].alerts[] | {name:.name, risk:.riskdesc}'
```

### 4.3 Request-ID + validation + contracts + audit (API)

```bash
# Request-ID validation
curl -s http://localhost:4000/api/v1/auth/me -H "X-Request-Id: 018f0e2a-b2c4-7e6f-9a1b-c2d3e4f5a6b7" -H "Authorization: Bearer <jwt>" -D - | grep -i X-Request-Id
# expect echoed same UUID, not regenerated
curl -s http://localhost:4000/api/v1/auth/me -H "X-Request-Id: $(python3 -c 'print(\"x\"*500)')" -H "Authorization: Bearer <jwt>" -D - | grep -i X-Request-Id
# expect new UUID (oversized rejected)

# Zod input validation
curl -s http://localhost:4000/api/v1/products?search=$(python3 -c 'print(\"x\"*200)') | jq .error
# expect 400 Invalid query (length cap 80 at marketplace/routes.ts:36)

# Response contract validation (after okValidated rollout)
NODE_ENV=test npm --workspace @agrobridge/api test contracts.test.ts

# Audit log correlation
curl -s http://localhost:4000/api/v1/admin/users -H "X-Request-Id: test-correlation-$RANDOM" -H "Authorization: Bearer <admin-jwt>" | jq .requestId
# then in psql: SELECT action, "actorId", "metaStr" FROM "AuditLog" ORDER BY "createdAt" DESC LIMIT 1; — metaStr should contain requestId
```

### 4.4 No visual change

```bash
npm --prefix apps/web run build
npm --prefix apps/web run test:e2e -- e2e/visual-contract.spec.ts
# expect 8 passed, 0 diffs — headers/CSP allow-list is encoding-safe
```

---

## 5. Files Verified (existence check, 2026-09-02)

| Path | Exists | Notes |
|---|---|---|
| `docker/web.nginx.prod.conf:7-12` | ✅ | 5 headers, no CSP, no `X-Request-Id` forward, no asset cache beyond `try_files` |
| `docker/web.nginx.conf:8-12` | ✅ | 3 headers locally — drift vs prod |
| `apps/web/vercel.json:1-7` | ✅ | rewrite-only, **zero** security headers (gap this phase closes) |
| `apps/api/src/app.ts:39,51` | ✅ | `helmet({contentSecurityPolicy: isProd?undefined:false})`, `requestContext`, `metricsMiddleware` |
| `apps/api/src/middleware/context.ts:15` | ✅ | `x-request-id || randomUUID()` — no validation (gap §2.6) |
| `apps/api/src/middleware/validate.ts:7` | ✅ | Zod validation for body/query/params |
| `apps/api/src/middleware/audit.ts:14` | ✅ | `audit({actorId,action,entityType,entityId,ip,meta})` |
| `apps/api/src/lib/logger.ts:3,8` | ✅ | redaction 10 paths including `S3_SECRET_ACCESS_KEY` |
| `.github/workflows/ci.yml:217-314` | ✅ | 9 jobs; `gitleaks` + `security-scan` (npm audit warn) + `trivy-scan` HIGH/CRITICAL block |
| `.github/workflows/codeql.yml` | ✅ | `javascript-typescript`, `security-extended`, weekly Mon 03:17 — **already green** |
| `.github/workflows/deploy-staging.yml` | ✅ | scaffold with `/health`+`/ready` + `STAGING_BASE_URL` placeholder — DAST target |
| `.github/dependabot.yml:1-12` | ✅ | npm + gha weekly |
| `apps/web/index.html:15-17` | ✅ | `fonts.googleapis.com/css2…Inter+Noto+Hind` — CSP allow-list source |
| `apps/web/vite.config.ts:22-67` | ✅ | PWA manifest origins — CSP `connect-src` source |

---

## 6. Implementation Order (when push allowed) — separate from Phase 13

1. **PR `sec/phase14-headers-and-hardening`** — branch from `main` @ `849366f`, **do not combine with `perf/phase13-*`**
   - Commit 1: `sec(web): unify security headers — vercel.json + web.nginx.prod.conf CSP/XCTO/XFO/Referrer/Permissions/HSTS + immutable /assets|/images + X-Request-Id forward` — §2.1 B+C (infra-only, 2 files)
   - Commit 2: `sec(api): validate X-Request-Id, propagate via nginx, echo X-Trace-Id` — `middleware/context.ts:15` + `docker/web.nginx.prod.conf:proxy_set_header` + test `request-id.test.ts`
   - Commit 3: `sec(api): response contracts (Farm/Cart/Wallet) — okValidated` — `packages/contracts` or `lib/contracts.ts` + `okValidated` helper + 2 route adopters + `contracts.test.ts`
   - Commit 4: `sec(api): include requestId in audit meta, document IP trust-proxy` — `middleware/audit.ts:14` + `docs/operations.md` note
   - Commit 5: `ci(sec): add DAST baseline against staging + header regression check` — `.github/workflows/ci.yml` `dast` job + `.zap/rules.tsv` + this doc
   - Commit 6: `docs: phase14-security-hardening.md` — this file (already present; update with live header curl transcript after deploy)
   - (Separate follow-up if desired) `ci(sec): harden npm audit to blocking HIGH/CRITICAL with allow-list` — tightens `ci.yml:300-301` from warn→fail.

2. **CI gate per commit:** `api-quality` + `api-postgres` + `web quality build` + `web-e2e visual-contract 8/8` + `gitleaks` + `trivy-scan` + (on push to `main`/tag) `dast` (if `STAGING_BASE_URL` set) — **no visual diff failures expected** (CSP allow-list keeps fonts/images).

3. **If any 0-diff failure:** revert commit 1 only (header layer) and re-allow-list the blocked origin observed in `Content-Security-Policy-Report-Only` dry-run mode. Phase 14 proposes landing headers with `Content-Security-Policy` (enforcing) directly because allow-list is already derived — alternative is 1-day `Report-Only` canary via second header `Content-Security-Policy-Report-Only` if team prefers canary. Keep PR description explicit: `fonts.googleapis|gstatic`, `https:` images, `connect-src` Render origin.

---

## 7. Drift & Open Items

- **Helmet CSP vs nginx/vercel CSP value sync:** `app.ts:39` helmet prod default CSP vs web-tier explicit CSP must stay identical — document single `CSP_VALUE` constant shared via `SECURITY_HEADERS.md` or env `WEB_CSP` to avoid divergence. Current doc derives CSP string in one place (§2.1 B) for both tiers.
- **Preload vs no-preload for HSTS:** Phase 1 vercel proposal uses `63072000; includeSubDomains; preload` while prod nginx currently uses `31536000; includeSubDomains` (no preload). §2.1 unifies to `63072000` + `preload` everywhere — requires domain not being on HSTS preload list incorrectly; flag for infra review.
- **Dependabot PRs unmerged (10)** flagged in Phase 12 — handled there, not in Phase 14.
- **DAST active scan (`zap full`) not in scope** — kept passive baseline only; nightly active scan can be added later as `dast-full.yml` weekly.
- **Broader CSP strictness (`script-src 'strict-dynamic'`, nonces)** deferred — `'self'` remains safe while no `unsafe-inline` scripts exist; moving to nonces would require Vite hash plumbing and is a separate hardening cycle.
- **Rate-limit Redis TTL fix** (`rateLimitRedis.ts:43`) stays in Phase 5 — not duplicated here.

---

*End of Phase 14 plan — headers unified everywhere (CSP/XFO/Referrer/Permissions/XCTO), SAST (CodeQL green) + Dependabot + npm audit + gitleaks preserved, DAST baseline against staging added (new `dast` job), request-ID validated, Zod input + contract response + audit logging hardened, no visual change.*
