// Commit messages drive the changelog and the release notes, so the shape is
// a gate rather than a preference: Conventional Commits. The rule already
// matches the repository history; anything else is flagged in review before a
// release script has to guess what a commit meant.
module.exports = {
  extends: ["@commitlint/config-conventional"],
};
