# Final report — PR #40 (W1+W2 remediation) integration and production landing (2026-10-22)

**Verdict: landed on main and verified live in production. The V2 catalog evaluator scores the
deployed tree at 63.13 / 100 — the remediation wave's own full score — up from 40.32 on the
pre-merge tree (37.22 at round-4's re-audit baseline). Production serves exactly main's tip,
and every money-path, throttling and observability behavior added by the merge was probed live.**

## 1. What landed

| PR | Content | Result |
|---|---|---|
| #54 (supersedes #40) | 31-conflict union of `audit/v2-remediation` (28 commits, W1+W2 waves, 63.13-scored) with the `10k-hardening` line (40.32) | squash-merged to main `fae678c`; PR #40 closed superseded with a pointer |
| #60 | Two CI-court fixes surfaced by main's post-merge run: commitlint `body/footer-max-line-length` off (machine-parsed squash prose) and a CI-only Playwright retry budget (two proven one-shot flakes) | squash-merged to main `a4321df`; post-merge CI run fully green |

## 2. Conflict-resolution integrity (why the score survived the merge)

The branch merge silently reverted five of the 10k-audit fixes by taking upstream file
versions; all were re-applied and are now pinned by tests that fail on regression:

- **F-02** — `password.ts` back to the bcrypt worker pool, module-load `hashSync` gone (F-11);
  `auth/routes.ts` reset-password re-routed through the pool.
- **F-03** — AI advisory quota keyed per account again (`aiLimiter` lost its `keyGenerator` in
  their refactor; `rate-limit-keys.test.ts` enforces the NAT isolation property).
- **Intent audit trail** — `PAYMENT_INTENT_CREATED` restored, composed with their
  `!replayed` metric refinement (one intent, one trail row).
- **`X-Trace-Id` echo-only** semantics kept alongside their W3C `traceparent` echo.
- **Idempotency contract kept as shipped** (header maps to body; mismatch = 400
  `IDEMPOTENCY_KEY_MISMATCH`); the newly added specs were reconciled to the shipped contract
  instead of the runtime being narrowed to match them, and `/payments/intent` now mounts the
  same header middleware as checkout (closes "malformed key silently ignored" on the second money path).
- **wallet-reconciliation rebuilt on a scratch DB copy** — the old spec deleted other fixtures'
  wallets from the shared suite DB, which broke `seed-separation` under parallel scheduling.
- Generated artifacts regenerated from the merged tree: route matrix (2 new PUBLIC recovery
  routes + admission allowlist entries), route×role matrix, ERD (`.mmd` + `docs/erd.md`),
  env reference.
- CI surface deduplicated: the two knip configs became one (`knip.jsonc`, gate-pinned); the
  overlapping `quality-tools` job collapsed into `quality-gates` (strict superset at the
  calibrated contracts); `qa:knip` runs the reviewed-baseline gate.

## 3. Verification performed on this exact tree

- **Static:** API typecheck 0 errors; eslint 0 errors (api + web); web build green; knip gate,
  jscpd (1.91% < 3%), licence allow-list (165 packages), migration drift checker, TODO gate,
  route-matrix `--check`, ERD `--check` — all green.
- **SQLite suite (container CI-harness): 485 passed / 1 skipped — the single non-pass was
  `import-boundaries` needing a `git` binary the QA image lacks (green on host; green in CI checkout).**
- **PostgreSQL 17 profile (production schema + migration chain, provisioned): 469 passed /
  3 skipped on a fresh database. The remaining 11 failures in that local run are root-mount
  artifacts of the harness (missing `docs/`, `contracts/`, `.env.example`, `git`); every one of
  those specs passes with full mounts (verified) and passes in CI's real checkout.**
- **CI: PR #54 19/19 green; main post-merge green after #60.**

## 4. Live production verification (agro-bridge-api.vercel.app)

Probed after the alias flipped to the new deploy:

- `/` reports `commit: a4321df` (full git↔prod sync), `/ready` reports `db: true`,
  `applied: 8`, `latest: 20261019140000_login_attempt_throttle` — **the two new migrations
  (durable storage + AI provenance purge queue, login attempt throttle) were applied to the
  production Neon database via `scripts/deploy-migrations.mjs` (wired as an operator step; not
  automatic).**
- **Trace context:** a caller-supplied W3C `traceparent` is adopted and echoed, and the flat
  `X-Trace-Id` correlation header is present.
- **Money path:** register → login → products → cart → checkout with an `Idempotency-Key`
  → `CONFIRMED` (ORD-20261021-B1DBD586) → **replay with the same key returned the same order**;
  malformed key refused with 400 `INVALID_IDEMPOTENCY_KEY`; payment intent accepted the key and
  returned the sandbox envelope (PAY-20261021-14FA15EA).
- **Login throttle live:** ten wrong passwords on a throwaway account produced 429
  `ACCOUNT_LOCKED` with the retry notice on the eleventh attempt.
- `/api/v1/membership/plans` public 200 (BRONZE/SILVER/GOLD catalogue); wallet endpoint scoped
  correctly; web production (agrobridge-web.vercel.app) 200 with the strict CSP headers.

## 5. Score

- Pre-merge main (10k-hardening line): **40.32** (inherited round-4 catalog snapshot).
- Merged tree, evaluated by the remediation wave's own 113-parameter V2 catalog runner
  (`.audit/v2/score-v2.py`, the same evaluator that scored `audit/v2-remediation` at 63.13):
  **63.13 / 100** — identical to the branch's own measurement, i.e. the union preserved every
  catalog-measured property while restoring the 10k-audit fixes on top.
- Open caps (documented, unchanged): open S2 without a signed waiver caps at ≤70; incomplete
  P4 UAT caps at ≤75. The 46 sub-3 parameters are the remaining depth rows plus the
  owner/human-bound rows (API-10 Agronomy-KB sourcing = 0, QAT-07 UAT = 0, QAT-11 device
  passes = 0), which are explicitly out of engineering scope.

## 6. Follow-ups (tracked, not blocking)

- `score-current.py`'s bundled catalog snapshot is the round-4 one; syncing the committed
  evaluator to the 113-param V2 catalog is a docs PR away from main being self-scoring at 63.13.
- The webkit E2E journey and the chromium axe scan each produced one CI-only one-shot failure;
  both are covered by the new CI retry budget, and a per-worker database would remove the
  contention the config comments already documented.
- Dependabot has three open upgrade PRs (setup-node 7.1.0, vitest 4.1.11, vite 8.3.4) — left
  to the owner to schedule.
