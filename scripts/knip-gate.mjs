#!/usr/bin/env node
/**
 * knip gate — fails on NEW dead files / unused dependencies / unlisted binaries.
 *
 * knip's export-level findings (contract-mirror types in apps/web/src/lib/api-types.ts
 * and friends) are excluded from this gate by running knip with
 * `--exclude types,nsTypes,exports,nsExports`; deleting those 24 contract-mirror
 * types is tracked in the SLP-02 follow-up, not this gate. A small reviewable KNOWN
 * list keeps URL-built prisma schema imports and intentionally-manual operator
 * scripts out of the failure set — every entry carries its reason/removal trigger.
 *
 * Buckets this gate FAILS on: files, dependencies, unlisted, binaries, unresolved.
 * (The `owners` bucket is informational — who owns the discovered issues.)
 */
import { execFileSync } from "node:child_process";

const GATED = new Set(["files", "dependencies", "unlisted", "binaries", "unresolved"]);

const KNOWN = new Set([
  // Vercel build commands — referenced from vercel.json `buildCommand`, invisible
  // to knip's dependency graph. Removal trigger: the Vercel build moves into CI.
  "scripts/vercel-build-api.mjs",
  "scripts/vercel-build-web.mjs",
  // Operator tools invoked manually, per docs/play/release-runbook.md and the QA
  // receipts. Removal trigger: the flows they automate are retired.
  "scripts/play/capture-screenshots.mjs",
  "scripts/play/create-reviewer-account.mjs",
  "scripts/qa/full-functional-sweep.mjs",
  "apps/api/scripts/backup-restore-rehearsal.mjs",
  "apps/api/scripts/prune-uploads.mjs",
  "apps/api/scripts/reconcile-wallet.mjs",
  // Maintenance scripts wired into docs or the release pipeline.
  "apps/api/scripts/gen-docs.mjs", // generates docs/generated/* (freshness guards)
  "apps/api/scripts/patch-vercel-output.mjs", // Vercel build chain
  "apps/api/scripts/postbuild-smoke.mjs", // Vercel post-build smoke
  // URL-built prisma schema imports — knip cannot resolve `new URL(p, import.meta.url)`
  // specifiers that point at schema files; both files are entry-level operator tools.
  "prisma/schema.prisma",
  "prisma/schema.postgresql.prisma",
  // This gate script itself (manually invoked from the CI quality job).
  "scripts/knip-gate.mjs",
  // PostgreSQL schema — reachable from backup-restore-rehearsal.mjs via a
  // URL-built import (knip resolves it as an unused *file* while flagging the
  // specifier as unresolved; both sides of the same artifact).
  "apps/api/prisma/postgres/schema.prisma",
  // One-shot ARC-15 receipt generator, run manually in the QA container
  // (receipt committed at docs/qa/query-plan-receipt.md). Not an npm entry by
  // design — it requires the suite database. Removal trigger: ARC-15 closes.
  "apps/api/scripts/query-receipts.mjs",
  // Component workbench used during UI development; not shipped.
  "apps/web/src/components/ui.stories.tsx",
]);

const args = [
  "--no-progress",
  "--no-exit-code",
  "--exclude", "types,nsTypes,exports,nsExports",
  "--reporter", "json",
];
const out = execFileSync("npx", ["knip", ...args], { encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 });
const report = JSON.parse(out);

const unexpected = [];
for (const [workspace, buckets] of Object.entries(report.issues ?? {})) {
  for (const [bucket, items] of Object.entries(buckets)) {
    if (!GATED.has(bucket) || !Array.isArray(items)) continue;
    for (const raw of items) {
      const name = (typeof raw === "string" ? raw : (raw.file ?? raw.name ?? JSON.stringify(raw))).replace(/\\/g, "/");
      const known =
        KNOWN.has(name) ||
        // unresolved-import entries are bare specifiers: accept a known-path with the
        // same basename (the two URL-built prisma schema imports).
        (bucket === "unresolved" && [...KNOWN].some((k) => k.split("/").pop() === name.split("/").pop()));
      console.log(`${known ? "known" : "NEW  "} ${workspace} | ${bucket} | ${name}`);
      if (!known) unexpected.push(`${workspace} ${bucket}: ${name}`);
    }
  }
}

if (unexpected.length) {
  console.error(`\nknip gate FAILED — ${unexpected.length} new finding(s) not in the reviewed baseline:`);
  for (const u of unexpected) console.error(`  - ${u}`);
  console.error("Fix the code, or (with a reason and removal trigger) add it to KNOWN in scripts/knip-gate.mjs.");
  process.exit(1);
}
console.log("\nknip gate OK — only reviewed baseline items present.");
