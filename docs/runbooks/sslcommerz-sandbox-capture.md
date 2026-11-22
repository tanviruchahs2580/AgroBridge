# Runbook — SSLCommerz sandbox IPN capture and the ৳10 live test

Purpose: turn the validator-authoritative webhook (ADR-0023) from docs-derived conformance into
evidence — real captured IPNs replayed as fixtures, then the live ৳10 gate (G2). Owner actions are
marked **[owner]**; the capture protocol is deliberate about secrets (§3 of the root `AGENTS.md`).

## 1. Capture sandbox IPNs (OA-01) — [owner], engineering support

1. Decide where the API is reachable from the gateway: a local stack needs a public HTTPS tunnel
   (`ngrok http 4000` or equivalent); a Vercel preview deployment works as-is. Note the tunnel base
   URL — it becomes `API_PUBLIC_URL` for the run (the sandbox does not require the https
   production guard, but keep it https anyway).
2. Set `PAYMENT_PROVIDER=sslcommerz`, `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` (sandbox
   store), leave `SSLCOMMERZ_SANDBOX` unset or `true`.
3. Perform 2–3 small sandbox checkouts end to end (browser → hosted page → pay with the sandbox
   test card) and let the IPN arrive at `/api/v1/payments/webhook/sslcommerz`.
4. Export the captured POST bodies. Where they come from:
   - a tunnel/proxy log (ngrok's web inspector shows the raw form body), or
   - a temporary local middleware dump run **only on a disposable instance** — never commit a
     body dump that includes live credentials.
5. Redact before anything leaves the machine: `store_passwd` never appears in an IPN (it is not
   posted), but drop any `value_a`–`value_d` carrying customer identifiers, and keep the masked
   card form (`411111XXXXXX1111`) exactly as the sandbox sends it. Never include the store
   password itself in a fixture or a screenshot.

## 2. Land the fixtures

1. Save each capture as `apps/api/tests/fixtures/sslcommerz/ipn-capture-<date>-<n>.txt`
   (form-encoded, one per file).
2. Add a row to `apps/api/tests/fixtures/sslcommerz/README.md`: capture date, store mode, what was
   redacted.
3. Replace the `it.todo` in `tests/payments-webhook-signature-conformance.test.ts` with a real
   test per capture: the file body is posted with its **committed** `verify_sign` — the assertion
   is that the documented algorithm verifies a signature the gateway itself minted. A capture whose
   signature does not verify is a finding, not a test to adjust: re-check the docs page and the
   capture (field ordering, URL-encoding) before touching the algorithm.
4. Commit. CI replays the fixtures on every push from then on.

## 3. The ৳10 live end-to-end test (gate G2) — [owner]

Prerequisites: live store credentials, `SSLCOMMERZ_SANDBOX=false`, https `API_PUBLIC_URL`
(startup refuses without it), and the reconciliation script available.

1. Checkout a ৳10 product in production staging conditions (a real store, a real card, an
   account the owner controls).
2. Verify in order: the buyer's return lands on `/orders?payment=success`; the payment row reaches
   `SUCCEEDED` **only after** the Order Validation verdict (check the audit trail for
   `PAYMENT_WEBHOOK_CONFIRMED` and the absence of `PAYMENT_VALIDATOR_REJECTED`); the order is
   `PAID`; stock decremented once.
3. Refund the ৳10 from the gateway dashboard, record the refund reference, then run the
   reconciliation check and confirm ledger/`WalletTransaction` rows match the gateway statement
   (one charge, one refund, no orphans).
4. Save the timeline (timestamps + row states) as
   `qa-evidence/receipts/<date>-sslcommerz-live-10bd.md`. G2 is closed by that receipt.

## 4. What engineering guarantees before the captures arrive

- The signature algorithm, the validator gate, the retryable non-settlement answers and the
  risk-flag hold are implemented and covered by docs-derived tests
  (`payments-webhook-signature-conformance.test.ts`, `payments-webhook-validator.test.ts`).
- A sandbox capture that fails to verify will show `401 INVALID_SIGNATURE` in the API logs — that
  is the signal to re-open this runbook at step 2.3, not to loosen the check.
