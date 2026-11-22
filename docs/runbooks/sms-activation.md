# Runbook — SMS provider activation (gate G1, OA-02)

The app is SMS-complete on the engineering side: the adapter (`apps/api/src/providers/notification/sms.ts`)
posts `{to, text, senderId?}` with a bearer key, has a bounded timeout (8 s) and one retry on
5xx/429 through the shared resilience policy (`providers/resilience.ts`), masks phone numbers in
every log line, and never logs an OTP code — outside production the code is echoed in the API
response instead (`docs/STATUS.md` "SMS / OTP delivery" row). What is missing is a real gateway,
which only the owner can choose and pay for.

## 1. Choosing the gateway — [owner]

Selection criteria, in order:

1. **Regulatory**: an aggregator operating under the BTRC rules for bulk/OTP SMS with a registered
   sender ID (a masked route on all four operators: Grameenphone, Robi, Banglalink, Teletalk).
2. **Delivery reports**: a webhook or dashboard per-message status (queued/delivered/failed) —
   without one, G1 cannot be evidenced.
3. **OTP-friendly contract**: accepts a plain JSON/REST POST with a sender ID and a text body (the
   adapter's contract; most BD aggregators — e.g. an HTTP POST gateway — match), allows ASCII +
   Bangla text (the OTP message is bilingual, one string).
4. **Rate limits and cost per segment** documented up front; failover/secondary route available.
5. Explicitly **not** required: the adapter supports no vendor SDK — a plain HTTP endpoint is the
   integration surface, so vendor lock-in stays at "one URL + one key".

## 2. Activation — [owner with engineering]

1. Register the sender ID and the OTP template with the aggregator (BD aggregators require template
   approval; the template is `otpSmsText` in `sms.ts` — keep it byte-identical when registering).
2. Run the smoke: `SMS_API_URL=<gateway> SMS_API_KEY=<key> SMOKE_PHONE=<your phone> node scripts/smoke-sms.mjs`
   from `apps/api/`. Expected: `gateway responded 200 … ACCEPTED (watch the phone)`, then the SMS
   arrives. Try one number per operator (GP, Robi, Banglalink, Teletalk) — G1 is per-operator.
3. Set on the deployment (Vercel project env): `SMS_PROVIDER=http`, `SMS_API_URL`, `SMS_API_KEY`,
   `SMS_SENDER_ID`. Remove `ALLOW_PLACEHOLDER_PROVIDERS` from production — the boot guard refuses
   placeholder providers in production, so OTP delivery must be real or the operator opts out
   explicitly (`config/env.ts`).
4. Re-run the smoke against the deployed key, then verify a real registration: dev OTP shortcuts
   must stay off in production (`DEV_AUTH_SHORTCUTS` unset).

## 3. Un-waiving the SEC-04 step-up gates — automatic, verify it happened

While SMS is a placeholder provider, the step-up gates on withdrawals and account deletion run
waived with loud disclosure (PR #110): `stepUpEnforcementEnabled` (`config/env.ts`) auto-enforces
when `SMS_PROVIDER=http`, auto-waives on the accepted placeholders, and honours an explicit
`STEP_UP_ENFORCEMENT=0|1` override. **Activation needs no flag change — enforcement arms itself
the moment `SMS_PROVIDER=http` is set.** After step 2, verify on the deployed instance: the
startup placeholder manifest must no longer list the step-up waiver, and a withdrawal attempt
without a fresh step-up challenge must be refused (the code path is pinned by
`tests/auth-totp-stepup.test.ts`).

## 4. What stays true after activation

- The OTP value never appears in logs (enforced by redaction + the sandbox branch echoing only in
  non-production responses); a grep proof command lives in the WP-04 receipt.
- The monthly AI-style budget guard does not apply here; the auth limiters bound OTP sends per
  phone/IP (`OTP_SEND_*` env knobs, `docs/env-reference.md`).
- Metrics: `sms_send_total{provider,outcome}` counts every send attempt — alert on a sustained
  `outcome="unreachable"` (gateway outage) once an alerting sink exists (WP-10/OA-05).
