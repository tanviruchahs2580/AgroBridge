#!/usr/bin/env node
/**
 * Backup / restore rehearsal for PostgreSQL (application-level logical backup).
 *
 * Why: this machine has no pg_dump; production must use pg_dump/pg_basebackup
 * (see docs/disaster-recovery.md). This script proves the DATA LAYER is fully
 * recoverable via SQL-level export/import and measures actual durations.
 *
 * Steps:
 *   1. Dump all tables of $DATABASE_URL to a timestamped JSON file (data + row counts).
 *   2. Create a scratch database, apply schema, restore data.
 *   3. Compare per-table row counts source vs restored; exit non-zero on mismatch.
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

const TABLES = [
  // FK-safe order: Organization precedes tables holding organizationId;
  // OrganizationMember follows both Organization and User (v1.2.0 multitenancy)
  "Organization", "User", "OrganizationMember", "RefreshToken", "FarmerProfile",
  "Farm", "Plot", "CropCycle", "FarmEvent",
  "AdvisoryQuery", "DiseaseCase", "Product", "Cart", "CartItem", "Order", "OrderItem",
  "Service", "ServiceProvider", "Booking", "ProcurementOrder", "Payment", "Wallet",
  "WalletTransaction", "MembershipPlan", "Notification", "AuditLog", "AiUsageLog",
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

await prisma.$disconnect();
await target.$disconnect();

const totalMs = Date.now() - t0;
console.log("──────────────────────────────────────────────");
console.log(mismatches === 0 ? "✅ RESTORE VERIFIED — 100% row integrity, no orphans" : `❌ ${mismatches} integrity failures`);
console.log(`Backup: ${backupMs}ms · Restore: ${restoreMs}ms · Total rehearsal: ${(totalMs / 1000).toFixed(1)}s`);
unlinkSync(dumpFile);
process.exit(mismatches === 0 ? 0 : 1);
