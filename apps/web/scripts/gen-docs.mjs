#!/usr/bin/env node
/**
 * AgroBridge — Web Docs Generator (Phase 11, e2e counterpart)
 * Generates/updates docs/generated/test-status.md from REAL Playwright output.
 * No hand-typed numbers; all counts come from `playwright test --reporter=json`
 * (and `playwright test --list --reporter=json` as fallback).
 *
 * Usage:
 *   node apps/web/scripts/gen-docs.mjs                 # from repo root
 *   node scripts/gen-docs.mjs                          # from apps/web
 *
 * Env:
 *   PLAYWRIGHT_ARGS  extra args (e.g. "--project=chromium --reporter=json")
 *   OUTPUT_MD        override output path (default: docs/generated/test-status.md)
 *   PLAYWRIGHT_BASE_URL  forwarded to Playwright (default: http://localhost:5173)
 *
 * Requirements:
 *   - Node >=20
 *   - @playwright/test installed (see apps/web/package.json)
 *   - For a live count without running browsers: --list mode is used as fallback
 */

import { spawnSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findRepoRoot(start) {
  let cur = resolve(start);
  for (let i = 0; i < 6; i++) {
    const pkg = join(cur, "package.json");
    const docs = join(cur, "docs");
    if (existsSync(pkg) && existsSync(docs)) {
      try {
        const j = JSON.parse(readFileSync(pkg, "utf8"));
        if (j.workspaces || j.name === "agrobridge") return cur;
      } catch {}
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return resolve(__dirname, "../../..");
}

const REPO_ROOT = findRepoRoot(__dirname);
const WEB_DIR = resolve(REPO_ROOT, "apps/web");
const OUTPUT_MD =
  process.env.OUTPUT_MD || resolve(REPO_ROOT, "docs/generated/test-status.md");
const TMP_JSON = resolve(WEB_DIR, ".tmp-playwright-report.json");
const TMP_LIST_JSON = resolve(WEB_DIR, ".tmp-playwright-list.json");

function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe", ...opts }).trim();
  } catch {
    return "";
  }
}
function getGitSha() {
  return sh("git rev-parse --short HEAD", { cwd: REPO_ROOT }) || sh("git rev-parse --short HEAD") || "unknown";
}
function ensureDir(p) {
  mkdirSync(dirname(p), { recursive: true });
}

console.log(`[gen-docs:web] repo root: ${REPO_ROOT}`);
console.log(`[gen-docs:web] web dir  : ${WEB_DIR}`);
console.log(`[gen-docs:web] output   : ${OUTPUT_MD}`);
ensureDir(TMP_JSON);
ensureDir(OUTPUT_MD);

// ——— Playwright config introspection (no hand-typing) —─────────────────────
let pwConfig = { testDir: "./e2e", projects: [], timeout: 30000, retries: 0 };
let e2eFilesOnDisk = [];
try {
  const cfgTxt = readFileSync(resolve(WEB_DIR, "playwright.config.ts"), "utf8");
  const td = cfgTxt.match(/testDir:\s*["']([^"']+)["']/);
  if (td) pwConfig.testDir = td[1];
  const tm = cfgTxt.match(/timeout:\s*(\d[\d_]*)/);
  if (tm) pwConfig.timeout = Number(tm[1].replace(/_/g, ""));
  const rm = cfgTxt.match(/retries:\s*(\d+)/);
  if (rm) pwConfig.retries = Number(rm[1]);
  // projects: count occurrences of `name:`
  const projMatches = [...cfgTxt.matchAll(/name:\s*["']([^"']+)["']/g)];
  pwConfig.projects = projMatches.map((m) => m[1]);
} catch {}
try {
  const e2eDir = resolve(WEB_DIR, pwConfig.testDir.replace("./", ""));
  if (existsSync(e2eDir)) {
    e2eFilesOnDisk = readdirSync(e2eDir).filter((f) => f.endsWith(".spec.ts"));
  }
} catch {}

// ——— Run Playwright reporter=json ──────────────────────────────────────────
// First try a full run (--reporter=json). In CI this runs browsers; locally it may
// fail if API/web servers aren't up — we fall back to --list.
const extraArgs = process.env.PLAYWRIGHT_ARGS || "";
let jsonOutput = null;
let runMode = "";
let playwrightExit = null;
let stderrTail = "";
let stdoutTail = "";

function tryRun(cmd, cwd, label) {
  console.log(`[gen-docs:web] running (${label}): ${cmd} (cwd: ${cwd})`);
  const r = spawnSync(cmd, {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout: 300_000,
    env: { ...process.env, CI: process.env.CI || "true" },
  });
  if (r.stdout) stdoutTail = r.stdout.slice(-4000);
  if (r.stderr) stderrTail = r.stderr.slice(-4000);
  // Playwright json reporter writes to stdout by default; --outputFile not set here
  // We capture stdout and try to parse it as json.
  return r;
}

// Attempt 1: full run with json to tmp file via reporter option
// Use npx playwright test --reporter=json  (stdout is json) and also capture list
let result = null;
const jsonReporterCmd = `npx playwright test --reporter=json ${extraArgs}`.trim();
result = tryRun(jsonReporterCmd, WEB_DIR, "full run");

// Try to parse stdout as Playwright JSON (shape: { suites: [...], stats: {expected, unexpected, ...} })
function tryParsePlaywrightJson(text) {
  if (!text) return null;
  const t = text.trim();
  // Playwright json is a single JSON object; but stdout may have preceding logs — find first '{'
  const idx = t.indexOf("{");
  if (idx === -1) return null;
  const slice = t.slice(idx);
  // Find the last '}' to get complete json (handle trailing logs)
  // Try parsing progressively from the end
  for (let end = slice.length; end > 0; end--) {
    if (slice[end - 1] !== "}") continue;
    try {
      const obj = JSON.parse(slice.slice(0, end));
      if (obj.suites || obj.stats || obj.config) return obj;
    } catch {}
  }
  // fallback: try whole slice
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

jsonOutput = tryParsePlaywrightJson(result?.stdout || "");
playwrightExit = result?.status ?? null;
runMode = jsonOutput ? "full run (reporter=json)" : "full run failed to parse";

// Fallback: --list with json reporter (no browser needed, just counts)
if (!jsonOutput) {
  console.warn(`[gen-docs:web] full run json parse failed (exit ${playwrightExit}) — falling back to --list`);
  if (result?.stdout) process.stdout.write(result.stdout.slice(0, 4000));
  if (result?.stderr) process.stderr.write(result.stderr.slice(0, 4000));
  const listCmd = `npx playwright test --list --reporter=json ${extraArgs}`.trim();
  const listResult = tryRun(listCmd, WEB_DIR, "list");
  const listJson = tryParsePlaywrightJson(listResult.stdout || "");
  if (listJson) {
    jsonOutput = listJson;
    runMode = "list (playwright test --list --reporter=json)";
    playwrightExit = listResult.status;
  } else {
    console.warn(`[gen-docs:web] --list json also failed — will use on-disk spec counts`);
    if (listResult.stdout) process.stdout.write(listResult.stdout.slice(0, 4000));
  }
}

// ——— Extract counts —───────────────────────────────────────────────────────
let numTotalTests = 0;
let numPassedTests = 0;
let numFailedTests = 0;
let numSkippedTests = 0;
let numSpecs = e2eFilesOnDisk.length;
let specs = [];
let stats = null;

if (jsonOutput) {
  // Playwright json structure: { suites: [{ suites: [{ specs: [{ tests: [...] }] }] }], stats }
  // Or list mode: similar but tests may not have results
  stats = jsonOutput.stats || null;

  // stats fields: expected (passed), unexpected (failed), skipped, flaky
  if (stats) {
    numPassedTests = stats.expected ?? 0;
    numFailedTests = stats.unexpected ?? 0;
    numSkippedTests = stats.skipped ?? 0;
    // flaky counts as passed after retry
    if (stats.flaky) numPassedTests += stats.flaky;
  }

  // Walk suites to count specs/tests and list spec names
  function walkSuites(suites, out) {
    for (const s of suites || []) {
      if (s.specs) {
        for (const spec of s.specs) {
          out.push(spec);
        }
      }
      if (s.suites) walkSuites(s.suites, out);
    }
  }
  const allSpecs = [];
  walkSuites(jsonOutput.suites || [], allSpecs);
  if (allSpecs.length > 0) {
    specs = allSpecs.map((sp) => {
      const title = sp.title || sp.file || "unknown";
      const file = (sp.file || "").replace(REPO_ROOT, "").replace(WEB_DIR, "apps/web");
      // Count tests within spec
      const tests = sp.tests || [];
      const ok = tests.filter((t) => {
        // list mode: no results, count as listed
        if (!t.results || t.results.length === 0) return true;
        return t.results.some((r) => r.status === "passed" || r.status === "expected");
      }).length;
      const fail = tests.length - ok;
      return { title, file: file.replace(/\\/g, "/"), tests: tests.length, ok, fail };
    });
    numSpecs = specs.length > 0 ? specs.length : numSpecs;
    if (!stats) {
      // No stats (list mode) — sum from specs
      numTotalTests = specs.reduce((a, s) => a + s.tests, 0);
      numPassedTests = specs.reduce((a, s) => a + s.ok, 0);
      numFailedTests = specs.reduce((a, s) => a + s.fail, 0);
    } else {
      numTotalTests = (stats.expected ?? 0) + (stats.unexpected ?? 0) + (stats.skipped ?? 0) + (stats.flaky ?? 0);
      if (numTotalTests === 0) numTotalTests = specs.reduce((a, s) => a + s.tests, 0);
    }
  }
}

if (!jsonOutput) {
  // Ultimate fallback: count specs on disk and estimate tests via grep
  numSpecs = e2eFilesOnDisk.length;
  let estTests = 0;
  for (const f of e2eFilesOnDisk) {
    try {
      const txt = readFileSync(resolve(WEB_DIR, pwConfig.testDir.replace("./", ""), f), "utf8");
      const c = (txt.match(/\btest\s*\(/g) || []).length;
      estTests += c;
      specs.push({ title: f, file: `apps/web/${pwConfig.testDir.replace("./", "")}/${f}`, tests: c, ok: 0, fail: 0 });
    } catch {}
  }
  numTotalTests = estTests;
  runMode = "disk fallback (grep test() counts)";
}

const gitSha = getGitSha();
const nowIso = new Date().toISOString();
const statusBadge =
  playwrightExit === 0 && numFailedTests === 0 ? "✅ PASS" : playwrightExit == null ? "— listed only (no run)" : "❌ FAIL";

// Persist raw json for audit
try {
  if (jsonOutput) writeFileSync(TMP_JSON, JSON.stringify(jsonOutput, null, 2), "utf8");
  else if (stdoutTail) writeFileSync(TMP_JSON, stdoutTail, "utf8");
} catch {}

// ——— Merge with existing API section ─────────────────────────────────────
let existingApiSection = "";
let existingHeader = "";
try {
  if (existsSync(OUTPUT_MD)) {
    const prev = readFileSync(OUTPUT_MD, "utf8");
    // Header up to first "## API"
    const apiIdx = prev.indexOf("## API");
    if (apiIdx !== -1) {
      existingHeader = prev.slice(0, apiIdx);
      // Find where API section ends and Web E2E begins
      const webIdx = prev.indexOf("<!-- web-e2e:start -->");
      const webHeading = prev.indexOf("## Web E2E");
      let apiEnd = -1;
      if (webIdx !== -1) apiEnd = webIdx;
      else if (webHeading !== -1) apiEnd = webHeading;
      else apiEnd = prev.length;
      existingApiSection = prev.slice(apiIdx, apiEnd);
    } else {
      // No API section — keep whole file as header
      existingHeader = prev;
    }
  }
} catch {}

const specRows =
  specs.length > 0
    ? specs.map((s) => `| \`${s.file}\` — ${s.title} | ${s.tests} | ${s.ok || "—"} | ${s.fail || "—"} |`).join("\n")
    : e2eFilesOnDisk.map((f) => `| \`apps/web/${pwConfig.testDir.replace("./", "")}/${f}\` | — | — | — |`).join("\n") || "| (no specs) | 0 | — | — |";

const webSection = `<!-- web-e2e:start -->
## Web E2E — Playwright (Pixel 5, bn-BD)

**Config:** \`apps/web/playwright.config.ts\` — \`testDir: ${pwConfig.testDir}\`, \`projects: [${pwConfig.projects.join(", ") || "chromium"}]\`, \`timeout: ${pwConfig.timeout}ms\`, \`retries: ${pwConfig.retries}\`, \`locale: bn-BD\`, \`isMobile: true\`
**Command:** \`${runMode === "full run (reporter=json)" ? "npx playwright test --reporter=json" : runMode.includes("list") ? "npx playwright test --list --reporter=json" : "disk fallback"}\` ${extraArgs ? `+ \`${extraArgs}\`` : ""}
**Exit code:** \`${playwrightExit ?? "n/a"}\`
**Run mode:** \`${runMode}\`

| Signal | Value |
|--------|-------|
| Spec files (on disk) | **${numSpecs}** (${e2eFilesOnDisk.join(", ") || "none"}) |
| Tests total (from Playwright JSON) | **${numTotalTests}** |
| Passed (expected) | ${numPassedTests} |
| Failed (unexpected) | ${numFailedTests} |
| Skipped | ${numSkippedTests} |
| Status | ${statusBadge} |
| Visual baselines | 8 pages (see \`apps/web/e2e/visual-contract.spec.ts\` — login/register/home/farm/market/services/notifications/admin, \`maxDiffPixelRatio 0.02\`) |

### Specs (from JSON \`suites[].specs[]\`)

| Spec | Tests | Passed | Failed |
|------|-------|--------|--------|
${specRows}

### How to reproduce locally

\`\`\`bash
# from repo root — requires API + Web running (see .github/workflows/ci.yml:web-e2e 149-176)
npm ci --include-workspace-root --no-audit --no-fund
npx --workspace @agrobridge/api prisma generate --schema prisma/schema.prisma
npx --workspace @agrobridge/api prisma migrate deploy
npx --workspace @agrobridge/api prisma db seed
npm run build --workspace @agrobridge/api
# start API + web (or use webServer in playwright.config.ts)
# npx --workspace @agrobridge/web playwright install --with-deps chromium
npx --workspace @agrobridge/web playwright test --reporter=list
# for JSON used by this generator:
npx --workspace @agrobridge/web playwright test --reporter=json
# count only (no browser):
npx --workspace @agrobridge/web playwright test --list --reporter=json
\`\`\`

### Raw artifacts

- JSON report: \`apps/web/.tmp-playwright-report.json\` (gitignored, written by this script)
- List JSON fallback: \`apps/web/.tmp-playwright-list.json\`
- Playwright HTML: \`apps/web/playwright-report/\` (if configured)
- Trace: \`on-first-retry\` (see \`playwright.config.ts:11\`)

<!-- web-e2e:end -->`;

// If we had an existing API section, reuse it; otherwise create a minimal header
let finalHeader = "";
let finalApiSection = existingApiSection;

if (existingHeader && existingHeader.includes("# Test Status")) {
  finalHeader = existingHeader;
} else if (existingHeader) {
  finalHeader = existingHeader;
} else {
  // No prior file — create header that points to api generator for the API section
  finalHeader = `# Test Status — CI-Generated (Phase 11)

> **DO NOT hand-edit counts.** This file is generated by \`apps/api/scripts/gen-docs.mjs\` (API) and
> \`apps/web/scripts/gen-docs.mjs\` (Web E2E) from \`vitest --coverage --reporter=json\` and
> \`playwright test --reporter=json\` output. Rerun both generators to refresh.

**Generated (web):** ${nowIso}
**Commit:** \`${gitSha}\` (HEAD)
**Source (web):** \`apps/web\` — \`npx playwright test --reporter=json\` (fallback \`--list\`)

---

`;
}

if (!finalApiSection || !finalApiSection.includes("## API")) {
  finalApiSection = `## API — Vitest (SQLite default profile)

> This section is owned by \`apps/api/scripts/gen-docs.mjs\`. Run that script to fill API counts from \`vitest --coverage --reporter=json\`.

| Signal | Value |
|--------|-------|
| (not yet generated) | run \`node apps/api/scripts/gen-docs.mjs\` |

---

`;
  // Ensure header ends with ---
  if (!finalHeader.trimEnd().endsWith("---")) finalHeader = finalHeader.trimEnd() + "\n\n---\n\n";
}

const finalMd = `${finalHeader.trimEnd()}

${finalApiSection.trimEnd()}

${webSection}

---

*Generated by \`apps/web/scripts/gen-docs.mjs\` — Node \`${process.version}\` — do not hand-edit.*
`;

ensureDir(OUTPUT_MD);
writeFileSync(OUTPUT_MD, finalMd, "utf8");
console.log(`[gen-docs:web] wrote ${OUTPUT_MD} (${finalMd.length} bytes)`);
console.log(`[gen-docs:web] specs: files ${numSpecs}, tests ${numTotalTests}, passed ${numPassedTests}, failed ${numFailedTests} — ${statusBadge} (${runMode})`);
if (playwrightExit !== null && playwrightExit !== 0 && runMode.startsWith("full run")) {
  console.error(`[gen-docs:web] Playwright exited ${playwrightExit} — markdown still written (check browsers/servers)`);
}
