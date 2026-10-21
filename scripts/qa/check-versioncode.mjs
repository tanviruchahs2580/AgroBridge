#!/usr/bin/env node
/**
 * versionCode preflight for the release workflows (android-release.yml,
 * play-upload.yml). `version.json` is the single source for the Android
 * versionName/versionCode, and Play rejects an upload whose versionCode has
 * already been used.
 *
 * The repo policy is a monotonic integer that is bumped by hand next to the
 * version string (docs/play/release-runbook.md: v1.4.0 ships 14000, the next
 * release bumps to 14001), so this script does NOT derive the code from the
 * SemVer triple — a formula (for example 10400 for 1.4.0) would reject the
 * documented process and the value already shipped. It checks the two things
 * that actually go wrong:
 *
 *   1. `versionCode` is a positive integer and the version parses as SemVer;
 *   2. `versionCode` is strictly greater than the one in the newest `v*`
 *      release tag's `version.json` — the exact rule the Play Console
 *      enforces. When the checkout carries no release tags (shallow clone),
 *      the comparison is skipped with a loud note rather than guessed.
 *
 * Exits non-zero on any failure and echoes the numbers it compared.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
})();

const failures = [];

// --- 1. version.json itself -------------------------------------------------
const versionFile = join(root, "version.json");
if (!existsSync(versionFile)) {
  console.error("versionCode check failed: version.json not found at " + versionFile);
  process.exit(1);
}
const current = JSON.parse(readFileSync(versionFile, "utf8"));
const version = String(current.version ?? "");
const versionCode = current.versionCode;

if (!/^\d+\.\d+\.\d+/.test(version)) {
  failures.push(`version.json: version "${version}" is not a SemVer string`);
}

if (!Number.isInteger(versionCode) || versionCode <= 0) {
  failures.push(`version.json: versionCode ${JSON.stringify(versionCode)} is not a positive integer`);
}

// --- 2. monotonic against the newest release tag ----------------------------
function latestTaggedVersionCode() {
  let tags;
  try {
    tags = execFileSync("git", ["tag", "--list", "v*", "--sort=-v:refname"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
  } catch {
    return { tag: null, code: null, reason: "git is not available" };
  }
  if (tags.length === 0) {
    return { tag: null, code: null, reason: "no v* tags in this checkout (shallow clone?)" };
  }
  for (const tag of tags) {
    try {
      const raw = execFileSync("git", ["show", `${tag}:version.json`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const parsed = JSON.parse(raw);
      if (Number.isInteger(parsed.versionCode)) return { tag, code: parsed.versionCode };
    } catch {
      // tag predates version.json — try the next one
    }
  }
  return { tag: null, code: null, reason: "no release tag carries a version.json yet" };
}

const latest = latestTaggedVersionCode();
console.log(`version.json : version ${version} (versionCode ${versionCode})`);
if (latest.tag) {
  console.log(`newest tag   : ${latest.tag} (versionCode ${latest.code})`);
  if (Number.isInteger(versionCode) && versionCode <= latest.code) {
    failures.push(
      `versionCode ${versionCode} is not greater than ${latest.tag}'s ${latest.code} — ` +
        "Play rejects a reused code; bump version.json before running this release",
    );
  } else {
    console.log(`monotonic    : versionCode ${versionCode} > ${latest.code} (delta ${versionCode - latest.code})`);
  }
} else {
  console.log(`monotonic    : not compared — ${latest.reason}`);
}

if (failures.length) {
  console.error("versionCode check failed:\n" + failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
console.log("versionCode check clean");
