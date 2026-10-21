#!/usr/bin/env node
/**
 * Migration drift gate: the SQLite migration chain applied to a scratch database
 * must produce exactly the schema that prisma/schema.prisma declares.
 * `--script` emits the SQL that WOULD change the DB; anything beyond Prisma's
 * "-- This is an empty migration." marker is drift and fails the run.
 * (Cross-platform print/cleanup is done in Node — npm scripts on Windows run cmd.exe.)
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

const shadow = "drift-shadow.db";
const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";

let out = "";
try {
  out = execFileSync(npxBin, [
    "prisma", "migrate", "diff",
    "--from-migrations", "prisma/migrations",
    "--to-schema-datamodel", "prisma/schema.prisma",
    "--shadow-database-url", `file:./${shadow}`,
    "--script",
  ], { cwd: "apps/api", encoding: "utf8", maxBuffer: 32 * 1024 * 1024, shell: process.platform === "win32" });
} catch (e) {
  console.error(String(e));
  process.exit(2);
} finally {
  rmSync(shadow, { force: true });
}

const drift = out
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("--") && !l.includes("empty migration") && !l.includes("pris.ly"));
if (drift.length) {
  console.error(`migration drift detected:\n${drift.join("\n")}`);
  process.exit(1);
}
console.log("no schema drift: the migration chain reproduces the schema exactly.");
