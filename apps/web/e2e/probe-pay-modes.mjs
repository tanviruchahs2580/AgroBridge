// PAY-01 acceptance drill: the payment-mode matrix.
//
// Using the audit's own test configuration (never a real environment):
//  - unset mode            → boots with the LABELLED sandbox default
//  - unknown/mistyped mode → refuses to start
//  - production + sslcommerz without credentials → refuses to start
//  - production + sslcommerz credentials but SSLCOMMERZ_SANDBOX not "false"
//    → refuses to start (the sandbox-endpoint-vs-live-label trap)
//  - LIVE cannot be reached by default: the only value selecting live hosts is
//    the literal "false", and production refuses anything else (proved above).
//  - sandbox intent envelopes carry the label in both languages.
//
// Run: node apps/web/e2e/probe-pay-modes.mjs
import { freshDb, provision, startApi, waitHealthy, expectBootRefusal, json, loginOn } from "./probe-helpers.mjs";

const PORT = 4300;
const dbUrl = freshDb("drill-pay-modes");
provision(dbUrl);
const checks = {};

// (a) Unset mode: sandbox default, labelled everywhere the surface shows it.
{
  const api = startApi(PORT, dbUrl);
  await waitHealthy(PORT);
  const ready = (await json("GET", PORT, "/ready")).data;
  checks.unsetMode = { boots: true, payments: ready.payments };
  const session = await loginOn(PORT);
  const intent = await json("POST", PORT, "/api/v1/payments/intent", {
    token: session.accessToken,
    body: { purposeType: "MEMBERSHIP", purposeId: "SILVER" },
  });
  checks.unsetMode.intent = {
    status: intent.status,
    mode: intent.data?.data?.providerMode,
    labelledBn: String(intent.data?.data?.messageBn ?? "").includes("স্যান্ডবক্স"),
    labelledEn: String(intent.data?.data?.messageEn ?? "").toLowerCase().includes("sandbox"),
  };
  await api.stop();
}

// (b) Unknown mode: zod enum refuses at boot.
checks.unknownModeRefused = await expectBootRefusal(PORT, dbUrl, { PAYMENT_PROVIDER: "live" });
checks.mistypedModeRefused = await expectBootRefusal(PORT, dbUrl, { PAYMENT_PROVIDER: "sslcomerz" });

// (c) Production + sslcommerz without credentials.
checks.prodSslcommerzNoCredsRefused = await expectBootRefusal(PORT, dbUrl, {
  NODE_ENV: "production",
  PAYMENT_PROVIDER: "sslcommerz",
  ALLOW_PLACEHOLDER_PROVIDERS: "1",
});

// (d) Production + credentials but no explicit SSLCOMMERZ_SANDBOX=false.
checks.prodSslcommerzUnsetSandboxFlagRefused = await expectBootRefusal(PORT, dbUrl, {
  NODE_ENV: "production",
  PAYMENT_PROVIDER: "sslcommerz",
  ALLOW_PLACEHOLDER_PROVIDERS: "1",
  SSLCOMMERZ_STORE_ID: "drill-store",
  SSLCOMMERZ_STORE_PASSWORD: "drill-pass",
});

// (e) Production + credentials + explicit "false" is the only way toward live —
// but the audit never flips a real environment, so this is where the drill stops.
// The provider-mode gate itself is unit-tested (payments-refund-provider-mode,
// payment-provider-truthfulness).

const pass =
  checks.unsetMode.boots &&
  checks.unsetMode.payments?.provider === "sandbox" &&
  checks.unsetMode.payments?.sandbox === true &&
  checks.unsetMode.intent?.status === 201 &&
  checks.unsetMode.intent?.mode === "sandbox" &&
  checks.unsetMode.intent?.labelledBn &&
  checks.unsetMode.intent?.labelledEn &&
  checks.unknownModeRefused &&
  checks.mistypedModeRefused &&
  checks.prodSslcommerzNoCredsRefused &&
  checks.prodSslcommerzUnsetSandboxFlagRefused;

console.log(JSON.stringify({ scenario: "PAY-01", pass, checks }, null, 2));
process.exit(pass ? 0 : 1);
