# WP-03 — SSLCommerz IPN conformance + validator-authoritative settlement, 2026-11-23

Machine: Windows 11, Git Bash, Node v24.19.0 (project pins 22 — unavailable here; CI is the
transferable run). Branch `fix/sslcommerz-conformance` off `main` @ `534bad7`.

## What the finding was

PAY-01/TST-01: the webhook hashed every posted parameter with an in-house recipe and every test
signed with that same function — self-consistency, not gateway compatibility. Settlement had no
server-to-server validation despite the gateway docs making it mandatory.

## Official source (E7)

- <https://developer.sslcommerz.com/docs.html> — IPN ("IPN Verify Sign") + Order Validation API
  sections. Retrieved 2026-11-22. Algorithm: MD5 over the `verify_key`-named fields plus
  `store_passwd=<md5(store_passwd)>`, key-sorted, `key=value&…`; validation statuses
  `VALID`/`VALIDATED`/`INVALID_TRANSACTION`; `risk_level` 0/1. Recorded in ADR-0023.

## Test-first evidence (red before green)

- New suites `tests/payments-webhook-signature-conformance.test.ts` (10 live cases + 1 todo) and
  `tests/payments-webhook-validator.test.ts` (10 cases) run against the pre-change code:
  **12 failed / 8 passed / 1 todo** (`npx vitest run tests/payments-webhook-signature-conformance.test.ts tests/payments-webhook-validator.test.ts`, 00:08:23).
- After the change: **20 passed / 1 todo** (00:12:29). Adjacent payment suites initially 14 failed —
  four pre-existing helpers signed a param set different from the one posted (possible only under
  the old recipe); corrected to sign exactly what they post, then **32 passed** (00:17:41).

## Independent verification anchors

- Conformance tests sign with a **test-local mirror of the documented PHP recipe**, never the
  production function, plus one frozen vector computed by hand outside the repo
  (store password digest `8399e0e3…`, verify_sign `20c66a4a…`, 2026-11-22).
- Retired-recipe regression: a legacy all-params signature must yield `401 INVALID_SIGNATURE`.
- Docs-shaped fixture `tests/fixtures/sslcommerz/ipn-sample-docs-shape.txt` with provenance README.
- Real captured sandbox IPN = explicit `it.todo` (OA-01; runbook
  `docs/runbooks/sslcommerz-sandbox-capture.md`).

## Settlement semantics verified (real HTTP via supertest, sandbox adapter vs sslcommerz adapter)

- VALID → settles; VALIDATED (replayed validation) → settles; replay of the same IPN →
  `already_final`, idempotent.
- `INVALID_TRANSACTION` → `processed:false, reason:"validator_invalid"`, payment stays PENDING.
- Validator 503 → `reason:"validator_unavailable"` (HTTP 200 so the gateway retries the IPN).
- Verdict tran_id/amount mismatch → `validator_tran_mismatch` / `validator_amount_mismatch`.
- `risk_level 1` → `gateway_risk_flag`, stays PENDING for operator reconciliation.
- Missing `val_id` in the IPN → `missing_val_id`, no validator call.
- Sandbox adapter (no `validateOrder`) → unchanged settlement, no validator call.

## Gates run on this branch

- `npm run typecheck` — exit 0 (after fixing a TS2345 narrowing error, an
  `no-base-to-string` error and a duplicated-body slip caught in review).
- API eslint — 0 errors, 137 warnings (budget 143; the touched provider file's warnings went 2 → 2:
  `verifyPayment` complexity 28 → 21). knip not run locally (machine limit, CI runs it).
- Full API suite — see PR description for the final counts (run in progress at receipt-writing
  time; the PR will not be marked ready until it and every CI job are green).
- Web gates not re-run here: no web-facing change (no route added/removed, response shapes for
  existing consumers unchanged, `api-types.ts` untouched); CI covers them.
