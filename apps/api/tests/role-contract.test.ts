import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../src/middleware/rbac.js";

/**
 * Role-vocabulary contract guard.
 *
 * The same role list is written in three places — the Prisma comment that documents
 * the column, `VALID_ROLES` (what an operator may assign) and `PERMISSIONS` (what a
 * role may do) — and the web app writes a fourth when it labels a role. Nothing
 * compared them, so they had already drifted: the UI carried a QC_OFFICER label for a
 * role the server cannot issue, while nine assignable roles had no label at all and
 * rendered as raw enum strings in the operator UI.
 *
 * `contracts/roles.json` is now the declared set. When this test fails, the fix is a
 * decision: either the role is real (add it to the contract and to both sides in one
 * commit) or it is gone (remove it from the contract and from wherever it lingers).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(path.resolve(here, "..", "..", "..", "contracts", "roles.json"), "utf8")) as {
  roles: string[];
  legacy_labels?: Record<string, string>;
};
const apiRoot = path.resolve(here, ".."); // apps/api/
const repoRoot = path.resolve(here, "..", "..", "..");
const adminRoutes = readFileSync(path.resolve(here, "..", "src", "modules", "admin", "routes.ts"), "utf8");
const schema = readFileSync(path.resolve(here, "..", "prisma", "schema.prisma"), "utf8");
const webLabels = readFileSync(path.resolve(repoRoot, "apps", "web", "src", "lib", "labels.ts"), "utf8");

const declared = [...contract.roles].sort();

/** Walk apps/api/src for a pattern, so the guards below are never vacuous. */
function apiSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) apiSourceFiles(p, out);
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}
const apiSource = apiSourceFiles(path.join(apiRoot, "src"))
  .map((f) => `// ${path.relative(apiRoot, f).replace(/\\/g, "/")}\n${readFileSync(f, "utf8")}`)
  .join("\n");

function validRolesFromSource(): string[] {
  const line = /const VALID_ROLES = \[([^\]]+)\]/.exec(adminRoutes);
  const body = line?.[1];
  if (!body) throw new Error("VALID_ROLES not found — update this guard with the new shape");
  return [...body.matchAll(/"([A-Z_]+)"/g)].flatMap((m) => (m[1] ? [m[1]] : [])).sort();
}

function rolesFromSchemaComment(): string[] {
  const line = /role\s+String\s+@default\("FARMER"\)\s*\/\/\s*([^\n]+)/.exec(schema);
  const comment = line?.[1];
  if (!comment) throw new Error("the role column comment not found — update this guard with the new shape");
  return [...new Set(comment.trim().split("|").map((r) => r.trim()).filter(Boolean))].sort();
}

describe("role vocabulary contract", () => {
  it("PERMISSIONS covers exactly the declared roles", () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(declared);
  });

  it("VALID_ROLES (what an operator may assign) is exactly the declared set", () => {
    expect(validRolesFromSource()).toEqual(declared);
  });

  it("the schema's own documentation of the column is exactly the declared set", () => {
    expect(rolesFromSchemaComment()).toEqual(declared);
  });

  it("every declared role resolves to a permission list (no silent fail-closed-only role)", () => {
    for (const role of declared) expect(Array.isArray(PERMISSIONS[role]), `${role} has no permission list`).toBe(true);
  });

  it("only SUPER_ADMIN holds the wildcard", () => {
    const wildcards = Object.entries(PERMISSIONS).filter(([, perms]) => perms.includes("*")).map(([role]) => role);
    expect(wildcards).toEqual(["SUPER_ADMIN"]);
  });

  /**
   * F-50: the role vocabulary has a fourth home in the web labels, which this
   * suite cannot import (the web app is a separate workspace). What CAN be
   * pinned from here is that no role OUTSIDE the contract is treated as real
   * by the server, and that a legacy label can never be silently promoted into
   * the declared set or granted a capability.
   */
  it("a legacy label is tolerated only while the server treats it as un-issuable", () => {
    const legacyLabels = Object.keys(contract.legacy_labels ?? {});
    expect(legacyLabels.length, "the legacy-label escape hatch exists for a reason; if it is empty, delete it").toBeGreaterThan(0);
    // The guard is not vacuous: the web labels really do carry the declared
    // vocabulary (a renamed/removed labels map would otherwise let the legacy
    // assertion below pass by accident).
    const declaredInWeb = declared.filter((r) => new RegExp(`\\b${r}:`).test(webLabels));
    expect(declaredInWeb.length, "web labels no longer expose role keys — update this guard").toBeGreaterThan(5);
    for (const legacy of legacyLabels) {
      expect(declared, `${legacy} appears both as a legacy label and as an issuable role`).not.toContain(legacy);
      expect(PERMISSIONS[legacy], `${legacy} is a legacy label but has a PERMISSIONS entry`).toBeUndefined();
      expect(apiSource, `${legacy} is a legacy label but the API source treats it as a role`).not.toContain(`"${legacy}"`);
    }
  });
});
