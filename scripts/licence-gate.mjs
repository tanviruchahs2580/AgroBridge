#!/usr/bin/env node
/**
 * Production-dependency licence gate: walks the installed production dependency
 * tree (node_modules of the root workspace), reads each package's declared
 * licence, and fails when a licence is not on the allow-list in
 * LICENCE_ALLOWLIST (committed, one entry per package with a reason).
 * New dependency → add its licence here with a reason and removal trigger.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const ALLOWLIST_FILE = new URL("./licence-allowlist.json", import.meta.url);
const ALLOW = new Set([
  "MIT", "MIT*", "MIT OR Apache-2.0", "MIT/X11", "BlueOak-1.0.0",
  "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "BSD-3-Clause OR MIT",
  "0BSD", "Unlicense", "Unlicense OR MIT", "(MIT OR Apache-2.0)",
  "(MIT OR CC0-1.0)", "(MIT OR GPL-3.0-or-later)", "CC-BY-4.0", "CC0-1.0",
  "Python-2.0", "Artistic-2.0",
]);

const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
// .cmd shims on Windows require a shell (Node >= 21 refuses to spawn them bare).
const raw = execFileSync(npmBin, ["ls", "--all", "--omit=dev", "--json", "--long"], {
  encoding: "utf8", maxBuffer: 256 * 1024 * 1024, shell: process.platform === "win32",
});
const tree = JSON.parse(raw);

const seen = new Map();
function walk(node) {
  for (const [name, info] of Object.entries(node.dependencies ?? {})) {
    if (!seen.has(name)) {
      let licence = info.license;
      if (!licence && info.path) {
        const pj = `${info.path}/package.json`;
        if (existsSync(pj)) {
          try { licence = JSON.parse(readFileSync(pj, "utf8")).license; } catch { /* unreadable → handled below */ }
        }
      }
      seen.set(name, licence ?? "(missing)");
    }
    walk(info);
  }
}
walk(tree);

const overrides = existsSync(ALLOWLIST_FILE) ? JSON.parse(readFileSync(ALLOWLIST_FILE, "utf8")) : {};
const problems = [];
for (const [name, licence] of [...seen].sort()) {
  const parts = String(licence).split(/\s+OR\s+|\s+AND\s+|\(|\)|\//).map((s) => s.trim()).filter(Boolean);
  const ok = parts.every((p) => ALLOW.has(p)) || parts.length === 0 ? ALLOW.has(String(licence).trim()) : false;
  if (ok || overrides[name]) continue;
  problems.push(`${name} -> "${licence}"`);
}

if (problems.length) {
  console.error(`licence gate FAILED — ${problems.length} package(s) not on the allow-list:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`Add to scripts/licence-allowlist.json with a reason if genuinely acceptable.`);
  process.exit(1);
}
console.log(`licence gate OK — ${seen.size} production packages on the allow-list.`);
