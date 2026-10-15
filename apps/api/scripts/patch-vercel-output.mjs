#!/usr/bin/env node
/**
 * Post-processes the `vercel build` output (Build Output API) for the API
 * function so the deployed bundle runs Prisma against PostgreSQL on Vercel.
 *
 * Why this exists (2026-10-15 re-platform, CERT-06/INC-2026-10-15):
 *  1. @vercel/node traces the workspace-root node_modules between the install
 *     (root postinstall generates the SQLite client for local dev) and the
 *     deploy-time PG regeneration, so the traced bundle can carry the SQLite
 *     client/config.
 *  2. The tracer also snapshots only the current-platform query engine, but the
 *     Vercel runtime is rhel-openssl-3.0.x, so that binary must be placed into
 *     the bundle explicitly.
 *
 * Run AFTER `vercel build --prod` and BEFORE `vercel deploy --prebuilt`:
 *   node scripts/patch-vercel-output.mjs
 * Idempotent; exits non-zero when the expected output layout is missing.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const apiDir = path.dirname(fileURLToPath(import.meta.url)); // apps/api/scripts
const apiRoot = path.resolve(apiDir, "..");
const repoRoot = path.resolve(apiRoot, "..", "..");

const funcDir = path.join(apiRoot, ".vercel", "output", "functions", "api", "index.func");
const bundlePrisma = path.join(funcDir, "node_modules", ".prisma", "client");
const sourcePrisma = path.join(repoRoot, "node_modules", ".prisma", "client");

if (!existsSync(funcDir)) {
  console.error("patch-vercel-output: .vercel/output/functions/api/index.func not found — run `vercel build --prod` first");
  process.exit(1);
}

// Regenerate the PostgreSQL client last so the copied tree is PG-configured
// regardless of what the earlier postinstall/trace snapshot captured.
execSync("npx prisma generate --schema=prisma/postgres/schema.prisma", { cwd: apiRoot, stdio: "inherit" });
if (!existsSync(sourcePrisma)) {
  console.error("patch-vercel-output: generated client missing at repo node_modules/.prisma/client");
  process.exit(1);
}

// Replace the traced client (possibly SQLite) with the PG-generated one, which
// already contains both native and rhel engines per the schema binaryTargets.
rmSync(bundlePrisma, { recursive: true, force: true });
mkdirSync(path.dirname(bundlePrisma), { recursive: true });
cpSync(sourcePrisma, bundlePrisma, { recursive: true });

const engines = existsSync(path.join(bundlePrisma, "libquery_engine-rhel-openssl-3.0.x.so.node"));
const schema = cpSync; // touched below for logging only
if (!engines) {
  console.error("patch-vercel-output: rhel engine missing after copy — check binaryTargets in prisma/postgres/schema.prisma");
  process.exit(1);
}
console.log("patch-vercel-output: bundle Prisma client → postgresql + rhel-openssl-3.0.x engine ✔");
