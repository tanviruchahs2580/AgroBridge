#!/usr/bin/env node
/**
 * knip gate — fails on NEW dead files / unused dependencies / unlisted binaries /
 * unused exports.
 *
 * F-67: the gate used to run knip with `--exclude types,nsTypes,exports,nsExports`,
 * so unused exports were structurally invisible, and knip.jsonc suppressed every
 * export under `src/lib/*.ts` with one blanket glob. Both are gone: the gate now
 * gates the `exports`/`nsExports` buckets, and the 19 export findings that exist
 * today are enumerated BY FILE AND SYMBOL in KNOWN_EXPORTS below (F-67's
 * "record them explicitly with reasons" — the owning files are outside this
 * change's edit scope). A new unused export now fails until someone records it
 * here with a reason and a removal trigger.
 *
 * `types`/`nsTypes` stay excluded for now (see the --exclude note below): the
 * contract-mirror type surface is a separate, larger call.
 *
 * A small reviewable KNOWN list keeps URL-built prisma schema imports and
 * intentionally-manual operator scripts out of the failure set — every entry
 * carries its reason/removal trigger.
 *
 * Buckets this gate FAILS on: files, dependencies, unlisted, binaries,
 * unresolved, exports, nsExports. (The `owners` bucket is informational — who
 * owns the discovered issues.)
 */
import { execFileSync } from "node:child_process";

const GATED = new Set(["files", "dependencies", "unlisted", "binaries", "unresolved", "exports", "nsExports"]);

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
  "apps/api/scripts/gen-docs.mjs", // writes docs/qa/test-status.md from vitest output — NOT part of the docs/generated freshness set (it is not schema- or env-derived)
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

/**
 * Export-level baseline (F-67). Key format: `<file>::<symbol>`.
 *
 * Every entry below was reported by `npx knip` on the 2026-11-10 tree. They are
 * recorded rather than fixed because the files are owned by other in-flight
 * streams; the removal trigger on each line is how this list shrinks. The
 * categories, honestly separated:
 *   - `in-file used` — the symbol is consumed inside its own module; the `export`
 *     keyword is (or may be) unneeded surface, but the code is live. An owner can
 *     drop the keyword without touching behaviour.
 *   - `legacy shim re-export` — an unfinished `lib/*` re-export migration (F-48);
 *     consumers import the canonical module directly.
 *   - `unused test helper` — no reader anywhere.
 */
const KNOWN_EXPORTS = new Set([
  // in-file used: the AI prompt builder's own context lines/escape use these.
  "apps/api/src/providers/ai/prompt.ts::CONTEXT_FIELD_LIMITS",
  "apps/api/src/providers/ai/prompt.ts::escapeFenceTokens",
  // in-file used: the eval scorers call these from their own module.
  "apps/api/src/providers/ai/scoring.ts::matchQualityOf",
  "apps/api/src/providers/ai/scoring.ts::tokenizeForSupport",
  "apps/api/src/providers/ai/scoring.ts::answerSupportRatio",
  // in-file used: sandbox confirm/status call it; exported for the webhook
  // unification the money stream owns (F-02). Removal trigger: nothing imports
  // it after that refactor lands.
  "apps/api/src/modules/payments/routes.ts::claimAndApplyPayment",
  // in-file used: login throttling keys on it from the same module.
  "apps/api/src/middleware/rateLimitKeys.ts::accountRateKeyPhone",
  // NOTE: separationOfDuties::assertNotSelfDealing was removed from this baseline
  // on 2026-11-10 — the F-75 remediation made refunds and withdrawal decisions
  // call it, so it is now genuinely consumed and knip no longer reports it.
  // Remediation exports (F-06/F-26/F-28/F-71 + the F-08 shared-role helper):
  // each is consumed by a test that pins the behaviour the audit required, or
  // composed in-file by a second module. Removal trigger: the pinning test is
  // deleted, or the symbol gains a production consumer outside its module.
  "apps/api/src/modules/farms/routes.ts::assertFarmAccess",
  "apps/api/src/lib/metrics.ts::requestsShedTotal",
  "apps/api/src/lib/metrics.ts::mountedPrefixFor",
  "apps/api/src/lib/metrics.ts::providerHealthGauge",
  "apps/api/src/shared/authorization.ts::PLATFORM_ADMIN_ROLES",
  // in-file used: farmsRouter mounts all three (`farmsRouter.use("/:id", plotsRouter())`
  // etc.); exported as module factories. Surfaced by the gate after the F-92
  // test-file split reshaped the analysed graph (knip 6.42.0). Removal trigger:
  // the factories lose the `export` keyword, or gain an external consumer.
  "apps/api/src/modules/farms/routes.ts::plotsRouter",
  "apps/api/src/modules/farms/routes.ts::cropsRouter",
  "apps/api/src/modules/farms/routes.ts::eventsRouter",
  // in-file used: ciContains() switches on it.
  "apps/api/src/shared/utils/ciContains.ts::isPostgres",
  // legacy shim re-export: the canonical module is consumed directly. Removal
  // trigger: the lib/* shim migration finishes or is reverted (F-48/SLP-02).
  "apps/api/src/lib/money.ts::TIER_DISCOUNT_PCT",
  "apps/api/src/lib/money.ts::GRADE_MULTIPLIER",
  "apps/api/src/lib/metrics.ts::httpRequestsTotal",
  "apps/api/src/lib/metrics.ts::httpRequestDuration",
  // unused test helper: no test imports it. Removal trigger: next tests/ edit
  // touching http-stub-server.ts drops it (test files are QA-owned).
  "apps/api/tests/http-stub-server.ts::withServerAndBody",
  // in-file used: rendered by ui.tsx's own components.
  "apps/web/src/components/ui.tsx::useUiLang",
  // in-file used: decideQueueOffline() reads both; the test names NEVER_QUEUE in
  // a title string only.
  "apps/web/src/lib/offlineQueueRules.ts::NEVER_QUEUE",
  "apps/web/src/lib/offlineQueueRules.ts::QUEUEABLE_METHODS",
  // in-file used: the fallback branch of serviceHeroImage().
  "apps/web/src/components/service/heroImages.ts::SERVICE_HERO_FALLBACK",
  // in-file used: the dead-class scanner calls it from its own main flow.
  "apps/web/scripts/lib/dead-classes.mjs::collectClassTokens",
]);

