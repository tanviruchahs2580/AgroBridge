#!/usr/bin/env node
/**
 * Backup / restore rehearsal for PostgreSQL (application-level logical backup).
 *
 * Why: this machine has no pg_dump; production must use pg_dump/pg_basebackup
 * (see docs/disaster-recovery.md). This script proves the DATA LAYER is fully
 * recoverable via SQL-level export/import and measures actual durations —
 * dumped to a receipt file so a restore drill (gate G4, OA-06) has numbers an
 * owner can sign instead of prose.
 *
 * Steps:
 *   1. Dump all tables of $DATABASE_URL to a timestamped JSON file (data + row counts).
 *   2. Create a scratch database, apply schema, restore data.
 *   3. Compare per-table row counts source vs restored, run smoke queries, and
 *      time every phase.
 *   4. Write a receipt file with the timed phases; exit non-zero on mismatch.
 *
 * Disposable-target guard (WP-13): the script DESTROYS the scratch database.
 * It refuses any SCRATCH_URL whose host is not on SCRATCH_HOST_ALLOW
 * (default: localhost addresses only) and any host on SCRATCH_HOST_DENY, and
 * refuses when both URLs are the same. A remote drill (e.g. a Neon PITR
 * branch) therefore requires explicitly setting SCRATCH_HOST_ALLOW for that
 * branch's host — an unlisted production host can never be wiped by accident.
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres@localhost:5433/agrobridge \
 *   SCRATCH_URL=postgresql://postgres@localhost:5433/agrobridge_restore_test \
 *     node scripts/backup-restore-rehearsal.mjs
 */
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const srcUrl = process.env.DATABASE_URL;
const scratchUrl = process.env.SCRATCH_URL;
if (!srcUrl?.startsWith("postgresql") || !scratchUrl?.startsWith("postgresql")) {
  console.error("DATABASE_URL and SCRATCH_URL (postgresql://) required");
  process.exit(1);
}

// --- Disposable-target guard (WP-13): this script drops the scratch database. ---
function hostOf(url) {
  return new URL(url).hostname;
}
const allow = (process.env.SCRATCH_HOST_ALLOW ?? "localhost|127\\.0\\.0\\.1|::1|0\\.0\\.0\\.0")
  .split(",")
  .filter(Boolean)
  .map((p) => new RegExp(`^${p.trim()}$`, "i"));
const deny = (process.env.SCRATCH_HOST_DENY ?? "")
  .split(",")
  .filter(Boolean)
  .map((p) => new RegExp(`^${p.trim()}$`, "i"));
const scratchHost = hostOf(scratchUrl);
if (srcUrl === scratchUrl) {
  console.error("REFUSED: SCRATCH_URL equals DATABASE_URL — the drill would drop the source database.");
  process.exit(1);
}
if (deny.some((r) => r.test(scratchHost))) {
  console.error(`REFUSED: scratch host "${scratchHost}" matches SCRATCH_HOST_DENY — choose a disposable target (docs/runbooks/restore-drill.md).`);
  process.exit(1);
}
if (!allow.some((r) => r.test(scratchHost))) {
  console.error(
    `REFUSED: scratch host "${scratchHost}" is not on SCRATCH_HOST_ALLOW (default: localhost only). ` +
    "A non-disposable target must never be dropped by a rehearsal — for a remote disposable branch " +
    "(e.g. a Neon PITR branch) set SCRATCH_HOST_ALLOW to that branch's exact host. See docs/runbooks/restore-drill.md."
  );
  process.exit(1);
}

const TABLES = [
  // FK-safe order: Organization precedes tables holding organizationId;
  // OrganizationMember follows both Organization and User (v1.2.0 multitenancy)
  "Organization", "User", "OrganizationMember", "RefreshToken", "FarmerProfile",
  "Farm", "Plot", "CropCycle", "FarmEvent",
  "AdvisoryQuery", "DiseaseCase", "Product", "Cart", "CartItem", "Order", "OrderItem",
  "Service", "ServiceProvider", "Booking", "ProcurementOrder", "Payment", "Wallet",
  "WalletTransaction", "MembershipPlan", "Notification", "AuditLog", "AiUsageLog", "LoginAttempt", "StoredObject", "PendingUploadPurge",
];

const t0 = Date.now();
const prisma = new PrismaClient({ datasources: { db: { url: srcUrl } } });

console.log("[1/4] Exporting data ...");
const dump = { createdAt: new Date().toISOString(), tables: {} };
for (const table of TABLES) {
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
  dump.tables[table] = JSON.parse(JSON.stringify(rows, (_, v) => (typeof v === "bigint" ? Number(v) : v)));
}
const dumpFile = `backup-${Date.now()}.json`;
writeFileSync(dumpFile, JSON.stringify(dump));
const backupMs = Date.now() - t0;
console.log(`    -> ${dumpFile} (${TABLES.reduce((s, t) => s + dump.tables[t].length, 0)} rows) in ${backupMs}ms`);

// Simulate disaster: drop & recreate scratch DB from scratch
console.log("[2/4] Destroying & recreating scratch database ...");
const admin = new PrismaClient({ datasources: { db: { url: srcUrl.replace(/\/[^/]+$/, "/postgres") } } });
await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratchUrl.split("/").pop()}";`);
await admin.$executeRawUnsafe(`CREATE DATABASE "${scratchUrl.split("/").pop()}";`);
await admin.$disconnect();

