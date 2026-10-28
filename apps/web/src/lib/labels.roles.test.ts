import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { roleLabel } from "./labels";

/**
 * Role-vocabulary guard, web side.
 *
 * The server can assign thirteen roles; the UI labelled five of them, so an operator
 * table or an audit row showing one of the other nine printed the raw enum
 * ("REGIONAL_MANAGER") in the middle of Bengali copy. `contracts/roles.json` is the
 * declared vocabulary, and this test fails the moment a role the server can issue has
 * no user-facing label — which is how it drifted the first time.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(
  readFileSync(path.resolve(here, "..", "..", "..", "..", "contracts", "roles.json"), "utf8")
) as { roles: string[]; legacy_labels?: Record<string, string> };

const BENGALI = /[\u0980-\u09FF]/;

describe("role labels", () => {
  it("every role the server can assign has a label", () => {
    const unlabelled = contract.roles.filter((r) => roleLabel(r, "en") === r);
    expect(unlabelled, `roles rendering as raw enum strings: ${unlabelled.join(", ")}`).toEqual([]);
  });

  it("labels are real words in both languages, not the enum repeated", () => {
    for (const role of contract.roles) {
      const en = roleLabel(role, "en");
      const bn = roleLabel(role, "bn");
      expect(en.length, `${role} has an empty English label`).toBeGreaterThan(1);
      expect(bn.length, `${role} has an empty Bengali label`).toBeGreaterThan(1);
      expect(en, `${role}: the English label is the enum itself`).not.toBe(role);
      expect(bn, `${role}: the Bengali label is the enum itself`).not.toBe(role);
    }
  });

  it("the Bengali label is actually Bengali, not a copy of the English one", () => {
    // LibreOffice-free check: a Bengali label must contain Bengali script. Product
    // names that stay Latin in Bengali copy (AgroBridge, QC) are fine as long as the
    // label carries Bengali somewhere; a pure-Latin Bengali label usually means the
    // translation was forgotten.
    const untranslated = contract.roles.filter((r) => {
      const bn = roleLabel(r, "bn");
      const en = roleLabel(r, "en");
      return bn === en || !BENGALI.test(bn);
    });
    expect(untranslated, `Bengali labels missing or copied from English: ${untranslated.join(", ")}`).toEqual([]);
  });

  it("labels for the legacy-only role still resolve (a historical row must not print an enum)", () => {
    for (const role of Object.keys(contract.legacy_labels ?? {})) {
      expect(roleLabel(role, "en")).not.toBe(role);
      expect(roleLabel(role, "bn")).not.toBe(role);
    }
  });

  it("an unknown role falls back to the raw string rather than to a wrong label", () => {
    expect(roleLabel("NOT_A_ROLE", "en")).toBe("NOT_A_ROLE");
    expect(roleLabel("", "bn")).toBe("");
  });
});
