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
  },
  // One commit in PR #40's range carries an invalid scope separator
  // ("feat(web)+ci:"). Fixing its message needs a force-push of a published
  // branch, which this repository forbids, so it is ignored by header match —
  // the gate applies to every commit created after it.
  ignores: [(message) => message.startsWith("feat(web)+ci:")],
};
