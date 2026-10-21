#!/usr/bin/env node
/**
 * Licence gate for the production dependency tree (ci.yml quality-tools job).
 *
 * A dependency whose licence is not on the allowlist (license-allowlist.json)
 * is a legal problem that no test can see, so the check is a blocking CI step
 * rather than a review habit.
 *
 * How the tree is resolved: `package-lock.json` already records every installed
 * package as a path key plus its dev/link flags — the same classification
 * `npm ls --omit=dev` walks, but deterministic and offline, and it makes the
 * installed location of each package (root node_modules vs a nested one)
 * unambiguous. Each package's licence is then read from its own
 * node_modules/<pkg>/package.json, mirroring what `npm ls --parseable` would
 * point at.
 *
 * Exits non-zero listing package@version and the offending licence id; SPDX
 * expressions (OR/AND/WITH) pass only when every operand is allowed.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const allowlistFile = join(root, "license-allowlist.json");
if (!existsSync(allowlistFile)) {
  console.error(`licence check failed: ${allowlistFile} is missing`);
  process.exit(1);
}
const allowed = new Set(JSON.parse(readFileSync(allowlistFile, "utf8")).allowed ?? []);

const lockFile = join(root, "package-lock.json");
if (!existsSync(lockFile)) {
  console.error(`licence check failed: ${lockFile} is missing`);
  process.exit(1);
}
const lock = JSON.parse(readFileSync(lockFile, "utf8"));

function normalizeLicense(pkg) {
  if (typeof pkg.license === "string" && pkg.license.trim() !== "") return pkg.license.trim();
  if (pkg.license && typeof pkg.license === "object" && typeof pkg.license.type === "string") {
    return pkg.license.type.trim();
  }
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses.map((l) => (typeof l === "string" ? l : l?.type)).filter(Boolean);
    if (types.length) return types.join(" OR "); // legacy npm shape: an OR of choices
  }
  return null;
}

function isAllowed(expression) {
  if (allowed.has(expression)) return true;
  // SPDX expression: every AND operand must apply and every OR branch is a
  // choice, so the conservative reading is "every listed id must be allowed".
  const parts = expression
    .split(/[()]|\s+(?:AND|OR|WITH)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((p) => allowed.has(p));
}

const failures = [];
const missing = [];
let checked = 0;

for (const [lockPath, entry] of Object.entries(lock.packages ?? {})) {
  if (entry.dev === true) continue; // dev-only: not shipped
  if (entry.link === true) continue; // workspace symlink; the target dir is its own entry

  const dir = lockPath === "" ? root : join(root, lockPath);
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) {
    missing.push(lockPath === "" ? "(repository root)" : lockPath);
    continue;
  }

  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  const name = pkg.name ?? lockPath;
  const version = pkg.version ?? "?";
  const expression = normalizeLicense(pkg);
  checked += 1;

  if (expression === null) {
    failures.push(`${name}@${version} — no licence field`);
  } else if (!isAllowed(expression)) {
    failures.push(`${name}@${version} — "${expression}" is not on the allowlist`);
  }
}

if (checked === 0 && missing.length > 0) {
  console.error("licence check failed: no production packages found on disk — run `npm ci` first");
  process.exit(1);
}
for (const p of missing) {
  console.warn(`warning: ${p} is in the lockfile but not installed — skipped`);
}

if (failures.length) {
  console.error(
    `licence check failed (${failures.length} of ${checked} production packages):\n` +
      failures.map((f) => ` - ${f}`).join("\n") +
      "\nReview the licence; permissive ids go in license-allowlist.json, anything else is a decision, not a list edit.",
  );
  process.exit(1);
}
console.log(`licence check clean: ${checked} production packages, all ids on license-allowlist.json`);
