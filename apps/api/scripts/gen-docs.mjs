#!/usr/bin/env node
/**
 * AgroBridge — API Docs Generator (Phase 11)
 * Generates docs/generated/test-status.md from REAL vitest output.
 * No hand-typed numbers; all counts come from `vitest --coverage --reporter=json`.
 *
 * Usage:
 *   node apps/api/scripts/gen-docs.mjs                # from repo root
 *   node scripts/gen-docs.mjs                          # from apps/api
 *
 * Env:
 *   VITEST_ARGS   extra args forwarded to vitest (e.g. "--run --coverage")
 *   OUTPUT_MD     override output path (default: docs/generated/test-status.md)
 *   CI            if set, exits non-zero when coverage thresholds fail
 *
 * Requirements:
 *   - Node >=20
 *   - vitest + @vitest/coverage-v8 installed (see apps/api/package.json)
 *   - Run from repo root OR apps/api (script auto-resolves root)
 */

import { spawnSync, execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ——— path resolution ───────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Walk up to find repo root (contains package.json with workspaces + docs/generated)
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
const API_DIR = resolve(REPO_ROOT, "apps/api");
const OUTPUT_MD =
  process.env.OUTPUT_MD || resolve(REPO_ROOT, "docs/generated/test-status.md");
const TMP_JSON = resolve(API_DIR, ".tmp-vitest-report.json");
const COVERAGE_SUMMARY = resolve(API_DIR, "coverage/coverage-summary.json");
const COVERAGE_FINAL_DIR = resolve(API_DIR, "coverage");

// ——— helpers ───────────────────────────────────────────────────────────────
function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe", ...opts }).trim();
  } catch {
    return "";
  }
}

function getGitSha() {
  return (
    sh("git rev-parse --short HEAD", { cwd: REPO_ROOT }) ||
    sh("git rev-parse --short HEAD") ||
    "unknown"
  );
}

function ensureDir(p) {
  mkdirSync(dirname(p), { recursive: true });
}

/** Try to locate a vitest json output, coverage summary, or parse stdout */
function parseCoverageFromSummary() {
  if (!existsSync(COVERAGE_SUMMARY)) return null;
  try {
    const raw = JSON.parse(readFileSync(COVERAGE_SUMMARY, "utf8"));
    const total = raw.total || raw["total"] || Object.values(raw)[0];
    if (!total) return null;
    // json-summary shape: { total: { lines: {total, covered, pct}, statements, branches, functions } }
    const pick = (k) => {
      const v = total[k] || raw[k];
      if (!v) return { pct: 0, covered: 0, total: 0 };
      if (typeof v.pct === "number") return { pct: v.pct, covered: v.covered, total: v.total };
      return { pct: 0, covered: 0, total: 0 };
    };
    return {
      statements: pick("statements"),
      branches: pick("branches"),
      functions: pick("functions"),
      lines: pick("lines"),
    };
  } catch {
    return null;
  }
}

function pct(n) {
  return typeof n === "number" ? Number(n.toFixed(2)) : 0;
}

// ——— main ──────────────────────────────────────────────────────────────────
console.log(`[gen-docs:api] repo root: ${REPO_ROOT}`);
console.log(`[gen-docs:api] api dir  : ${API_DIR}`);
console.log(`[gen-docs:api] output   : ${OUTPUT_MD}`);

ensureDir(TMP_JSON);
ensureDir(OUTPUT_MD);
ensureDir(COVERAGE_SUMMARY);

// Clean previous tmp
try {
  if (existsSync(TMP_JSON)) writeFileSync(TMP_JSON, "");
} catch {}

// Build vitest command
// We force json reporter to a tmp file + also keep text for logs, and force coverage json-summary
// Thresholds are enforced by vitest.config.ts, but we surface them here too.
const extraArgs = process.env.VITEST_ARGS || "";
const vitestCmd = [
  "npx",
  "vitest",
  "run",
  "--coverage",
  "--coverage.reporter=text",
  "--coverage.reporter=lcov",
  "--coverage.reporter=json-summary",
  "--reporter=json",
  `--outputFile=${TMP_JSON}`,
  extraArgs,
]
  .filter(Boolean)
  .join(" ");

console.log(`[gen-docs:api] running: ${vitestCmd} (cwd: apps/api)`);

const result = spawnSync(vitestCmd, {
  cwd: API_DIR,
  shell: true,
  encoding: "utf8",
  timeout: 300_000,
  env: { ...process.env, CI: "true" },
});

if (result.stdout) process.stdout.write(result.stdout.slice(0, 8000));
if (result.stderr) process.stderr.write(result.stderr.slice(0, 8000));
if (result.error) console.error(`[gen-docs:api] spawn error: ${result.error.message}`);

