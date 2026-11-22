#!/usr/bin/env node
/**
 * SMS delivery smoke — one real message, one masked outcome (WP-04, gate G1 prep).
 *
 * Proves the configured gateway actually delivers before/after the owner
 * activates it (OA-02): run this against the chosen aggregator BEFORE wiring
 * `SMS_PROVIDER=http` into a deployment, and again after any credential or
 * template change. It never prints the API key and masks the phone number.
 *
 * Usage:
 *   SMS_API_URL=https://gateway.example/send \
 *   SMS_API_KEY=... \
 *   SMS_SENDER_ID=88096... (optional) \
 *   SMOKE_PHONE=01712345678 \
 *     node scripts/smoke-sms.mjs
 *
 * Exit 0 = the gateway accepted the message (delivery report is the
 * aggregator's job); non-zero = the send failed or configuration is missing.
 */
import { postSms } from "./sms-smoke-lib.mjs";

const url = process.env.SMS_API_URL;
const key = process.env.SMS_API_KEY;
const phone = process.env.SMOKE_PHONE;

if (!url || !phone) {
  console.error("SMS_API_URL and SMOKE_PHONE are required (SMS_API_KEY when the gateway needs one).");
  process.exit(1);
}

const text =
  "AgroBridge smoke test: if you can read this, the SMS gateway works. | " +
  "অ্যাগ্রোব্রিজ স্মোক টেস্ট: এই বার্তা পেলে SMS গেটওয়ে কাজ করছে।";

try {
  const { status, latencyMs, bodySample } = await postSms({ url, key, senderId: process.env.SMS_SENDER_ID }, phone, text);
  const masked = `${phone.slice(0, 3)}***${phone.slice(-4)}`;
  const ok = status >= 200 && status < 300;
  console.log(`gateway responded ${status} in ${latencyMs}ms for ${masked} — ${ok ? "ACCEPTED (watch the phone)" : "REJECTED"}`);
  if (!ok) console.log(`body sample: ${bodySample}`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error(`send failed: ${e.message}`);
  process.exit(1);
}
