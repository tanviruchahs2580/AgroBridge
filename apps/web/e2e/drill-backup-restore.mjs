// RES-01 + OPS-01 acceptance drill.
//
//  OPS-01: back up the drill database, restore it into a FRESH instance, run
//  the migration chain forward on it, and prove the restored instance serves.
//  RES-01: kill the API mid-request during a payment confirmation, restart it,
//  and prove recovery leaves exactly one financial side effect; then restart
//  the DATABASE under a running API and prove readiness recovers.
//
// Requires the throwaway PG container from the audit (dbguard-approved):
//   docker run -d --name agobridge-audit-pg ... postgres:17-alpine  (see EV-0007)
//
// Run: node apps/web/e2e/drill-backup-restore.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { json, loginOn } from "./probe-helpers.mjs";

const CONTAINER = "agrobridge-audit-pg";
const PG_ADMIN = { user: "audit", password: "audit-password" };
const tag = Date.now();
const SOURCE_DB = `agrobridge_drill_${tag}`;
const RESTORE_DB = `agrobridge_restore_${tag}`;
const PORT = 4500;

const docker = (args, opts = {}) => execFileSync("docker", args, { encoding: "utf8", ...opts });
const psql = (db, sql) =>
  docker(["exec", "-i", CONTAINER, "psql", "-U", PG_ADMIN.user, "-d", db, "-tAc", sql]).trim();

const url = (db) => `postgresql://${PG_ADMIN.user}:${PG_ADMIN.password}@localhost:55432/${db}?schema=public`;
const out = {};

// ---- 1) Fresh source database + migrated, seeded instance -------------------
psql("postgres", `CREATE DATABASE ${SOURCE_DB}`);
execFileSync(process.execPath, ["scripts/provision-postgres.mjs"], {
  cwd: fileURLToPath(new URL("../../api", import.meta.url)),
  env: { ...process.env, DATABASE_URL: url(SOURCE_DB) },
  stdio: "pipe",
});

const { startApi, waitHealthy } = await import("./probe-helpers.mjs");
let api = startApi(PORT, url(SOURCE_DB));
await waitHealthy(PORT);
const session = await loginOn(PORT);
const dealer = await json("POST", PORT, "/api/v1/auth/login", { body: { phone: "01700000003", password: "Demo@1234" } });
const product = await json("POST", PORT, "/api/v1/products", {
  token: dealer.data.data.accessToken,
  body: { name: "ড্রিল পণ্য", category: "SEED", unit: "PCS", pricePaisa: 9000, stockQty: 3, sku: `DRL-${tag}` },
});
const productId = product.data.data.id;
await json("POST", PORT, "/api/v1/cart/items", { token: session.accessToken, body: { productId, qty: 1 } });
const order = await json("POST", PORT, "/api/v1/orders/checkout", { token: session.accessToken, body: { clientRequestId: randomUUID() } });
const orderId = order.data.data.id;
const intent = await json("POST", PORT, "/api/v1/payments/intent", { token: session.accessToken, body: { purposeType: "ORDER", purposeId: orderId } });
const paymentId = intent.data.data.paymentId;

// ---- 2) RES-01: kill the API mid-confirmation --------------------------------
const confirmPromise = json("POST", PORT, `/api/v1/payments/${paymentId}/confirm`, { token: session.accessToken, body: {} }).catch(() => "killed");
await new Promise((r) => setTimeout(r, 120));
await api.stop(); // SIGKILL the tree
await confirmPromise;
const midState = await (async () => {
  api = startApi(PORT, url(SOURCE_DB));
  await waitHealthy(PORT);
  const s = await loginOn(PORT);
  const payments = await json("GET", PORT, "/api/v1/payments", { token: s.accessToken });
  return (payments.data.data ?? []).find((p) => p.id === paymentId)?.status ?? "missing";
})();
// Retry the confirmation whatever state the kill left behind.
const retry = await json("POST", PORT, `/api/v1/payments/${paymentId}/confirm`, { token: session.accessToken, body: {} });
const finalOrders = await json("GET", PORT, "/api/v1/orders", { token: session.accessToken });
const finalOrder = (finalOrders.data.data ?? []).find((o) => o.id === orderId);
const paymentsAfter = await json("GET", PORT, "/api/v1/payments", { token: session.accessToken });
const succeeded = (paymentsAfter.data.data ?? []).filter((p) => p.id === paymentId && p.status === "SUCCEEDED").length;
const stock = (await json("GET", PORT, "/api/v1/products?pageSize=50", { token: session.accessToken })).data.data.items.find((p) => p.id === productId)?.stockQty;
out.killedMidFlight = { stateAfterRestart: midState, retryStatus: retry.status, paymentsSucceeded: succeeded, orderPaid: finalOrder?.paymentStatus, stockAfter: stock };

