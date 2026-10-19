#!/usr/bin/env node
/**
 * Claims verifier (audit remediation): docs must not drift from reality.
 *
 * Checks, with a non-zero exit on any failure:
 *  1. every `npm run <script> --workspace <ws>` mentioned in README/CONTRIBUTING/
 *     docs/testing.md resolves to a script in that workspace's package.json;
 *  2. the version in version.json equals the version in every workspace
 *     manifest and the root manifest (single source, ADR-0006);
 *  3. no hardcoded test-count claims return to README/CONTRIBUTING
 *     ("# 150 tests" style) — counts live in run output, never in prose.
 *
 * The link checker covers relative-link existence separately.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const failures = [];

// --- 1. documented npm scripts exist --------------------------------------
const docFiles = ["README.md", "CONTRIBUTING.md", "docs/testing.md"].filter((f) => existsSync(join(root, f)));
const scriptRef = /npm run ([a-z0-9:_-]+)(?:[^\n]*?--workspace ([a-z@/.-]+))?/gi;
const manifests = new Map();
function manifest(ws) {
  const p = ws.startsWith("@") || ws.includes("/") ? join(root, "apps", ws.replace(/^.*\//, "")) : join(root, "apps", ws);
  const file = join(p, "package.json");
  if (!manifests.has(file)) manifests.set(file, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).scripts ?? {} : null);
  return manifests.get(file);
}
for (const doc of docFiles) {
  const text = readFileSync(join(root, doc), "utf8");
  for (const m of text.matchAll(scriptRef)) {
    const [, script, ws] = m;
    const target = ws ? manifest(ws) : JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
    if (target === null) {
      failures.push(`${doc}: references a workspace without package.json: ${ws}`);
      continue;
    }
    if (!(script in target)) failures.push(`${doc}: "npm run ${script}${ws ? ` --workspace ${ws}` : ""}" has no such script`);
  }
}

// --- 2. single version source ---------------------------------------------
const versionJson = JSON.parse(readFileSync(join(root, "version.json"), "utf8")).version;
const manifestsToCheck = ["package.json", "apps/api/package.json", "apps/web/package.json"];
for (const m of manifestsToCheck) {
  if (!existsSync(join(root, m))) continue;
  const v = JSON.parse(readFileSync(join(root, m), "utf8")).version;
  if (v !== versionJson) failures.push(`${m}: version ${v} != version.json ${versionJson}`);
}

// --- 3. no hardcoded test counts in prose ---------------------------------
const countClaim = /#\s*\d{2,}\s+(unit\s+)?tests?\b/i;
for (const doc of ["README.md", "CONTRIBUTING.md"]) {
  if (!existsSync(join(root, doc))) continue;
  const text = readFileSync(join(root, doc), "utf8");
  if (countClaim.test(text)) failures.push(`${doc}: hardcoded test count in prose (counts move — reference the run output instead)`);
}

if (failures.length) {
  console.error("claims-check failed:\n" + failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
console.log("claims-check clean: documented scripts resolve, one version source, no count claims");
