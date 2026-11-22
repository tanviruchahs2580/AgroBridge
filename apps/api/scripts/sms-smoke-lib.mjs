/**
 * The one HTTP call smoke-sms.mjs makes, factored out so the script itself
 * stays readable. Mirrors the adapter contract in
 * src/providers/notification/sms.ts: POST JSON {to, text, senderId?} with
 * `Authorization: Bearer <key>` when a key is configured.
 */
export async function postSms({ url, key, senderId }, phone, text) {
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ to: phone, text, ...(senderId ? { senderId } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.text().catch(() => "");
  return { status: res.status, latencyMs: Date.now() - started, bodySample: body.slice(0, 200) };
}
