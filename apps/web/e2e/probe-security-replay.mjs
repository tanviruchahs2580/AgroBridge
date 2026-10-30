// SEC-01 acceptance drill: replay the negative security suite against a
// dedicated instance (own db, own port, sandbox payment) through the API, and
// reference the suite's UI-level negatives (admin-guard, scenario specs) for
// the interface half of the same checks.
//
// Run: node apps/web/e2e/probe-security-replay.mjs
import { createHash } from "node:crypto";
import { freshDb, provision, startApi, waitHealthy, json } from "./probe-helpers.mjs";

const PORT = 4400;
const STORE_PASS = "drill-store-password";
const dbUrl = freshDb("drill-security");
provision(dbUrl);
const api = startApi(PORT, dbUrl, { SSLCOMMERZ_STORE_ID: "drill-store", SSLCOMMERZ_STORE_PASSWORD: STORE_PASS });
await waitHealthy(PORT);

const out = {};
const register = async (label, extras = {}) => {
  const phone = `019${String(Date.now() % 10_000_000).padStart(7, "0")}${Math.floor(Math.random() * 10)}`;
  const r = await json("POST", PORT, "/api/v1/auth/register", {
    body: { fullName: label, phone, password: "Demo@1234", langPref: "bn", consent: true, ...extras },
  });
  return { phone, status: r.status, ...(r.data?.data ?? {}) };
};

const A = await register("সেক A");
const B = await register("সেক B");
if (A.status !== 201 || B.status !== 201) throw new Error(`register failed: A=${A.status} B=${B.status}`);
const admin = await json("POST", PORT, "/api/v1/auth/login", { body: { phone: "01700000001", password: "Demo@1234" } });
const adminToken = admin.data.data.accessToken;

// 1) Mass assignment: injected role/status either get stripped or rejected —
//    never honoured. (A rejected body is at least as safe as a stripped one.)
{
  const attempt = await register("সেক ম্যাস", { role: "ADMIN", status: "SUSPENDED" });
  if (attempt.status === 201) {
    out.massAssignment = { outcome: "created", role: attempt.user.role, safe: attempt.user.role === "FARMER" };
  } else {
    out.massAssignment = { outcome: "rejected", status: attempt.status, safe: attempt.status === 400 };
  }
}

// 2) Guessed IDs across tenants.
const farm = await json("POST", PORT, "/api/v1/farms", { token: A.accessToken, body: { name: "সেক খামার", district: "রংপুর" } });
const farmId = farm.data.data.id;
out.guessedFarmRead = (await json("GET", PORT, `/api/v1/farms/${farmId}`, { token: B.accessToken })).status;
out.guessedFarmPatch = (await json("PATCH", PORT, `/api/v1/farms/${farmId}`, { token: B.accessToken, body: { name: "hijack" } })).status;

// A sells one product to itself for a payable order (dealer product, own stock).
const dealer = await json("POST", PORT, "/api/v1/auth/login", { body: { phone: "01700000003", password: "Demo@1234" } });
const product = await json("POST", PORT, "/api/v1/products", {
  token: dealer.data.data.accessToken,
  body: { name: "সেক পণ্য", category: "SEED", unit: "PCS", pricePaisa: 110_00, stockQty: 5, sku: `SEC-${Date.now()}` },
});
const productId = product.data.data.id;
await json("POST", PORT, "/api/v1/cart/items", { token: A.accessToken, body: { productId, qty: 1 } });
const order = await json("POST", PORT, "/api/v1/orders/checkout", { token: A.accessToken, body: { clientRequestId: `sec-${Date.now()}` } });
const orderId = order.data.data.id;
const orderNo = order.data.data.orderNo;
out.guessedOrderRead = (await json("GET", PORT, `/api/v1/orders/${orderId}`, { token: B.accessToken })).status;
const bOrders = await json("GET", PORT, "/api/v1/orders", { token: B.accessToken });
out.crossTenantListing = (bOrders.data.data ?? []).length;

// 3) Disease upload + cross-tenant reads, then a notification for A.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const fd = new FormData();
fd.append("image", new Blob([png], { type: "image/png" }), "leaf.png");
const upload = await fetch(`http://127.0.0.1:${PORT}/api/v1/disease/cases`, { method: "POST", headers: { Authorization: `Bearer ${A.accessToken}` }, body: fd });
const caseId = (await upload.json()).data.id;
out.guessedCaseRead = (await json("GET", PORT, `/api/v1/disease/cases/${caseId}`, { token: B.accessToken })).status;
const imageProbe = await fetch(`http://127.0.0.1:${PORT}/api/v1/disease/cases/${caseId}/image`, { headers: { Authorization: `Bearer ${B.accessToken}` } });
out.guessedImageRead = imageProbe.status;
await json("POST", PORT, `/api/v1/disease/cases/${caseId}/review`, {
  token: adminToken,
  body: { diagnosis: "সেক যাচাই", severity: "LOW", recommendation: "সেক ড্রিল" },
});
const aFeed = await json("GET", PORT, "/api/v1/notifications", { token: A.accessToken });
const notifId = (aFeed.data.data.items ?? [])[0]?.id;
out.guessedNotificationRead = notifId
  ? (await json("POST", PORT, `/api/v1/notifications/${notifId}/read`, { token: B.accessToken, body: {} })).status
  : "no-notification";