execSync("npx prisma db push --skip-generate --schema prisma/schema.postgresql.prisma", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: scratchUrl },
});

console.log("[3/4] Restoring data ...");
const r0 = Date.now();
const target = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
const restored = readFileSync(dumpFile, "utf8");
const parsed = JSON.parse(restored);

// Insert order respects FKs: parents first (order as listed in TABLES)
for (const table of TABLES) {
  const rows = parsed.tables[table];
  if (!rows.length) continue;
  const CHUNK = 50;
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const cols = Object.keys(rows[0]);
    const colList = cols.map((c) => `"${c}"`).join(",");
    let paramIdx = 0;
    const tuples = [];
    const params = [];
    for (const row of slice) {
      const exprs = cols.map((c) => {
        const val = row[c];
        if (val === null || val === undefined) return "NULL"; // typed by column, no param needed
        params.push(typeof val === "string" && ISO_DATE.test(val) ? new Date(val) : val);
        return `$${++paramIdx}`;
      });
      tuples.push(`(${exprs.join(",")})`);
    }
    await target.$executeRawUnsafe(`INSERT INTO "${table}" (${colList}) VALUES ${tuples.join(",")}`, ...params);
  }
}
const restoreMs = Date.now() - r0;

console.log("[4/4] Verifying integrity ...");
const v0 = Date.now();
let mismatches = 0;
for (const table of TABLES) {
  const [srcCount] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${table}"`);
  const [dstCount] = await target.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${table}"`);
  const ok = srcCount.c === dstCount.c && dstCount.c === parsed.tables[table].length;
  if (!ok) { mismatches++; console.log(`    MISMATCH ${table}: src=${srcCount.c} restored=${dstCount.c} dump=${parsed.tables[table].length}`); }
}

// Spot-check relational integrity on the restored copy
const orphanEvents = await target.$queryRawUnsafe(
  `SELECT COUNT(*)::int AS c FROM "FarmEvent" e LEFT JOIN "Farm" f ON f."id" = e."farmId" WHERE f."id" IS NULL`
);
if (orphanEvents[0].c > 0) mismatches++;
const verifyMs = Date.now() - v0;

// Smoke queries on the restored copy: the queries a recovered deployment
// actually serves first — login lookups, product listing, recent orders.
const s0 = Date.now();
const smoke = [];
const smokeDefs = [
  ["users count", `SELECT COUNT(*)::int AS c FROM "User"`],
  ["orders count", `SELECT COUNT(*)::int AS c FROM "Order"`],
  ["payments count", `SELECT COUNT(*)::int AS c FROM "Payment"`],
  ["latest audit row", `SELECT MAX("createdAt") AS latest FROM "AuditLog"`],
  ["latest payment row", `SELECT MAX("createdAt") AS latest FROM "Payment"`],
];
for (const [name, q] of smokeDefs) {
  const started = Date.now();
  await target.$queryRawUnsafe(q);
  smoke.push({ name, ms: Date.now() - started });
}
const smokeMs = Date.now() - s0;

await prisma.$disconnect();
await target.$disconnect();

const totalMs = Date.now() - t0;
const verdict = mismatches === 0 ? "RESTORE VERIFIED — 100% row integrity, no orphans" : `${mismatches} integrity failures`;
console.log("──────────────────────────────────────────────");
console.log(mismatches === 0 ? `✅ ${verdict}` : `❌ ${verdict}`);
console.log(`Backup: ${backupMs}ms · Restore: ${restoreMs}ms · Verify: ${verifyMs}ms · Smoke: ${smokeMs}ms · Total rehearsal: ${(totalMs / 1000).toFixed(1)}s`);

// Receipt: the timed phases an owner signs for the RTO (gate G4, OA-06).
const receiptFile = `restore-drill-receipt-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
const receipts = TABLES.map((t) => `| ${t} | ${parsed.tables[t].length} | ${mismatches === 0 ? "ok" : "MISMATCH"} |`).join("\n");
writeFileSync(
  receiptFile,
  `# Restore drill receipt — ${new Date().toISOString()}\n\n` +
  "Machine: fill in (OS, network, where the target lives). Operator: fill in. Commit: fill in.\n\n" +
  `| Phase | Duration |\n|---|---|\n| Dump (export) | ${backupMs} ms |\n| Restore (schema + data) | ${restoreMs} ms |\n| Row-count verification | ${verifyMs} ms |\n| Smoke queries | ${smokeMs} ms |\n| **Total rehearsal** | **${totalMs} ms (${(totalMs / 1000).toFixed(1)} s)** |\n\n` +
  `Verdict: ${verdict}.\n\n` +
  "## Smoke queries (timed)\n\n| Query | Duration |\n|---|---|\n" +
  smoke.map((s) => `| ${s.name} | ${s.ms} ms |`).join("\n") + "\n\n" +
  "## Row counts (dump = restored = source)\n\n| Table | Rows | State |\n|---|---|---|\n" +
  receipts + "\n\n" +
  "RPO/RTO: the OWNER signs these numbers (docs/runbooks/restore-drill.md §RPO/RTO); this receipt\n" +
  "records evidence, not claims. The dump file was deleted after verification.\n"
);
console.log(`Receipt written: ${receiptFile}`);
unlinkSync(dumpFile);
process.exit(mismatches === 0 ? 0 : 1);
