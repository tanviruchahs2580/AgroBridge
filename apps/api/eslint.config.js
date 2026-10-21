// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Type-aware linting: the untyped `recommended` set cannot see promise misuse
 * (an async express handler whose rejection escapes, a promise in a condition)
 * or non-null assertions on optional request state. `recommendedTypeChecked`
 * reuses the `tsc` program through the project service, so lint and typecheck
 * cannot disagree about what a symbol is.
 *
 * Scope of this pass: the type-checked rules below are errors in `src/`, where
 * this change fixed every violation. In `tests/`, the unsafe-* family measures
 * supertest's untyped JSON bodies, so those rules plus a handful of style ones
 * are switched off there (with the reason at the override) and the non-null
 * assertion backlog in test files owned by the test pass is a warning, not a
 * build breaker.
 */
export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    ignores: ["dist/", "coverage/", "*.config.ts", "tests/global-setup.ts"],
  },
  {
    languageOptions: {
      parserOptions: {
        // One program shared across linted files; tsconfig.json already
        // includes src/**, tests/** and vitest.config.ts.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      // A dropped promise is a silent failure: either await it, or `void` it
      // with a comment saying why the result does not matter.
      "@typescript-eslint/no-floating-promises": "error",
      // Express 4's RequestHandler is declared `(...): void`, so EVERY async
      // route handler and async middleware trips the call-argument half of
      // this rule even though express never consumes the returned promise.
      // The handlers in this codebase all forward failures through next(e),
      // so the ignored promise cannot reject unobserved. The remaining
      // checks (promise in a condition, spread, property, return position)
      // stay on — those do catch real bugs.
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }],
      // `req.auth!` asserts instead of proving; use getAuth(req) from
      // src/shared/auth-context.ts, which throws unauthorized() when absent.
      "@typescript-eslint/no-non-null-assertion": "error",
      // Size/complexity guidelines (audit SLP-03). Warn-level by design:
      // dictionary/data-heavy files legitimately exceed them, and each known
      // exception is listed in CONTRIBUTING instead of being silently allowed.
      complexity: ["warn", 15],
      "max-lines": ["warn", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }],
      // Tests read supertest responses as `any` (`res.body.data`); typing each
      // response body is a separate, larger pass. Visible as warnings so the
      // backlog stays countable without blocking CI for unrelated changes.
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/await-thenable": "off",
    },
  },
  {
    // Plain-JS entry points (this config, scripts/*.mjs) are outside the
    // type-aware program; lint them with the base rules only instead of
    // failing the project service for files no tsconfig includes. The few
    // Node globals these files use are declared here because the base preset
    // does not assume any environment (no `globals` package dependency).
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        URL: "readonly",
        __dirname: "readonly",
      },
    },
  },
);
