import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSIONS, INTENTIONALLY_UNUSED } from "../src/middleware/rbac.js";

/**
 * F-08: the permission inventory must not under-report the model.
 *
 * The audit found 13 of the 26 declared permissions enforced by no route, and
 * six modules authorising through inline role lists the route-role matrix
 * cannot see — so "declared but unreachable", and "authorised by a mechanism
 * the generator cannot render", were both quiet states. `AGENTS.md` §5 makes
 * `requirePermission` the only gate mechanism; this suite makes every
 * permission's status explicit:
 *
 *   - it is used in a handler (`hasPermission(...)`) — the handler decides what
 *     the caller sees, so the permission is live; or
 *   - a route gates on it (`requirePermission("…")`); or
 *   - it appears in `INTENTIONALLY_UNUSED` with a reason and an owner decision.
 *
 * Anything else fails. The scan is source-parsing (not runtime) for the same
 * reason the matrix generator is: the inventory must describe what the shipped
 * source does.
 */
const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(apiRoot, "src");
/** The table and its allowlist live here; scanning them would match their own declarations. */
const RBAC_FILE = join(SRC, "middleware", "rbac.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const files = walk(SRC).filter((f) => f !== RBAC_FILE);
const sourceByFile = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

/**
 * Every permission string the source names, in either check form
 * (`requirePermission("…")` / `hasPermission(role, "…")`).
 *
 * The first-argument pattern is deliberately narrow — an identifier, `getAuth(req).role`,
 * or an inline string — because the handler form is called with a ROLE as its
 * first argument, and a greedy `.*` would capture the role identifier as if it
 * were a permission string.
 */
function permissionUsages(): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  const RE = /\b(?:requirePermission|hasPermission)\(\s*(?:(?:[A-Za-z_$][\w$.]*|getAuth\(req\)\.role|"[^"]*")\s*,\s*)?"([a-z][a-z:_]+)"/g;
  for (const [file, src] of sourceByFile) {
    const rel = file.slice(apiRoot.length).replace(/\\/g, "/");
    for (const m of src.matchAll(RE)) {
      const permission = m[1]!;
      usage.set(permission, [...(usage.get(permission) ?? []), rel]);
    }
  }
  return usage;
}

/** Role → declared permission list, straight from the exported table. */
const declaredPermissions = [...new Set(Object.values(PERMISSIONS).flat().filter((p) => p !== "*"))].sort();

describe("permission reachability (F-08)", () => {
  const usage = permissionUsages();

  it("the scan is not vacuous — it finds the real checks", () => {
    expect(usage.size).toBeGreaterThan(10);
    // A representative sample from both check forms and several modules.
    for (const permission of ["products:manage", "audit:read", "finance:withdrawals", "orders:read:any", "bookings:assign"]) {
      expect(usage.has(permission), `${permission} should be found in the source scan`).toBe(true);
    }
  });

  it("every declared permission is used by the code or recorded as intentionally unused", () => {
    const problems: string[] = [];
    for (const permission of declaredPermissions) {
      const usedAt = usage.get(permission);
      const allowlisted = INTENTIONALLY_UNUSED[permission];
      if (usedAt && usedAt.length > 0) continue; // reachable
      if (allowlisted && allowlisted.trim().length > 0) continue; // recorded decision
      problems.push(`${permission} is declared in rbac.ts PERMISSIONS but no route gates on it and it is not in INTENTIONALLY_UNUSED`);
    }
    expect(
      problems,
      problems.length
        ? `${problems.join("\n")}\nFix: gate a route on the permission, or add it to INTENTIONALLY_UNUSED in src/middleware/rbac.ts with the reason and the owner decision.`
        : undefined,
    ).toEqual([]);
  });

  it("the records do not lie — every listed reason is real and every entry is still unreachable", () => {
    const stale: string[] = [];
    for (const [permission, reason] of Object.entries(INTENTIONALLY_UNUSED)) {
      if (!reason || reason.trim().length < 20) stale.push(`${permission}: reason is missing or too short to be a decision record`);
      // A permission that BOTH has a reason and is used is a contradiction: the
      // entry must be deleted when the route that uses it lands.
      if (usage.has(permission)) {
        stale.push(`${permission} is recorded as intentionally unused but is used at ${usage.get(permission)!.join(", ")} — remove the entry`);
      }
      // And it must actually be declared by some role, or it is a ghost.
      if (!declaredPermissions.includes(permission)) {
        stale.push(`${permission} is recorded as intentionally unused but no role holds it`);
      }
    }
    expect(stale, stale.join("\n")).toEqual([]);
  });

  it("the two roles the audit found inert can now reach something", () => {
    // F-08 named FIELD_AGENT (farmers:assist) and WAREHOUSE_MANAGER
    // (inventory:manage) as holding only unreachable permissions: they could
    // authenticate but no route was gated on what they may do. Keeping the
    // permissions is a recorded decision (OD-06), so this test asserts the
    // record exists — if a future change deletes them, it must delete the
    // record too, and that change is visible in review.
    expect(INTENTIONALLY_UNUSED["inventory:manage"]).toBeTruthy();
    expect(INTENTIONALLY_UNUSED["farmers:assist"]).toBeTruthy();
  });

  it("no permission is enforced by an inline role list on a route", () => {
    // The mechanism rule: a route whose GATE is a literal role-list comparison
    // is what the route-role matrix cannot render. This catches the pattern the
    // audit found 19 times, in the form it took.
    //
    // The escape hatch is explicit and one-line: `authorization-exempt` on the
    // same line, for the handful of handler-internal predicates that NARROW a
    // response rather than grant access (the platform-admin bypass inside a
    // handler whose route is already permission-gated). It is deliberately
    // noisy in review — an exemption is a decision, not a default.
    //
    const offenders: string[] = [];
    const INLINE_ROLE_LIST = /\[[^\]]*"(?:ADMIN|SUPER_ADMIN|REGIONAL_MANAGER|AREA_MANAGER|PROCUREMENT_MANAGER|WAREHOUSE_MANAGER|COLLECTION_MANAGER|FIELD_AGENT|SERVICE_PROVIDER|DEALER|CORPORATE|COOPERATIVE|FARMER)"[^\]]*\]\s*\.includes\(/g;
    for (const [file, src] of sourceByFile) {
      const rel = file.slice(apiRoot.length).replace(/\\/g, "/");
      for (const m of src.matchAll(INLINE_ROLE_LIST)) {
        const lineStart = src.lastIndexOf("\n", m.index) + 1;
        const lineEnd = src.indexOf("\n", m.index);
        const line = src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
        if (line.includes("authorization-exempt")) continue;
        const lineNo = src.slice(0, m.index).split("\n").length;
        offenders.push(`${rel}:${lineNo} carries an inline role list — use requirePermission(...) or mark the line authorization-exempt with the reason`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the procurement list scope is a declared capability, not an inline list (the last F-08 site)", () => {
    // The procurement conversion removed the guard's last exemption, so the
    // scan above now covers every module file with no OUT_OF_SCOPE_MODULES set.
    // Same proof discipline as payments: the file must use the named permission,
    // and the permission must be held by exactly the roles the old inline list
    // granted (tests/permission-migration-equivalence.test.ts holds the 13-role
    // proof for both sites).
    const src = readFileSync(join(apiRoot, "src/modules/procurement/routes.ts"), "utf8");
    expect(src).not.toMatch(/\[[^\]]*"(?:ADMIN|SUPER_ADMIN)"[^\]]*\]\s*\.includes\(/);
    expect(src).toContain('hasPermission(role, "procurement:read:any")');
  });

  it("the payments list scope is a declared capability, not an inline list (the one authorised site)", () => {
    // The single-site authorisation for payments/routes.ts must leave the file
    // using the named permission, and the permission must be held by exactly
    // the roles the old inline list granted (tests/permission-migration-
    // equivalence.test.ts holds the 13-role proof).
    const src = readFileSync(join(apiRoot, "src/modules/payments/routes.ts"), "utf8");
    expect(src).not.toMatch(/\[[^\]]*"(?:ADMIN|SUPER_ADMIN)"[^\]]*\]\s*\.includes\(/);
    expect(src).toContain('hasPermission(getAuth(req).role, "payments:read:any")');
  });

  it("every /admin route declares its own permission (the module gate is gone)", () => {
    // The admin router used to open with an inline role list that admitted five
    // roles and then re-refused most of them per route. With that gate removed,
    // a new admin route MUST carry its own permission — this is the guard that
    // would have caught the removal without the per-route checks.
    const matrix = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../../docs/generated/route-matrix.json", import.meta.url)), "utf8"),
    ) as { routes: { router: string; method: string; path: string; auth: string }[] };
    const adminRoutes = matrix.routes.filter((r) => r.router === "adminRouter");
    expect(adminRoutes.length, "no admin routes found — the inventory shape changed").toBeGreaterThan(4);
    const ungated = adminRoutes.filter((r) => !r.auth.startsWith("requirePermission:"));
    expect(
      ungated.map((r) => `${r.method} /admin${r.path} (${r.auth})`),
      "admin route(s) without a requirePermission gate",
    ).toEqual([]);
  });
});