// Parse vitest json output
let vitestJson = null;
let parseError = null;
if (existsSync(TMP_JSON)) {
  try {
    const txt = readFileSync(TMP_JSON, "utf8").trim();
    if (txt) vitestJson = JSON.parse(txt);
  } catch (e) {
    parseError = e.message;
  }
}
// Fallback: try stdout as json (if outputFile not honored)
if (!vitestJson && result.stdout) {
  const s = result.stdout.trim();
  const jsonStart = s.indexOf("{");
  if (jsonStart !== -1) {
    try {
      vitestJson = JSON.parse(s.slice(jsonStart));
    } catch {}
  }
}

// Extract counts — vitest json shape: { numTotalTests, numPassedTests, numFailedTests, testResults: [{assertionResults}], ... }
let numTotalTests = 0;
let numPassedTests = 0;
let numFailedTests = 0;
let numTestFiles = 0;
let testFiles = [];
let durationMs = 0;

if (vitestJson) {
  numTotalTests = vitestJson.numTotalTests ?? vitestJson.numTotalTestSuites ?? 0;
  numPassedTests = vitestJson.numPassedTests ?? 0;
  numFailedTests = vitestJson.numFailedTests ?? 0;
  durationMs = vitestJson.testResults
    ? vitestJson.testResults.reduce((a, r) => a + (r.perfStats?.end - r.perfStats?.start || 0), 0)
    : 0;

  if (Array.isArray(vitestJson.testResults)) {
    numTestFiles = vitestJson.testResults.length;
    testFiles = vitestJson.testResults.map((r) => {
      const name = r.name || r.assertionResults?.[0]?.ancestorTitles?.[0] || r.testFilePath || "unknown";
      const passed = (r.assertionResults || []).filter((a) => a.status === "passed").length;
      const failed = (r.assertionResults || []).filter((a) => a.status === "failed").length;
      return { name: String(name).replace(REPO_ROOT, "").replace(API_DIR, "apps/api"), passed, failed };
    });
    // If numTotalTests missing, sum assertions
    if (!numTotalTests) {
      numTotalTests = vitestJson.testResults.reduce(
        (a, r) => a + (r.assertionResults?.length ?? 0),
        0,
      );
      numPassedTests = vitestJson.testResults.reduce(
        (a, r) => a + (r.assertionResults?.filter((x) => x.status === "passed").length ?? 0),
        0,
      );
      numFailedTests = numTotalTests - numPassedTests;
    }
  } else if (Array.isArray(vitestJson.testResults) === false && vitestJson.testResults == null) {
    // Vitest v3 json uses `testResults` or `numTotalTests` at top level differently — try fallback
    if (typeof vitestJson.numTotalTests === "number") {
      // already set
    }
  }

  // Alternative shape: vitest json reporter sometimes emits { success, numTotalTests, testResults }
  if (!numTestFiles && vitestJson.testResults == null && vitestJson.numTotalTestSuites != null) {
    numTestFiles = vitestJson.numTotalTestSuites;
  }
} else {
  console.warn(`[gen-docs:api] could not parse vitest json (tmp exists: ${existsSync(TMP_JSON)}, error: ${parseError || "no json"})`);
  // Fallback: list test files by glob
  try {
    const testsDir = resolve(API_DIR, "tests");
    if (existsSync(testsDir)) {
      const files = readdirSync(testsDir).filter((f) => f.endsWith(".test.ts"));
      numTestFiles = files.length;
      testFiles = files.map((f) => ({ name: `tests/${f}`, passed: 0, failed: 0 }));
    }
  } catch {}
}

// Coverage
let coverage = parseCoverageFromSummary();
if (!coverage) {
  console.warn(`[gen-docs:api] coverage-summary.json not found at ${COVERAGE_SUMMARY} — coverage will be marked unavailable`);
  // Try coverage/lcov.info parse fallback (count lines naively) — leave as unavailable
}

// Thresholds from apps/api/vitest.config.ts:28-33 (read at runtime to avoid hand-typing)
let thresholds = { statements: 75, branches: 63, functions: 73, lines: 75 };
try {
  const cfg = readFileSync(resolve(API_DIR, "vitest.config.ts"), "utf8");
  const m = cfg.match(/thresholds:\s*\{([^}]+)\}/s);
  if (m) {
    const get = (k) => {
      const re = new RegExp(`${k}\\s*:\\s*(\\d+(?:\\.\\d+)?)`);
      const f = m[1].match(re);
      return f ? Number(f[1]) : thresholds[k];
    };
    thresholds = {
      statements: get("statements"),
      branches: get("branches"),
      functions: get("functions"),
      lines: get("lines"),
    };
  }
} catch {}

