# The two-person rule — paths that need two approvals

Status: proposal for the owner to enact (OA-11) · Recorded: 2026-11-23 (WP-26 / PRC-01)

The repository has one maintainer (PRC-01, bus factor 1) and the `main` ruleset requires **zero
approvals**. This document proposes the smallest set of paths where a second pair of eyes is worth
the scheduling cost, so that when a second maintainer exists, the rule is already written down and
the tooling proposal (bottom) is ready to apply.

## The paths

| Path | Why it needs two |
|---|---|
| `apps/api/src/modules/payments/**` | Money moves here; a wrong line costs real taka |
| `apps/api/src/modules/auth/**` | Session, OTP, step-up, deletion — the takeover surface |
| `apps/api/prisma/**` (+ both migration chains) | Schema changes are forward-only (ADR-0007); a mistake is permanent |
| `.github/workflows/**` | CI changes what "green" means, including the gates |
| `scripts/licence-allowlist.json`, `license-allowlist.json` | The licence ratchet — raising is policy, lowering is a loophole |
| `SECURITY_WAIVERS.md`, `.gitleaksignore` | Accepted-risk records; broadening one hides real findings |

## The rule as wording for the ruleset

> Changes touching any path above require an approving review from a code owner other than the
> author before merge. Emergency exceptions are allowed only by revert-then-reapply (the incident
> fix lands first as a revert of the last change, the substantive change goes through review).

## CODEOWNERS proposal

`CODEOWNERS` exists but carries comments stating the ruleset runs with
`required_approving_review_count: 0` (a known disagreement with `CONTRIBUTING.md` — recorded, not
assumed away). The proposal: scope the file to exactly the paths above, name the owner plus the
second maintainer once they exist, and keep the comment in step with the ruleset (one source of
truth: the ruleset).

## The `gh api` commands the OWNER runs (engineering never does — R2/OA-11)

```bash
# 1. Require an approving review on main (from 0 to 1)
gh api --method PUT repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/rulesets/25297401 \
  --input ruleset.json   # the current ruleset JSON + rules[].parameters.required_approving_review_count: 1

# 2. Add the two convention-required contexts to the ruleset's required checks
#    (api-migration-drift and quality-gates — today they can be merged red)
#    ... in the same ruleset PUT, append to rules[].parameters.required_status_checks

# 3. Protect the production deploy environment
gh api --method POST repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/environments/production/reviewers \
  -f reviewers[]=<second-maintainer-user-id>

# 4. Verify
gh api repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/rulesets/25297401 --jq '.rules[] | .type'
```

The ruleset JSON should be fetched first (`gh api .../rulesets/25297401 > ruleset.json`), edited,
and PUT back — PUT replaces the ruleset, so a partial edit would drop existing rules.

## Onboarding the second maintainer (one page)

1. Access: write on the repo, admin on the production deploy environment, no secret access beyond
   what Actions shows.
2. Read, in order: `AGENTS.md`, `CONTRIBUTING.md`, `docs/STATUS.md`, `docs/security.md`, this file.
3. First week: review-only — two approvals on money/auth PRs, no merges.
4. The breaks-glass runbook (`docs/runbooks/secret-rotation.md`) is read together with the owner,
   not handed over.

## What this does NOT change

- The single-maintainer reality today: nothing in the ruleset changes until a second person exists.
- Dependabot PRs and docs-only changes stay review-light (paths above exclude `docs/**`).
