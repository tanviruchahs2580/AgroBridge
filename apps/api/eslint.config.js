// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Backend module names, read from the src/modules directory. */
const modules = readdirSync(new URL("./src/modules", import.meta.url));

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/", "coverage/", "*.config.ts", "tests/global-setup.ts"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      // SLP-03: size/complexity guardrails live as warnings by policy — the five
      // largest route files are deliberately large because splitting them would
      // scatter one bounded context across files (the exception list and shrink
      // plan live in CONTRIBUTING § Code conventions).
      "max-lines": ["warn", { max: 650, skipBlankLines: true, skipComments: true }],
      complexity: ["warn", { max: 18 }],
    },
  },
  // ARC-02 module boundary: a backend module may not import another backend
  // module's internals — shared code lives in src/{lib,shared,middleware,
  // infrastructure,providers}. The graph was verified free of module→module and
  // provider→module imports before this rule landed (re-audit 2026-10-21); new
  // edges now fail lint instead of being discovered by audit.
  ...modules.map((mod) => ({
    files: [`src/modules/${mod}/**/*.ts`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: modules
            .filter((other) => other !== mod)
            .map((other) => ({
              group: [`**/modules/${other}`, `**/modules/${other}/**`],
              message:
                "modules must not import other modules; move shared code to src/lib, src/shared, src/middleware or src/providers (ARC-02)",
            })),
        },
      ],
    },
  })),
  // Providers are leaf adapters: they may not import application modules at all.
  {
    files: ["src/providers/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/modules/**", "**/modules/*/*"],
              message: "providers must not import application modules (ARC-02)",
            },
          ],
        },
      ],
    },
  },
);