// 4) Webhook: forged signature 401; valid signature confirms exactly once;
//    amount mismatch refuses; duplicate settles as already-final.
const intent = await json("POST", PORT, "/api/v1/payments/intent", { token: A.accessToken, body: { purposeType: "ORDER", purposeId: orderId } });
const payment = intent.data.data;
const refNo = payment.refNo;
const amountBdt = (payment.amountPaisa / 100).toFixed(2);
const sign = (params) => {
  const concat = Object.keys(params)
    .filter((k) => k !== "verify_sign" && k !== "verify_key")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("");
  return createHash("md5").update(STORE_PASS + concat).digest("hex").toUpperCase();
};
const forged = await json("POST", PORT, "/api/v1/payments/webhook/sslcommerz", {
  body: { status: "VALID", tran_id: refNo, amount: amountBdt, currency: "BDT", verify_sign: "0".repeat(32) },
});
out.forgedWebhook = forged.status;
const params = { status: "VALID", tran_id: refNo, amount: amountBdt, currency: "BDT", val_id: "drill-val" };
const valid = await json("POST", PORT, "/api/v1/payments/webhook/sslcommerz", { body: { ...params, verify_sign: sign(params) } });
out.validWebhook = { status: valid.status, processed: valid.data?.data?.processed };
const duplicate = await json("POST", PORT, "/api/v1/payments/webhook/sslcommerz", { body: { ...params, verify_sign: sign(params) } });
out.duplicateWebhook = { status: duplicate.status, processed: duplicate.data?.data?.processed };
const afterFirst = await json("GET", PORT, "/api/v1/orders", { token: A.accessToken });
out.orderAfterWebhook = (afterFirst.data.data ?? []).find((o) => o.orderNo === orderNo)?.paymentStatus;

// Amount mismatch on a SECOND payment stays PENDING.
await json("POST", PORT, "/api/v1/cart/items", { token: A.accessToken, body: { productId, qty: 1 } });
const order2 = await json("POST", PORT, "/api/v1/orders/checkout", { token: A.accessToken, body: { clientRequestId: `sec2-${Date.now()}` } });
const intent2 = await json("POST", PORT, "/api/v1/payments/intent", { token: A.accessToken, body: { purposeType: "ORDER", purposeId: order2.data.data.id } });
const badAmount = { status: "VALID", tran_id: intent2.data.data.refNo, amount: "1.00", currency: "BDT" };
out.mismatchWebhook = (await json("POST", PORT, "/api/v1/payments/webhook/sslcommerz", { body: { ...badAmount, verify_sign: sign(badAmount) } })).status;

// 5) Oversized upload refused.
const big = Buffer.alloc(9 * 1024 * 1024, 0xff);
const bigFd = new FormData();
bigFd.append("image", new Blob([big], { type: "image/jpeg" }), "big.jpg");
const bigUp = await fetch(`http://127.0.0.1:${PORT}/api/v1/disease/cases`, { method: "POST", headers: { Authorization: `Bearer ${A.accessToken}` }, body: bigFd });
out.oversizedUpload = bigUp.status;

// 6) Account throttle engages on repeated bad passwords.
let lastStatus = 0;
for (let i = 0; i < 12; i++) { // account throttle locks at 10 failures
  const r = await json("POST", PORT, "/api/v1/auth/login", { body: { phone: A.phone, password: "Wrong@12345" } });
  lastStatus = r.status;
  if (r.status === 429) {
    out.throttle = { engagedAt: i + 1, code: r.data?.error?.code };
    break;
  }
}
if (lastStatus !== 429) out.throttle = { engagedAt: null, code: "never" };

await api.stop();

const pass =
  out.massAssignment.safe &&
  out.guessedFarmRead === 404 &&
  out.guessedFarmPatch === 404 &&
  out.guessedOrderRead === 404 &&
  out.crossTenantListing === 0 &&
  out.guessedCaseRead === 404 &&
  out.guessedImageRead === 404 &&
  out.guessedNotificationRead === 404 &&
  out.forgedWebhook === 401 &&
  out.validWebhook.status === 200 &&
  out.validWebhook.processed === true &&
  out.duplicateWebhook.processed === false &&
  out.orderAfterWebhook === "PAID" &&
  out.mismatchWebhook === 400 &&
  out.oversizedUpload === 400 &&
  out.throttle.engagedAt !== null;

console.log(JSON.stringify({ scenario: "SEC-01", pass, out }, null, 2));
process.exit(pass ? 0 : 1);
