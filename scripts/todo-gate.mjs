#!/usr/bin/env node
/**
 * TODO/FIXME discipline gate (SLP-04): shipped TypeScript source must not carry
 * TODO/FIXME/HACK/XXX markers — unfinished work belongs in an issue or in the
 * docs (with a reason), not in comments a future reader trips over.
 *
 * Implementation note: no statSync-before-read (CodeQL js/file-system-race). A
 * file that vanishes between readdir and read is skipped via the catch.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCOPES = ["apps/api/src", "apps/web/src"];
const MARKER = /\b(TODO|FIXME|HACK|XXX)\b/;

const offenders = [];
function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // vanished or unreadable between listing and walking — skip
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    try {
      const lines = readFileSync(full, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (MARKER.test(line)) offenders.push(`${path.relative(repoRoot, full)}:${i + 1} ${line.trim().slice(0, 80)}`);
      });
    } catch {
      /* unreadable in-flight — skip */
    }
  }
}
for (const scope of SCOPES) walk(path.join(repoRoot, scope));

if (offenders.length) {
  console.error(`TODO gate FAILED — ${offenders.length} marker(s) in shipped source:`);
  for (const o of offenders) console.error(`  - ${o}`);
  console.error("Finish the work, or move it to an issue and remove the marker.");
  process.exit(1);
}
console.log("TODO gate OK — no TODO/FIXME/HACK/XXX in shipped source.");
