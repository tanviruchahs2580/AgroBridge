# STATUS — as of 2026-10-21 (`fix/audit-10k-hardening` @ `913839d`)

Automated gates and their latest locally-executed result. CI runs the same set on
every push (`.github/workflows/ci.yml`); this page is the human-readable mirror.

| Gate | Latest result (2026-10-21) | Where |
|---|---|---|
| typecheck (api + web) | pass | `npm run typecheck` |
| API suite — SQLite | 372 passed + 1 skipped (PG-gated by design) | `npm run test --workspace apps/api` |
| API suite — PostgreSQL 17 | 373 passed / 373 | PG profile (docs/testing.md) |
| web unit | 166/166 (17 files) | `npm run test --workspace apps/web` |
| web lint / i18n | 0 errors / 0 missing keys | `npm run lint`, `npm run i18n:check` |
| production build + byte budgets | pass (entry 142.5 kB gz / 150 budget) | `npm run build`, `npm run preflight` |
| knip / jscpd / licences / commitlint / migration drift | pass (this run added the gates) | `npm run lint:knip`, `lint:dup`, `lint:licences`, `lint:commits`, `drift:check` |
| 10k-session load simulation | p50 3.1 s, 0 429/5xx, 49 585 honest `503`s | `docs/performance.md` |

Known-open (owner/human): PR #40 merge decision, REDIS_URL + METRICS_TOKEN + S3
credentials, production PITR verification, expert agronomist KB sign-off, legal
review of consent/policies, P4 UAT, device and screen-reader passes, external log
sink. Full register: `docs/qa/current-condition-reaudit-2026-10-21.md`.
