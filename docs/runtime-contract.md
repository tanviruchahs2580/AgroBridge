# Runtime contract

What this deployment actually runs on, what the platform guarantees around it, and what fails
first when those guarantees are hit. Platform limits below were read from Vercel's official
documentation on **2026-10-19** and are quoted with their source URL. Everything observed (rather
than documented) is labelled as observed; anything not measured in this repository is marked
**UNVERIFIED**.

## Topology

| Component | Runtime | Evidence |
|---|---|---|
| Web SPA | Vercel static deployment, project `agrobridge-web` | `docs/runbooks/live-deployment.md` (topology table); `apps/web/vercel.json` (`framework: vite`, SPA rewrite, header set) |
| API | Vercel Functions via `@vercel/node`, entry `api/index.js` importing `../dist/app.js` | `docs/runbooks/live-deployment.md` ("Function bundle facts"); `apps/api/vercel.json` |
| Database | PostgreSQL on Neon (Vercel Marketplace integration) behind the API function | `docs/runbooks/live-deployment.md`; `/ready` reports `db: true` in `.audit/evidence/E-V2-live-probes.txt` |
| Rate-limit store | In-process memory unless `REDIS_URL` is set; `/ready` publishes which is active | `apps/api/src/app.ts:26-39`; live `/ready` reports `"limiterStore":"memory"` (`.audit/evidence/E-V2-live-probes.txt`) |
| Metrics | Prometheus scrape of `api:4000/metrics` (compose network); `/metrics` guarded in production | `monitoring/prometheus.yml`; `apps/api/src/middleware/metricsGuard.ts` |

## Observed regions (live probes, 2026-10-19)

| Surface | Observed | Evidence |
|---|---|---|
| Web edge | `bom1` (Mumbai) | `X-Vercel-Id: bom1::m65x2-…` in `.audit/evidence/E-V2-live-probes.txt:28` |
| API function execution | `iad1` (US East) | `X-Vercel-Id: bom1::iad1::…` in `.audit/evidence/E-V2-live-probes.txt:40` |

The function region is not pinned anywhere in the repository: neither `apps/api/vercel.json` nor
`apps/web/vercel.json` contains a `regions` or `functions` block. Vercel's documentation states
Functions "run in a single region by default (`iad1`)" and that only Pro/Enterprise teams can set
multiple regions (`https://vercel.com/docs/functions/limitations`, accessed 2026-10-19) — the
observed `iad1` is consistent with the platform default, not with a repository decision.

Consequence, not measured: every API round trip from Bangladesh crosses to `iad1` while static
assets are served from `bom1`. Time to first byte from a BD vantage is **UNVERIFIED** — no probe
or measurement exists in the repository or in `qa-evidence/`.

## Platform limits (Vercel documentation, accessed 2026-10-19)

Source: `https://vercel.com/docs/functions/limitations` and
`https://vercel.com/docs/functions/configuring-functions/duration` (both last updated 2026-08-24
per the pages; fetched 2026-10-19).

| Limit | Documented value | Quote |
|---|---|---|
| Max duration | Hobby: 300 s default and maximum. Pro/Enterprise: 300 s default, 800 s maximum, 1800 s extended maximum in Beta | "Hobby: 300s default and maximum. Pro and Enterprise: 300s default, 800s maximum, and 1800s extended maximum Beta." |
| Timeout behaviour | The invocation is terminated and a 504 `FUNCTION_INVOCATION_TIMEOUT` is returned | "If a Vercel Function doesn't complete within the duration, a 504 error code (`FUNCTION_INVOCATION_TIMEOUT`) is returned." |
| Request/response payload | 4.5 MB maximum for request body or response body | "The maximum payload size for the request body or the response body of a Vercel Function is **4.5 MB**." |
| Oversized payload behaviour | 413 `FUNCTION_PAYLOAD_TOO_LARGE` | "If a Vercel Function receives a payload in excess of the limit it will return an error 413: `FUNCTION_PAYLOAD_TOO_LARGE`." |
| Memory | Hobby: 2 GB / 1 vCPU. Pro/Enterprise: 2 GB default, 4 GB / 2 vCPU maximum | "Default 2 GB / 1 vCPU, Maximum 4 GB / 2 vCPU" (Pro/Enterprise table) |
| Bundle size | 250 MB uncompressed (500 MB Python) | "For Vercel Functions, the maximum uncompressed size is **250 MB** including layers" |
| File descriptors | 1,024 shared across concurrent executions, including runtime usage | "Vercel Functions have a limit of **1,024 file descriptors** shared across all concurrent executions." |
| Region default | Single region `iad1` by default; multiple regions on Pro/Enterprise | "Runs in a single region by default (`iad1`), which you can change." |

