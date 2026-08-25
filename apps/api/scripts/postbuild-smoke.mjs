#!/usr/bin/env node
/**
 * AgroBridge Post-Build Smoke — full business workflow simulation over live HTTP.
 *
 * Usage:
 *   1. Prepare DB:   cd apps/api && npx prisma migrate deploy && npx prisma db seed
 *      (server must point at a freshly migrated DB — e.g. DATABASE_URL="file:./test.db";
 *       a stale dev.db missing migrations will 500 on writes)
 *   2. Start API:    NODE_ENV=test node dist/server.js
 *   3. Run smoke:    BASE_URL=http://localhost:4000 node scripts/postbuild-smoke.mjs
 *
 * Covers: health/ready/metrics · registration/login · farm→plot→crop→weather→AI ·
 * marketplace checkout with atomic stock · payment confirm IDEMPOTENCY (duplicate = 422) ·
 * procurement QC→PO→COLLECT→payout with wallet-delta assertion · RBAC/IDOR negatives.
 * Exit code non-zero on any failure. No external deps (Node 18+ global fetch).
 */

const BASE = (process.env.BASE_URL ?? "http://localhost:4000").replace(/\/+$/, "");
let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; failures.push(name); console.error(`✗ FAIL ${name} ${detail}`); }
}

async function req(method, path, { token, body, raw } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const data = raw ? await res.arrayBuffer() : await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const phone = () => `017${String(Date.now()).slice(-8)}`.slice(0, 11);

console.log(`Post-build smoke vs ${BASE}\n─── Observability ─────────────────────────`);
{
  const h = await req("GET", "/health");
  check("GET /health = 200 ok", h.status === 200 && h.data?.ok === true);
  const r = await req("GET", "/ready");
  // /ready intentionally returns a bare payload (not the ok/data envelope): { ok, ready, db }
  const rdb = r.data?.db ?? r.data?.data?.db;
  check("GET /ready = 200 db:true", r.status === 200 && rdb === true);
  const m = await fetch(`${BASE}/metrics`);
  const text = await m.text();
  check("GET /metrics prometheus counters", m.status === 200 && text.includes("agrobridge_http_requests_total") && text.includes("agrobridge_db_up"));
}

console.log("─── Auth ──────────────────────────────────");
const reg = await req("POST", "/api/v1/auth/register", {
  body: { fullName: "Smoke Farmer", phone: phone(), password: "Smoke@1234", langPref: "bn" },
});
check("POST /auth/register farmer = 201", reg.status === 201 && !!reg.data?.data?.accessToken);
const F = reg.data.data.accessToken;

const badLogin = await req("POST", "/api/v1/auth/login", { body: { phone: "01700000002", password: "wrong-pass" } });
check("login wrong password = 401 (no enumeration)", badLogin.status === 401);

const forged = await req("GET", "/api/v1/auth/me", { token: "forged.jwt.token" });
check("forged JWT = 401", forged.status === 401);

const demo = await req("POST", "/api/v1/auth/login", { body: { phone: "01700000001", password: "Demo@1234" } });
check("demo ADMIN login = 200", demo.status === 200);
const A = demo.data.data.accessToken;

const mgr = await req("POST", "/api/v1/auth/login", { body: { phone: "01700000004", password: "Demo@1234" } });
check("PROCUREMENT_MANAGER login = 200", mgr.status === 200);
const M = mgr.data.data.accessToken;

console.log("─── Farm journey ──────────────────────────");
const farm = await req("POST", "/api/v1/farms", { token: F, body: { name: "Smoke Farm", district: "রংপুর", lat: 25.9, lng: 89.1, totalAreaBigha: 4 } });
check("create farm = 201", farm.status === 201);
const plot = await req("POST", `/api/v1/farms/${farm.data.data.id}/plots`, { token: F, body: { name: "P1", areaBigha: 2 } });
check("create plot = 201", plot.status === 201);
const crop = await req("POST", "/api/v1/farms/crops", { token: F, body: { plotId: plot.data.data.id, cropName: "ধান", plantedAt: new Date(Date.now() - 30 * 864e5).toISOString() } });
check("create crop cycle = 201 (auto stage)", crop.status === 201 && typeof crop.data.data.stage === "string");
const wx = await req("GET", "/api/v1/weather?lat=25.9&lng=89.1", { token: F });
check("weather risks array", wx.status === 200 && Array.isArray(wx.data.data?.risks));
const ai = await req("POST", "/api/v1/ai/advisory", { token: F, body: { question: "ধানের পাতায় blast দাগ দেখছে", lang: "bn" } });
check("AI grounded answer (rice-blast ref)", ai.status === 200 && ai.data.data?.groundedRefs?.includes("rice-blast"));

console.log("─── Marketplace + payment idempotency ────");
const prod = await req("POST", "/api/v1/products", { token: A, body: { sku: `SMOKE-${Date.now()}`, name: "Smoke Item", category: "EQUIPMENT", pricePaisa: 100_000, stockQty: 10 } });
check("admin create product = 201", prod.status === 201);
await req("POST", "/api/v1/cart/items", { token: F, body: { productId: prod.data.data.id, qty: 2 } });
const co = await req("POST", "/api/v1/orders/checkout", { token: F });
check("checkout = 201 (stock 10→8)", co.status === 201);
const afterBuy = await req("GET", `/api/v1/products?search=${encodeURIComponent(prod.data.data.name)}`, { token: F });
check("stock decremented to 8", afterBuy.data.data?.items?.[0]?.stockQty === 8);

const intent = await req("POST", "/api/v1/payments/intent", { token: F, body: { purposeType: "ORDER", purposeId: co.data.data.id } });
check("payment intent = 201 sandbox-labelled", intent.status === 201 && intent.data.data?.providerMode === "sandbox");
const c1 = await req("POST", `/api/v1/payments/${intent.data.data.paymentId}/confirm`, { token: F });
check("payment confirm #1 = 200", c1.status === 200);
const c2 = await req("POST", `/api/v1/payments/${intent.data.data.paymentId}/confirm`, { token: F });
check("payment confirm DUPLICATE = 422 (idempotent)", c2.status === 422);
const orderAfter = await req("GET", `/api/v1/orders/${co.data.data.id}`, { token: F });
check("order PAID exactly once", orderAfter.data.data?.paymentStatus === "PAID");

console.log("─── Procurement → payout ledger ───────────");
const offer = await req("POST", "/api/v1/procurement/offers", { token: F, body: { farmId: farm.data.data.id, cropName: "RICE", quantityKg: 100, qualityGrade: "A" } });
check("offer = 201 with auditable calc", offer.status === 201 && offer.data.data?.calculation?.netPayablePaisa > 0);
const poId = offer.data.data.id;
for (const action of ["QC_PASS", "ISSUE_PO", "COLLECT"]) {
  const rv = await req("POST", `/api/v1/procurement/${poId}/review`, { token: M, body: { action } });
  check(`review ${action} = 200`, rv.status === 200);
}
const wBefore = await req("GET", "/api/v1/wallet", { token: F });
const pay = await req("POST", "/api/v1/payments/payouts", { token: M, body: { poId } });
check("payout = 201", pay.status === 201);
const payDup = await req("POST", "/api/v1/payments/payouts", { token: M, body: { poId } });
check("payout DUPLICATE rejected", payDup.status !== 201);
const wAfter = await req("GET", "/api/v1/wallet", { token: F });
const delta = wAfter.data.data.balancePaisa - wBefore.data.data.balancePaisa;
check("wallet credited exactly netPayable once", delta === offer.data.data.netPayablePaisa, `(delta=${delta})`);

console.log("─── RBAC / IDOR negatives ─────────────────");
const farmerAdmin = await req("GET", "/api/v1/admin/metrics", { token: F });
check("farmer → admin metrics = 403", farmerAdmin.status === 403);
const otherOrder = await req("GET", `/api/v1/orders/${co.data.data.id}`, { token: (await req("POST", "/api/v1/auth/register", { body: { fullName: "Other", phone: phone(), password: "Smoke@1234" } })).data.data.accessToken });
check("IDOR other user's order = 404 (no oracle)", otherOrder.status === 404);

console.log("────────────────────────────────────────────");
console.log(`SMOKE RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.error("Failures:", failures.join(", ")); process.exit(1); }
