# SLOs / SLIs — proposal pending owner sign-off (OPS-01)

Ownership: the numbers below are engineering's proposal; sign-off (and the alerts'
error budgets derived from them) is the owner's. Until signed, the enforcement
column is what actually holds.

| # | Service level | SLI (measured where) | Objective | Budget | Enforcement |
|---|---|---|---|---|---|
| 1 | API availability | non-5xx share of `/api/v1/*` (`agrobridge_http_requests_total`) | ≥ 99.0 % rolling 30 d | 1 % | alert on 50 % burn |
| 2 | Authenticated read latency | p95 (`agrobridge_http_request_duration_seconds`) | ≤ 500 ms | 5 % | alert on burn; overload guard keeps admitted p50 sub-second (measured 816 ms p50 under an unbounded 1 000-user burst) |
| 3 | Login availability | successful logins / attempts | ≥ 98 % rolling 30 d | 2 % | bcrypt pool + cost policy keep this (measured: 4.2 logins/s per instance at cost 12 — `docs/performance.md`) |
| 4 | Checkout idempotency | orders created vs clientRequestIds | 1:1 always (hard invariant) | none | `checkout-idempotency` suites |
| 5 | Money integrity | wallet ledger == wallet balance | 0 discrepancies | none | `scripts/reconcile-wallet.mjs` |
| 6 | Notification delivery | delivery share honouring prefs (AUD-141) | 100 % of non-disabled critical | n/a | `hardening-round11` specs |

Signed-off SLOs become alert burn rates in `.github/workflows`' alert-rules job
(`docs/operations.md`); until then the alert thresholds in monitoring are
drafts and are not announced externally.
