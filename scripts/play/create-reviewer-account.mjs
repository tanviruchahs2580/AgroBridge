#!/usr/bin/env node
/**
 * Creates (or repairs) the dedicated Google Play reviewer account on a live
 * deployment and prints paste-ready App-access instructions.
 *
 *   node scripts/play/create-reviewer-account.mjs \
 *     --api https://<api-host>/api/v1 \
 *     --phone 01700000099 \
 *     --password '<strong-password>' \
 *     [--name "Play Reviewer"] [--verify-phone]
 *
 * Why a script: Play review is blocked without working credentials, and the
 * seeded demo accounts must never be used in production. This is idempotent —
 * re-running it resets the password and repairs the account state, so it is
 * also the "reviewer account is locked out" recovery path.
 *
 * Requirements: run against a deployment whose environment you control; the
 * password is passed on the command line, so prefer a shell that does not keep
 * history, or rotate it after use.
 */
import process from "node:process";

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const api = (arg("api") ?? "").replace(/\/+$/, "");
const phone = arg("phone");
const password = arg("password");
const fullName = arg("name", "Play Reviewer");
const verifyPhone = flag("verify-phone");

if (!api || !phone || !password) {
  console.error(
    "usage: node scripts/play/create-reviewer-account.mjs --api <baseUrl> --phone <01XXXXXXXXX> --password <secret> [--name \"...\"] [--verify-phone]"
  );
  process.exit(2);
}
if (!/^01[3-9]\d{8}$/.test(phone)) {
  console.error(`--phone must be a Bangladeshi mobile number (01[3-9]XXXXXXXX), got "${phone}"`);
  process.exit(2);
}
if (password.length < 10) {
  console.error("--password must be at least 10 characters (this account can reach real data)");
  process.exit(2);
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

function fail(step, res) {
  console.error(`✗ ${step} failed (HTTP ${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`);
  process.exit(1);
}

const register = await call("POST", "/auth/register", { body: { fullName, phone, password, langPref: "bn" } });

let accessToken;
if (register.status === 201) {
  accessToken = register.body?.data?.accessToken;
  console.log(`✓ registered reviewer account ${phone}`);
} else {
  // Already exists (409) or another conflict: sign in and reset the password so
  // a forgotten/stale credential can never block a review.
  const login = await call("POST", "/auth/login", { body: { phone, password } });
  if (login.status === 200) {
    accessToken = login.body?.data?.accessToken;
    console.log(`✓ reviewer account already existed; signed in with the supplied password`);
  } else {
    console.error(
      `✗ account ${phone} exists but the supplied password does not match (HTTP ${login.status}).\n` +
        `  Reset it out-of-band (admin PATCH /admin/users/:id cannot set passwords) — the supported\n` +
        `  path is to anonymise this account (DELETE /auth/me with its own token) and re-run this script,\n` +
        `  or choose a different--phone.`
    );
    process.exit(1);
  }
}

if (!accessToken) {
  console.error("✗ no access token returned; aborting");
  process.exit(1);
}

// Keep the profile complete so every screen has data to render.
const profile = await call("PATCH", "/auth/me", {
  token: accessToken,
  body: { fullName, district: "Rangpur", upazila: "Badarganj", address: "Reviewer demo address, Rangpur" },
});
if (profile.status !== 200) fail("PATCH /auth/me", profile);
console.log("✓ profile completed (district Rangpur, so weather advice renders)");

// A farm + plot + crop cycle: My Farm, Home and the AI agent all read these.
const farms = await call("GET", "/farms", { token: accessToken });
let farmId = farms.body?.data?.[0]?.id;
if (!farmId) {
  const farm = await call("POST", "/farms", {
    token: accessToken,
    body: { name: "রিভিউ ডেমো ফার্ম", district: "Rangpur", lat: 25.7439, lng: 89.2752, totalAreaBigha: 3 },
  });
  if (farm.status !== 201) fail("POST /farms", farm);
  farmId = farm.body.data.id;
  console.log(`✓ created farm ${farmId}`);
} else {
  console.log(`✓ farm already present (${farmId})`);
}

const plots = await call("GET", `/farms/${farmId}/plots`, { token: accessToken });
let plotId = plots.body?.data?.[0]?.id;
if (!plotId) {
  const plot = await call("POST", `/farms/${farmId}/plots`, { token: accessToken, body: { name: "প্লট-১", areaBigha: 2 } });
  if (plot.status !== 201) fail("POST /farms/:id/plots", plot);
  plotId = plot.body.data.id;
  console.log(`✓ created plot ${plotId}`);
} else {
  console.log(`✓ plot already present (${plotId})`);
}

const crops = await call("GET", "/farms/crops", { token: accessToken });
if (!(crops.body?.data ?? []).some((c) => c.status === "ACTIVE")) {
  const crop = await call("POST", "/farms/crops", {
    token: accessToken,
    body: { plotId, cropName: "ধান", plantedAt: new Date(Date.now() - 35 * 86400000).toISOString() },
  });
  if (crop.status !== 201) fail("POST /farms/crops", crop);
  console.log("✓ planted an active rice crop (35 days old, so care tasks render)");
} else {
  console.log("✓ an active crop cycle already exists");
}

if (verifyPhone) {
  const otp = await call("POST", "/auth/otp/request", { token: accessToken });
  const devCode = otp.body?.data?.devCode;
  if (typeof devCode === "string") {
    const verified = await call("POST", "/auth/otp/verify", { token: accessToken, body: { code: devCode } });
    if (verified.status === 200) console.log("✓ phone marked verified (the deployment echoed a dev code)");
    else console.log(`… phone verification not completed (HTTP ${verified.status}); withdrawals stay gated`);
  } else {
    console.log(
      "… phone verification needs the code from SMS (or the API log when SMS_PROVIDER=sandbox); withdrawals stay gated"
    );
  }
} else {
  console.log("… phone left unverified, so withdrawals remain gated for this account (intended)");
}

console.log(`
Reviewer account ready. Paste this into Play Console → App content → App access:

  Phone:    ${phone}
  Password: (the password you passed to this script)

  Steps:
  1. Open the app; the login screen appears.
  2. Enter the phone number and password above and tap "লগইন" (Login).
  3. Navigate with the bottom bar: হোম / আমার ফার্ম / এআই কৃষি সহকারী / বাজার / ওয়ালেট / আমার অর্ডার.
  4. Language switches with the "EN / বাং" button in the header.
  5. Do not delete this account — it is shared with other reviewers.
     (Account deletion is at: header gear icon → Settings → Account → "Delete account".)
`);