const args = [
  "--no-progress",
  "--no-exit-code",
  // One knip configuration in the repo: the remediation branch's knip.jsonc
  // (it already declares the contract-mirror, operator-run and web-surface
  // exemptions this gate's baseline documents). Pinned explicitly because a
  // second config file (the pre-merge knip.json) would make bare-knip
  // resolution ordering decide the findings.
  "--config", "knip.jsonc",
  // F-67: exports are gated now; only the type-level buckets remain excluded
  // (contract-mirror type surface, tracked separately).
  "--exclude", "types,nsTypes",
  "--reporter", "json",
];
const out = execFileSync("npx", ["knip", ...args], { encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 });
const report = JSON.parse(out);

const unexpected = [];
const observedExports = new Set();
for (const [workspace, entry] of Object.entries(report.issues ?? {})) {
  const file = String(entry.file ?? "").replace(/\\/g, "/");
  for (const [bucket, items] of Object.entries(entry)) {
    if (!GATED.has(bucket) || !Array.isArray(items)) continue;
    for (const raw of items) {
      const name = (typeof raw === "string" ? raw : (raw.file ?? raw.name ?? JSON.stringify(raw))).replace(/\\/g, "/");
      const exportKey = bucket === "exports" || bucket === "nsExports" ? `${file}::${name}` : null;
      if (exportKey) observedExports.add(exportKey);
      const known =
        KNOWN.has(name) ||
        (exportKey !== null && KNOWN_EXPORTS.has(exportKey)) ||
        // unresolved-import entries are bare specifiers: accept a known-path with the
        // same basename (the two URL-built prisma schema imports).
        (bucket === "unresolved" && [...KNOWN].some((k) => k.split("/").pop() === name.split("/").pop()));
      console.log(`${known ? "known" : "NEW  "} ${workspace} | ${bucket} | ${file} | ${name}`);
      if (!known) unexpected.push(`${workspace} ${bucket}: ${file}::${name}`);
    }
  }
}

// A recorded export that knip no longer reports has been used or deleted —
// the baseline must shrink, or it becomes a blanket again.
const stale = [...KNOWN_EXPORTS].filter((key) => !observedExports.has(key));
for (const key of stale) console.log(`stale ${key} — no longer reported; remove it from KNOWN_EXPORTS`);

if (unexpected.length) {
  console.error(`\nknip gate FAILED — ${unexpected.length} new finding(s) not in the reviewed baseline:`);
  for (const u of unexpected) console.error(`  - ${u}`);
  console.error("Fix the code, or (with a reason and removal trigger) add it to KNOWN/KNOWN_EXPORTS in scripts/knip-gate.mjs.");
  process.exit(1);
}
console.log("\nknip gate OK — only reviewed baseline items present.");
