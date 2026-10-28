import { readFileSync } from "node:fs";
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
};
const adminRoutes = readFileSync(path.resolve(here, "..", "src", "modules", "admin", "routes.ts"), "utf8");
const schema = readFileSync(path.resolve(here, "..", "prisma", "schema.prisma"), "utf8");

const declared = [...contract.roles].sort();

function validRolesFromSource(): string[] {
  const line = /const VALID_ROLES = \[([^\]]+)\]/.exec(adminRoutes);
  if (!line) throw new Error("VALID_ROLES not found — update this guard with the new shape");
  return [...line[1]!.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]!).sort();
}

function rolesFromSchemaComment(): string[] {
  const line = /role\s+String\s+@default\("FARMER"\)\s*\/\/\s*([^\n]+)/.exec(schema);
  if (!line) throw new Error("the role column comment not found — update this guard with the new shape");
  return [...new Set(line[1]!.trim().split("|").map((r) => r.trim()).filter(Boolean))].sort();
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
});