The repository configures **no `maxDuration` and no `regions`** today (`apps/api/vercel.json`:
`framework`, `installCommand`, `buildCommand`, `outputDirectory`, `rewrites` only), so the
effective duration is the plan default (300 s per the documentation above) and the region is
whatever the project/dashboard default is — observed `iad1`.

Plan tier of the production projects is **UNVERIFIED** from the repository (no plan identifier is
committed and no credentials are available to query the team). The duration maximum in force is
therefore whichever row of the table above applies to the owner's account.

## Prisma and the database connection

- The API constructs one `PrismaClient` per process with no datasource overrides and no explicit
  pool settings: `apps/api/src/infrastructure/database/prisma.ts` (`new PrismaClient({ log })`).
  `apps/api/src/lib/prisma.ts` is a re-export shim.
- All connection behaviour therefore comes from the `DATABASE_URL` injected by the Neon
  integration. The runbook records that Neon supplies pooled and unpooled URLs
  (`docs/runbooks/live-deployment.md`: "pooled + unpooled URLs both provided"; migrations use the
  unpooled URL for DDL).
- The repository does not set `connection_limit`, `pool_timeout`, or `pgbouncer=true` — whether
  the pooler is PgBouncer, transaction-mode or Neon's own proxy is operator/platform config, not
  visible in code. Neon connection limits per plan are **UNVERIFIED** here; they belong in the
  owner's Neon console.
- Serverless instances each hold their own client: with N warm function instances there can be N
  pools. The platform auto-scales functions up to 30,000 concurrency on Hobby/Pro per the Vercel
  documentation above; the database is the practical ceiling, and it is unmeasured.

## Application-level timeouts (from code)

| Path | Timeout | Evidence |
|---|---|---|
| AI provider request | 20 s, then a typed `TIMEOUT` error | `apps/api/src/providers/ai/openai-compat.ts:34,163,174` |
| Weather provider fetch (current and forecast) | 8 s | `apps/api/src/providers/weather/openweather.ts:5,13,38` |
| S3-compatible storage request | 30 s | `apps/api/src/providers/storage/s3.ts:75` |
| Checkout / payout / webhook / withdrawal Prisma transactions | `timeout: 15000`, `maxWait: 8000` | `apps/api/src/modules/marketplace/routes.ts:442`; `apps/api/src/modules/payments/routes.ts:523`; `apps/api/src/modules/payments/webhook.ts:92` |
| Global rate-limit window | 15 min, 300 requests per window per instance/key | `apps/api/src/config/env.ts:26-27`; `apps/api/src/app.ts:76-87` |

## What breaks first

Ordered by how little it takes to hit the limit, with the failure the user sees:

1. **Disease photo upload between 4.5 MB and 8 MB.** The application accepts images up to 8 MB
   (`apps/api/src/modules/disease/routes.ts:19,47`) but Vercel rejects any request body over
   4.5 MB with 413 `FUNCTION_PAYLOAD_TOO_LARGE` before the app runs. The in-app copy says 8 MB
   (`apps/web/src/lib/i18n.ts`, `imageTooLarge`), so a 5–8 MB photo fails at the edge with a
   platform error. Files under 4.5 MB behave as documented.
2. **A slow provider plus a retry.** The AI adapter has one bounded retry with a 20 s timeout each
   (`apps/api/src/providers/ai/openai-compat.ts`); back-to-back retries plus DB work stay far
   below the 300 s default duration, so the platform timeout is not the binding constraint. The
   binding constraint is the client, which sees a slow answer rather than a 504.