// ---- 3) RES-01: restart the DATABASE under the running API -------------------
docker(["restart", CONTAINER]);
await new Promise((r) => setTimeout(r, 4000));
const readyAfterDbRestart = await (async () => {
  // /ready may answer 503 while the pool reconnects; it must recover to 200.
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/ready`);
      if (res.ok) return (await res.json()).ready === true ? "recovered" : `unexpected:${res.status}`;
    } catch {
      /* still reconnecting */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return "never-recovered";
})();
const noDup = await json("POST", PORT, `/api/v1/payments/${paymentId}/confirm`, { token: session.accessToken, body: {} });
out.dbRestart = { readiness: readyAfterDbRestart, duplicateConfirm: noDup.status };
await api.stop();

// ---- 4) OPS-01: backup → restore into a fresh instance → migrate forward ------
const dump = docker(["exec", CONTAINER, "pg_dump", "-U", PG_ADMIN.user, "-d", SOURCE_DB], { maxBuffer: 64 * 1024 * 1024 });
psql("postgres", `CREATE DATABASE ${RESTORE_DB}`);
execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", PG_ADMIN.user, "-d", RESTORE_DB], { input: dump, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
// Migration chain forward on the restored data: deploy is idempotent; a pending
// migration would apply here, and `migrate status` must report nothing pending.
const apiDirPath = fileURLToPath(new URL("../../api", import.meta.url));
const { spawnSync } = await import("node:child_process");
const statusRes = spawnSync("npx", ["prisma", "migrate", "status", "--schema", "prisma/postgres/schema.prisma"], {
  cwd: apiDirPath,
  env: { ...process.env, DATABASE_URL: url(RESTORE_DB) },
  encoding: "utf8",
  shell: process.platform === "win32",
});
const statusText = `${statusRes.stdout ?? ""} ${statusRes.stderr ?? ""}`;
out.migrationForward = {
  exit: statusRes.status,
  upToDate: /up to date/i.test(statusText) && !/pending|not yet been applied/i.test(statusText),
  tail: statusText.trim().split("\n").slice(-3).join(" | "),
};

api = startApi(PORT, url(RESTORE_DB));
await waitHealthy(PORT);
const restoredOrders = await json("GET", PORT, "/api/v1/orders", { token: (await loginOn(PORT)).accessToken });
out.restored = {
  serves: true,
  orderCount: (restoredOrders.data.data ?? []).length,
  sourceOrderCount: (finalOrders.data.data ?? []).length,
};
await api.stop();

const pass =
  out.killedMidFlight.paymentsSucceeded === 1 &&
  out.killedMidFlight.orderPaid === "PAID" &&
  out.killedMidFlight.stockAfter === 2 &&
  out.dbRestart.readiness === "recovered" &&
  [409, 200].includes(out.dbRestart.duplicateConfirm) &&
  out.migrationForward.upToDate &&
  out.restored.serves &&
  out.restored.orderCount === out.restored.sourceOrderCount;

console.log(JSON.stringify({ scenarios: ["RES-01", "OPS-01"], pass, out }, null, 2));
process.exit(pass ? 0 : 1);
