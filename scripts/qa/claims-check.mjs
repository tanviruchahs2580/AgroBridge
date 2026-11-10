#!/usr/bin/env node
/**
 * Claims verifier (audit remediation): docs must not drift from reality.
 *
 * Checks, with a non-zero exit on any failure:
 *  1. every `npm run <script> --workspace <ws>` mentioned in the tracked
 *     governance/current-state documents resolves to a script in that
 *     workspace's package.json;
 *  2. the version in version.json equals the version in every workspace
 *     manifest and the root manifest (single source, ADR-0006);
 *  3. no hardcoded test-count claims return to the current-state documents
 *     ("# 150 tests" style) — counts live in run output, never in prose.
 *
 * F-47: the gate used to own only README.md, CONTRIBUTING.md and
 * docs/testing.md — the documents carrying the load-bearing governance claims
 * (AGENTS.md, docs/STATUS.md, the root policy files) were outside every
 * conformance gate. They are now in scope. CHANGELOG.md is in scope for check 1
 * but deliberately exempt from check 3: it records what was true at each
 * release, so historical counts are history, not a live claim.
 *
 * Sources are filtered through `git ls-files` (like the link checker): a file
 * that is not committed yet is reported and skipped — the tracked artifact is
 * what this gate verifies.
 *
 * The link checker covers relative-link existence separately.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const tracked = new Set(
  execSync("git ls-files -z", { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean)
);
const failures = [];

/** Documents owned by check 1 (script references + version). Only if tracked. */
const DOC_SOURCES = [
  "README.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "CHANGELOG.md",
  "PRIVACY_POLICY.md",
  "TERMS_OF_SERVICE.md",
  "SECURITY.md",
  "docs/testing.md",
  "docs/STATUS.md",
];
for (const name of DOC_SOURCES) {
  if (!tracked.has(name) && existsSync(join(root, name))) console.log(`claims-check: skipped (not tracked): ${name}`);
}
const docFiles = DOC_SOURCES.filter((f) => tracked.has(f) && existsSync(join(root, f)));

// --- 1. documented npm scripts exist --------------------------------------
// Whitespace is flattened before matching so a reference wrapped across two
// lines (`npm run purge:uploads --workspace\n  apps/api`) still resolves, and
// `--workspace` must follow the script name directly — an unrelated later
// `--workspace` in the same sentence must not be attached to the wrong script.
const scriptRef = /npm run ([a-z0-9:_-]+)(?:\s+--workspace\s+([a-z@/.-]+))?/gi;
const manifests = new Map();
function manifest(ws) {
  const p = ws.startsWith("@") || ws.includes("/") ? join(root, "apps", ws.replace(/^.*\//, "")) : join(root, "apps", ws);
  const file = join(p, "package.json");
  if (!manifests.has(file)) manifests.set(file, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).scripts ?? {} : null);
  return manifests.get(file);
}
for (const doc of docFiles) {
  const text = readFileSync(join(root, doc), "utf8").replace(/\s+/g, " ");
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

// --- 3. no hardcoded test counts in current-state prose --------------------
// Check 1's document list minus CHANGELOG.md (history is allowed to say what
// was true then; a count in a current-state document is drift waiting to
// happen). docs/STATUS.md is the truth page, so it is the most important
// member of this list.
const countClaim = /#\s*\d{2,}\s+(unit\s+)?tests?\b/i;
for (const doc of docFiles) {
  if (doc === "CHANGELOG.md") continue;
  const text = readFileSync(join(root, doc), "utf8");
  if (countClaim.test(text)) failures.push(`${doc}: hardcoded test count in prose (counts move — reference the run output instead)`);
}

if (failures.length) {
  console.error("claims-check failed:\n" + failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
console.log("claims-check clean: documented scripts resolve, one version source, no count claims");