3. **The rate limiter under scale-out.** Without `REDIS_URL` each instance enforces its own
   window, so the effective quota is instances × limit and the limiter fails open rather than
   closed (`apps/api/src/app.ts:31-39`, documented in `docs/security.md`). Production reports
   `limiterStore: "memory"`.
4. **Connections to Neon under concurrency.** No pool configuration exists in code; if function
   concurrency rises faster than the Neon plan's connection ceiling, requests fail at connect
   time. Threshold **UNVERIFIED** (plan-dependent).
5. **A 15 s transaction under load.** Checkout, payout and webhook claims abort at 15 s with a
   Prisma P2028. At pilot volume this has not been observed; there is no production measurement
   either way.
6. **Metrics cardinality.** `agrobridge_http_request_duration_seconds` is labelled by matched
   route pattern and status, not raw URL (`apps/api/src/infrastructure/metrics.ts:44-58`), so
   scanner traffic cannot mint unbounded label sets — this is a controlled risk, not a first
   breaker.
7. **Function duration.** The default 300 s is far above every in-app operation; nothing in the
   request path is designed to run longer than ~20 s. Long-running work does not exist server-side
   by design (ADR-0010: no queue).

## Owner decisions this contract depends on

- Pin `regions` (e.g. `bom1`) and/or set `functions.maxDuration` explicitly, or record that the
  platform defaults are accepted (`.audit/v2/DECISIONS.md` leaves this to the owner; see
  `.audit/v2/FINDINGS.md` runtime finding).
- Decide the Neon plan and connection strategy, and record the ceiling in this file.
- Decide whether uploads above the platform 4.5 MB cap should be rejected client-side and re-label
  the 8 MB copy.

## Vendor lock-in and exit notes

The stack deliberately keeps exit paths open; this is the map the operations audit asks for.

| Layer | Provider today | Lock-in shape | Exit path (tested?) |
|---|---|---|---|
| API runtime | Vercel serverless functions | `apps/api/api/index.js` is a plain Express handler; `vercel.json` only rewrites | The same handler runs in the docker stack (`docker-compose*.yml`, compose-smoke job) — container path smoke-tested in CI, so a move to any container host is a deploy-config change, not a rewrite |
| Web hosting | Vercel static | Build output is a static directory (`vite build` → `dist/`) plus `vercel.json` headers | nginx image in `docker/web.Dockerfile` already serves the same bundle; CSP/preflight logic is build-time |
| Database | Neon PostgreSQL | Standard PostgreSQL wire protocol; Prisma client generated for the serverless engine target | Any PostgreSQL 16/17 (the migration chain + provision script are provider-agnostic; verified against a local docker instance) |
| Object storage | `db` provider (StorableObject) or s3-compatible | Provider interface `StorageProvider`; s3 adapter speaks the S3 API | Any S3-compatible store (R2/MinIO via `S3_ENDPOINT`); switching is an env change (ADR-0012) |
| Rate-limit store | in-process memory (Redis when `REDIS_URL` set) | `express-rate-limit` store interface | Any Redis-compatible endpoint; documented fail-open semantics |
| Payments | sandbox now; SSLCommerz adapter present | Adapter behind `PaymentProvider`; amounts and claims are provider-neutral | Another BD gateway is a new adapter plus a webhook route (ADR-0016) |
| SMS | `sandbox`/`none`; generic HTTP gateway adapter | One POST contract (`{to, text, senderId?}` + bearer key) | Any gateway speaking that shape, or a thin adapter |
| AI | offline KB engine now; OpenAI-compatible adapter | Adapter behind `AiProvider`; answers carry kb/prompt versions | Any OpenAI-compatible endpoint via `OPENAI_BASE_URL`; offline engine is the fallback and the eval baseline |
| CI/CD | GitHub Actions | Workflows are plain YAML with SHA pins | Any runner able to execute the npm scripts; the gates live in `package.json` scripts, not in workflow-only shell |

Evidence for "container path smoke-tested": the `Docker — Compose smoke (db + api)` CI job boots
the compose stack and asserts `/health` on every push, so the container path cannot rot silently
while Vercel is the production home.
