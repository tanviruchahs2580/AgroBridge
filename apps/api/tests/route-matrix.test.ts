import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Route inventory freshness + deny-by-default guard (API-01 / ARC-11 / SEC-03).
 *
 * The committed docs/generated/route-matrix.json is regenerated from the module
 * route files on every run; drift fails. The generated PUBLIC set is asserted
 * against an explicit admission allowlist, so a new unauthenticated route cannot
 * appear silently (deny-by-default proof).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");
const MATRIX_JSON = path.join(apiRoot, "..", "..", "docs", "generated", "route-matrix.json");

const nodeBin = process.platform === "win32" ? "node.exe" : "node";

function regenerate(): { committedBefore: string; committedAfter: string; matrix: MatrixShape } {
  const committedBefore = readFileSync(MATRIX_JSON, "utf8");
  execFileSync(nodeBin, ["scripts/route-matrix.mjs"], { cwd: apiRoot, encoding: "utf8" });
  const committedAfter = readFileSync(MATRIX_JSON, "utf8");
  return { committedBefore, committedAfter, matrix: JSON.parse(committedAfter) };
}

type MatrixShape = { total: number; routes: Array<{ module: string; method: string; path: string; auth: string }> };

/**
 * Routes that are unauthenticated BY DESIGN, each with its justification.
 * A generated PUBLIC route not in this list fails the suite (deny-by-default).
 */
const PUBLIC_ALLOWLIST: Array<{ match: RegExp; because: string }> = [
  { match: /^auth POST \/login$/, because: "login is the credential exchange itself" },
  {
    match: /^auth POST \/refresh$/,
    because: "refresh needs no access token; it rotates and validates its own stored secret",
  },
  { match: /^auth POST \/register$/, because: "registration is the account-creation flow (rate-limited per address)" },
  {
    match: /^auth POST \/password\/forgot$/,
    because: "the OTP request path of password recovery — per-account/IP rate-limited and identically answered for unknown phones",
  },
  {
    match: /^auth POST \/password\/reset$/,
    because: "the OTP-consumption path of password recovery — capped attempts, short-lived OTP, revokes sessions on success",
  },
  {
    match: /^payments-webhook POST \/webhook\//,
    because: "gateway callbacks authenticate via provider signatures, not user tokens",
  },
  { match: /^payments GET \/plans$/, because: "public pricing page feeds the membership upsell UX" },
];

describe("route matrix (API-01 / ARC-11 / SEC-03)", () => {
  it("the committed inventory matches the source exactly (no drift)", () => {
    const { committedBefore, committedAfter } = regenerate();
    // The generator writes deterministically from source; equality before and
    // after regeneration proves the committed copy IS the source's output.
    expect(committedAfter, "route matrix drift — regenerate the committed inventory").toBe(committedBefore);
  });

  it("every generated PUBLIC route is in the admission allowlist (deny-by-default)", () => {
    const { matrix } = regenerate();
    const publicRoutes = matrix.routes.filter((r) => r.auth === "PUBLIC");
    const failures: string[] = [];
    for (const r of publicRoutes) {
      const key = `${r.module} ${r.method} ${r.path}`;
      const admission = PUBLIC_ALLOWLIST.find((a) => a.match.test(key));
      if (!admission) failures.push(`${key} — no allowlist entry`);
    }
    expect(failures, `unauthenticated routes outside the design allowlist:\n${failures.join("\n")}`).toEqual([]);
  });

  it("no PUBLIC route touches a money surface", () => {
    const { matrix } = regenerate();
    const money = matrix.routes.filter(
      (r) =>
        r.auth === "PUBLIC" &&
        /\/wallet|\/orders|\/checkout|\/payments(?!\/plans$|\/webhook)|\/procurement|\/withdrawals/i.test(
          `${r.method} ${r.path}`
        ),
    );
    expect(money, "money surfaces must never be PUBLIC").toEqual([]);
  });
});