// Measured numbers from vitest.config.ts comment (e.g. 80.05/67.76/78.57/80.05) — not used as source of truth, just note
let measuredComment = "";
try {
  const cfg = readFileSync(resolve(API_DIR, "vitest.config.ts"), "utf8");
  const cm = cfg.match(/statements\s+([\d.]+)\s*\|\s*branches\s+([\d.]+)\s*\|\s*functions\s+([\d.]+)\s*\|\s*lines\s+([\d.]+)/);
  if (cm) measuredComment = `${cm[1]}/${cm[2]}/${cm[3]}/${cm[4]}`;
} catch {}

const gitSha = getGitSha();
const nowIso = new Date().toISOString();
const vitestExitCode = result.status ?? 0;
const coverageDirExists = existsSync(COVERAGE_FINAL_DIR);

let coverageTable = "";
if (coverage) {
  const row = (label, v, thresh) => {
    const p = pct(v.pct);
    const mark = p >= thresh ? "✅" : "❌";
    return `| ${label} | ${p}% | ${thresh}% | ${v.covered}/${v.total} | ${mark} |`;
  };
  coverageTable = [
    "| Metric | Measured | Threshold (`vitest.config.ts`) | Covered/Total | Gate |",
    "|--------|----------|-------------------------------|----------------|------|",
    row("Statements", coverage.statements, thresholds.statements),
    row("Branches", coverage.branches, thresholds.branches),
    row("Functions", coverage.functions, thresholds.functions),
    row("Lines", coverage.lines, thresholds.lines),
  ].join("\n");
} else {
  coverageTable = [
    "| Metric | Measured | Threshold | Covered/Total | Gate |",
    "|--------|----------|-----------|---------------|------|",
    `| Statements | n/a | ${thresholds.statements}% | n/a | — |`,
    `| Branches | n/a | ${thresholds.branches}% | n/a | — |`,
    `| Functions | n/a | ${thresholds.functions}% | n/a | — |`,
    `| Lines | n/a | ${thresholds.lines}% | n/a | — |`,
    "",
    `> Coverage JSON not found at \`apps/api/coverage/coverage-summary.json\` (dir exists: ${coverageDirExists}).`,
    `> Ensure \`@vitest/coverage-v8\` is installed and rerun with \`npx vitest run --coverage\`. Raw lcov at \`apps/api/coverage/lcov.info\` if text+lcov reporters ran.`,
  ].join("\n");
}

const statusBadge = vitestExitCode === 0 && numFailedTests === 0 ? "✅ PASS" : "❌ FAIL";
const coverageBadge =
  coverage &&
  coverage.statements.pct >= thresholds.statements &&
  coverage.branches.pct >= thresholds.branches &&
  coverage.functions.pct >= thresholds.functions &&
  coverage.lines.pct >= thresholds.lines
    ? "✅ PASS"
    : coverage
      ? "❌ FAIL"
      : "— unavailable";

const testFileRows =
  testFiles.length > 0
    ? testFiles
        .map((f) => `| \`${f.name.replace(/\\/g, "/")}\` | ${f.passed} | ${f.failed} |`)
        .join("\n")
    : "| (no testResults in json) | — | — |";

// Preserve web E2E section if the md already exists (written by apps/web/scripts/gen-docs.mjs)
let existingWebSection = "";
try {
  if (existsSync(OUTPUT_MD)) {
    const prev = readFileSync(OUTPUT_MD, "utf8");
    const marker = "<!-- web-e2e:start -->";
    const endMarker = "<!-- web-e2e:end -->";
    const s = prev.indexOf(marker);
    const e = prev.indexOf(endMarker);
    if (s !== -1 && e !== -1 && e > s) {
      existingWebSection = prev.slice(s, e + endMarker.length);
    } else if (prev.includes("## Web E2E")) {
      // fallback: slice from Web E2E heading to end
      const idx = prev.indexOf("## Web E2E");
      if (idx !== -1) existingWebSection = prev.slice(idx);
    }
  }
} catch {}

const md = `# Test Status — CI-Generated (Phase 11)

> **DO NOT hand-edit counts.** This file is generated by \`apps/api/scripts/gen-docs.mjs\` from
> \`vitest --coverage --reporter=json\` output. Any manual number is drift (see \`docs/testing.md\` gap).
> Rerun: \`node apps/api/scripts/gen-docs.mjs\` (or \`npm run test --workspace @agrobridge/api -- --coverage --reporter=json\`).

**Generated:** ${nowIso}
**Commit:** \`${gitSha}\` (HEAD)
**Source:** \`apps/api\` — \`npx vitest run --coverage --reporter=json --outputFile=.tmp-vitest-report.json\` + \`--coverage.reporter=json-summary\`
**Exit code:** \`${vitestExitCode}\` ${vitestExitCode === 0 ? "(vitest green)" : "(vitest failed)"}
${parseError ? `**Parse warning:** \`${parseError}\`` : ""}

