// Enforces the Conventional Commits subject format CONTRIBUTING.md documents
// (one logical change, imperative subject, no `update`/`final`/`misc` shout-outs).
// CI runs this against the PR's commit range; locally: npm run lint:commits.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", ["feat", "fix", "docs", "ci", "chore", "refactor", "perf", "test", "build", "revert"]],
    "subject-empty": [2, "never"],
    "subject-case": [0], // Bangla subjects and file paths are legitimate
    "body-max-line-length": [0], // evidence receipts wrap however the evidence needs
    // GitHub's squash-merge generates the message footer (commit list + co-author
    // lines) whose lines can exceed 100 — that footer is machine-generated, not
    // hand-written, so the length rule must not reject the merge.
    "footer-max-line-length": [0],
  },
};
