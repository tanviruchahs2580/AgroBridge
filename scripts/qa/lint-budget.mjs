#!/usr/bin/env node
/**
 * ESLint warning ratchet (AUD-V3). The API lint runs without
 * --max-warnings=0: complexity/max-lines rules are warn-level "by design"
 * with a curated exceptions table (CONTRIBUTING.md), but nothing counted the
 * warnings — so drift was invisible and the exceptions table could go stale.
 *
 * This gate FAILS when the warning count exceeds the recorded budget, and
 * records today's count as the budget. New warnings ⇒ raise the budget in
 * the same PR and justify it in CONTRIBUTING's exceptions table (or fix the
 * code). Warnings going DOWN is always welcome; update the budget down when
 * you land such a refactor.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BUDGET_FILE = "scripts/qa/lint-warning-budget.json";
const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";

const budget = JSON.parse(readFileSync(BUDGET_FILE, "utf8"));

/** Per-app lint targets: the API lints src + tests, the web app has no tests dir. */
const LINT_TARGETS = { "apps/api": ["src", "tests"], "apps/web": ["src"] };

function countWarnings(cwd) {
  let out = "";
  try {
    out = execFileSync(npxBin, ["eslint", ...LINT_TARGETS[cwd], "--format", "json"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
  } catch (e) {
    // Exit 1 can mean findings OR a lint error; errors must fail loudly either way.
    out = String(e.stdout ?? "");
    if (!out.trim()) {
      console.error(`lint-budget: eslint failed to run in ${cwd}`);
      console.error(String(e.stderr ?? e.message ?? e));
      process.exit(2);
    }
  }
  const files = JSON.parse(out);
  const errors = files.reduce((n, f) => n + f.errorCount, 0);
  const warnings = files.reduce((n, f) => n + f.warningCount, 0);
  return { errors, warnings };
}

let failed = false;
for (const app of ["apps/api", "apps/web"]) {
  const { errors, warnings } = countWarnings(app);
  const key = app.replace("apps/", "");
  const allowed = budget[key] ?? 0;
  console.log(`lint-budget: ${key} errors=${errors} warnings=${warnings} (budget ${allowed})`);
  if (errors > 0) {
    console.error(`lint-budget: ${key} has ${errors} eslint ERRORS — fix them; the ratchet does not cover errors`);
    failed = true;
    continue;
  }
  if (warnings > allowed) {
    console.error(
      `lint-budget: ${key} grew to ${warnings} warnings (budget ${allowed}). Fix the warning, or raise the budget in ${BUDGET_FILE} and add the file to CONTRIBUTING's exceptions table with a reason — in the same PR.`
    );
    failed = true;
  }
}

if (process.argv.includes("--update")) {
  for (const app of ["apps/api", "apps/web"]) {
    const key = app.replace("apps/", "");
    budget[key] = countWarnings(app).warnings;
  }
  writeFileSync(BUDGET_FILE, JSON.stringify(budget, null, 2) + "\n");
  console.log("lint-budget: budgets updated", budget);
  process.exit(0);
}

process.exit(failed ? 1 : 0);
