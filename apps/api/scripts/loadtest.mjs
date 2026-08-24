#!/usr/bin/env node
/**
 * Performance baseline against a running AgroBridge API.
 * Usage: BASE_URL=http://localhost:4000 node scripts/loadtest.mjs
 * Requires the seeded demo farmer (01700000002 / Demo@1234).
 */
import autocannon from "autocannon";

const BASE = process.env.BASE_URL ?? "http://localhost:4000";

async function login() {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "01700000002", password: "Demo@1234" }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return (await res.json()).data.accessToken;
}

function run(name, opts) {
  return new Promise((resolve) => {
    const instance = autocannon({ url: BASE, duration: 10, ...opts }, (err, result) => {
      const l = result.latency;
      console.log(
        `${name.padEnd(28)} req/s=${String(result.requests.average).padStart(6)} ` +
        `p50=${String(l.p50).padStart(4)}ms p90=${String(l.p90).padStart(4)}ms p99=${String(l.p99).padStart(5)}ms ` +
        `errors=${result.errors} non2xx=${result.non2xx}`
      );
      resolve(result);
    });
    process.stdout.write(`Running ${name} ... \n`);
    instance.on("done", () => {});
  });
}

const token = await login();
const auth = { headers: { Authorization: `Bearer ${token}` } };

console.log(`Load profile vs ${BASE}\n──────────────────────────────────────────────`);
await run("GET /health (baseline)", { url: `${BASE}/health` });
await run("GET /products (auth read)", { ...auth, url: `${BASE}/api/v1/products?pageSize=12` });
await run("POST /auth/login (bcrypt)", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ phone: "01700000002", password: "Demo@1234" }),
  url: `${BASE}/api/v1/auth/login`,
});
await run("GET /weather+risks", { ...auth, url: `${BASE}/api/v1/weather?lat=25.9&lng=89.1` });
await run("POST /ai/advisory (grounded)", {
  ...auth,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ question: "মাটি পরীক্ষা কীভাবে করব?", lang: "bn" }),
  url: `${BASE}/api/v1/ai/advisory`,
});
console.log("\nNote: AI endpoint is quota-limited to 30 req/h/user — non2xx there reflects the intended rate limit.");
