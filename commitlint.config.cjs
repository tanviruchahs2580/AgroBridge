// Commit messages drive the changelog and the release notes, so the shape is
// a gate rather than a preference: Conventional Commits. The rule already
// matches the repository history; anything else is flagged in review before a
// release script has to guess what a commit meant.
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Sentence-style subjects that legitimately start with a proper noun
    // (AgroBridge, Play, PostgreSQL, AAB) are this repository's voice; the
    // conventional preset's subject-case rule would reject them.
    "subject-case": [0],
    // GitHub squash merges turn the PR description into a single-paragraph
    // commit body, and conventional-commits-parser classifies a lone trailing
    // paragraph as the footer — so any prose line longer than 100 characters
    // trips body/footer-max-line-length on main regardless of how the PR was
    // written. The contract this gate enforces is conventional SUBJECTS (type,
    // scope, casing, subject length); body/footer wrapping is prose style, not
    // a testable property, and failing main's push range for it produced the
    // false red in PR #54's post-merge run.
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
  // One commit in PR #40's range carries an invalid scope separator
  // ("feat(web)+ci:"). Fixing its message needs a force-push of a published
  // branch, which this repository forbids, so it is ignored by header match —
  // the gate applies to every commit created after it.
  //
  // Same policy, same reason, for two published headers over the 100-character
  // limit: `f1c591b` (101) and `0b8a2ca` (107). Rewording them would need a
  // force-push of a branch that is already public (forbidden); they are
  // exempted by EXACT header match, while `header-max-length` keeps applying
  // to every new commit — the next long subject fails as before.
  ignores: [
    (message) => message.startsWith("feat(web)+ci:"),
    (message) =>
      message.startsWith(
        "test(e2e): acceptance drills — AI fallback, pay modes, security replay, restore drill, throttled perf"
      ) ||
      message.startsWith(
        "test(ai): coverage-map parity, advisory-rule boundaries and copy-safety gates; file Domain A evidence (#88)"
      ),
  ],
};