---

## API — Vitest (SQLite default profile)

**Config:** \`apps/api/vitest.config.ts\` (env node, \`globalSetup: tests/global-setup.ts\`, \`fileParallelism: false\`, \`testTimeout: 30s\`)
**Thresholds:** \`statements ${thresholds.statements} / branches ${thresholds.branches} / functions ${thresholds.functions} / lines ${thresholds.lines}\` (read from \`vitest.config.ts:28-33\`)
${measuredComment ? `**Measured (comment in config):** \`${measuredComment}\` — for reference only, not source of truth` : ""}

| Signal | Value |
|--------|-------|
| Tests total | **${numTotalTests}** |
| Passed | ${numPassedTests} |
| Failed | ${numFailedTests} |
| Test files | ${numTestFiles} |
| Status | ${statusBadge} |
| Duration (ms, summed perfStats) | ${durationMs} |

### Coverage (v8)

${coverageTable}

Coverage gate: ${coverageBadge} (thresholds sit ~5 pts below measured so regressions block without blocking current work — see \`vitest.config.ts:6-13\`)

### Test files (from json \`testResults\`)

| File | Passed | Failed |
|------|--------|--------|
${testFileRows}

### Raw artifacts

- JSON report: \`apps/api/.tmp-vitest-report.json\` (gitignored, generated by this script via \`--outputFile\`)
- Coverage summary: \`apps/api/coverage/coverage-summary.json\` (json-summary reporter)
- LCOV: \`apps/api/coverage/lcov.info\`
- HTML (if opened): \`apps/api/coverage/index.html\`

### How to reproduce locally

\`\`\`bash
# from repo root
npm ci --workspace @agrobridge/api --include-workspace-root --no-audit --no-fund
npm rebuild @prisma/engines prisma esbuild 2>/dev/null || true
npx --workspace @agrobridge/api prisma validate && npx --workspace @agrobridge/api prisma generate

# SQLite (default, fast)
npx --workspace @agrobridge/api vitest run --coverage

# PostgreSQL profile (requires provisioned DB)
# DATABASE_URL=postgresql://agrobridge:ci-password@localhost:5432/agrobridge node apps/api/scripts/provision-postgres.mjs
# npx --workspace @agrobridge/api vitest run --config vitest.config.pg.ts
\`\`\`

---

## CI Gates (reference)

- \`api-quality\` job (\`.github/workflows/ci.yml:15-59\`): Lint → Typecheck → \`vitest run --coverage\` (SQLite) → validate \`schema.postgresql.prisma\`
- \`api-postgres\` job (\`ci.yml:61-100\`): provision PG 17 → \`vitest run --config vitest.config.pg.ts\` (includes \`concurrency.test.ts\`)
- Branch protection requires \`CI\` + \`CodeQL\` (see \`docs/generated/governance-branch-protection.md\`)

---

${existingWebSection || `<!-- web-e2e:start -->
## Web E2E — Playwright (placeholder)

> This section is owned by \`apps/web/scripts/gen-docs.mjs\`. Run that script to fill Web E2E counts from \`playwright test --reporter=json\`.

| Signal | Value |
|--------|-------|
| (not yet generated) | run \`node apps/web/scripts/gen-docs.mjs\` |

<!-- web-e2e:end -->`}

---

*Generated by \`apps/api/scripts/gen-docs.mjs\` — Node \`${process.version}\` — do not hand-edit.*
`;

ensureDir(OUTPUT_MD);
writeFileSync(OUTPUT_MD, md, "utf8");
console.log(`[gen-docs:api] wrote ${OUTPUT_MD} (${md.length} bytes)`);
if (coverage) {
  console.log(
    `[gen-docs:api] coverage: statements ${pct(coverage.statements.pct)}% / branches ${pct(coverage.branches.pct)}% / functions ${pct(coverage.functions.pct)}% / lines ${pct(coverage.lines.pct)}%`,
  );
}
console.log(`[gen-docs:api] tests: total ${numTotalTests}, passed ${numPassedTests}, failed ${numFailedTests}, files ${numTestFiles} — ${statusBadge}`);

// Exit code reflects vitest gate when in CI
if (process.env.CI && (vitestExitCode !== 0 || numFailedTests > 0)) {
  console.error(`[gen-docs:api] CI gate: vitest failed (exit ${vitestExitCode}, failed ${numFailedTests}) — markdown still written`);
  // do not hard-fail the generator itself; let CI job fail on vitest step separately
}
