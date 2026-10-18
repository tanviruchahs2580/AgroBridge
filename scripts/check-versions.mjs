#!/usr/bin/env node
/**
 * Version consistency check (K-08).
 *
 * `version.json` is the single source of truth for the user-facing app version
 * (web bundle + Android versionName; see the file itself and
 * docs/play/release-runbook.md). The three package manifests previously drifted
 * silently (1.0.0 vs 1.4.0). This script fails when they disagree with it, so a
 * release bump cannot half-land.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(p) {
  return JSON.parse(readFileSync(resolve(root, p), "utf8"));
}

const version = readJson("version.json");
if (typeof version.version !== "string" || !/^\d+\.\d+\.\d+$/.test(version.version)) {
  console.error(`✗ version.json: "version" must be semver-like, got ${JSON.stringify(version.version)}`);
  process.exit(1);
}
if (!Number.isInteger(version.versionCode) || version.versionCode <= 0) {
  console.error(`✗ version.json: "versionCode" must be a positive integer, got ${JSON.stringify(version.versionCode)}`);
  process.exit(1);
}

const mismatches = [];
for (const manifest of ["package.json", "apps/api/package.json", "apps/web/package.json"]) {
  const got = readJson(manifest).version;
  if (got !== version.version) mismatches.push(`${manifest}: ${got}`);
}

if (mismatches.length) {
  console.error(`✗ version drift — version.json is ${version.version}, but: ${mismatches.join(", ")}`);
  console.error("  Bump version.json and every package.json together (release runbook).");
  process.exit(1);
}

console.log(`✓ versions consistent: ${version.version} (versionCode ${version.versionCode}) across version.json and 3 package manifests`);
