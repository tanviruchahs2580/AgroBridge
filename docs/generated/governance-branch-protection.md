# Governance — Branch Protection (Phase 12)

**Status:** DOCUMENTED ONLY — no API call executed (requires admin token)
**Date:** 2026-09-02
**Repo:** `tanviruchahs2580/AgroBridge`
**Branch:** `main`
**Sources:** `.github/workflows/ci.yml` (branches `[main,develop]`), `.github/workflows/codeql.yml` (branches `[main]`), `.github/CODEOWNERS`

---

## 1. Intent

Lock `main` so every change is a PR, CI + CodeQL must be green, no force-push, and review conversations must be resolved. Mirrors the Definition of Done gate (§9) and Phase 12 remaining work.

---

## 2. CODEOWNERS (already created)

**File:** `.github/CODEOWNERS` (3 lines)

```
/apps/api/payments/ @tanviruchahs2580
/apps/api/prisma/ @tanviruchahs2580
/.github/workflows/ @tanviruchahs2580
```

Effect: PRs touching money logic, schema/migrations, or CI require `@tanviruchahs2580` review when `require_code_owner_reviews: true`.

---

## 3. Protection JSON — `gh api -X PUT repos/.../branches/main/protection`

### 3.1 One-liner (GitHub CLI)

```bash
# Requires: gh auth login (admin on tanviruchahs2580/AgroBridge), repo scope
# Dry-run: gh api repos/tanviruchahs2580/AgroBridge/branches/main/protection --jq .
gh api -X PUT repos/tanviruchahs2580/AgroBridge/branches/main/protection \
  --input docs/generated/governance-branch-protection.json
```

Where `docs/generated/governance-branch-protection.json` is the JSON in §3.2 below (or inline with `-f` flags).

### 3.2 Full JSON payload (canonical)

> Save as `docs/generated/governance-branch-protection.json` (or paste inline). All keys are the current REST API shape (`2022-11-28`).

```json
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "CI" },
      { "context": "CodeQL" }
    ],
    "contexts": ["CI", "CodeQL"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "require_last_push_approval": false,
    "dismissal_restrictions": {},
    "bypass_pull_request_allowances": {}
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "required_linear_history": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
```

**Alternate minimal (modern) shape** — if `contexts` is rejected (GitHub now prefers `checks`):

```json
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "CI" },
      { "context": "CodeQL" }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
```

### 3.3 Inline `gh api -f` variant (no JSON file)

```bash
gh api -X PUT repos/tanviruchahs2580/AgroBridge/branches/main/protection \
  -f required_status_checks[strict]=true \
  -f required_status_checks[checks][][context]="CI" \
  -f required_status_checks[checks][][context]="CodeQL" \
  -f enforce_admins=true \
  -f required_pull_request_reviews[required_approving_review_count]=1 \
  -f required_pull_request_reviews[dismiss_stale_reviews]=true \
  -f required_pull_request_reviews[require_code_owner_reviews]=true \
  -f restrictions=null \
  -F allow_force_pushes=false \
  -F allow_deletions=false \
  -F required_conversation_resolution=true
```

> Note: `gh api` boolean false must be `-F` (boolean) not `-f` (string) for `allow_force_pushes`/`allow_deletions`.

### 3.4 Using `curl` (PAT alternative)

```bash
curl -X PUT \
  -H "Authorization: Bearer $GH_PAT" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/tanviruchahs2580/AgroBridge/branches/main/protection \
  -d @docs/generated/governance-branch-protection.json
```

---

## 4. What Each Key Enforces (mapped to task)

| JSON key | Value | Task requirement | Effect |
|---|---|---|---|
| `required_status_checks.strict` | `true` | — | PR must be up-to-date with `main` before merge |
| `required_status_checks.checks` / `contexts` | `CI`, `CodeQL` | **required checks `CI` + `CodeQL`** | Both workflows (`.github/workflows/ci.yml:1` `name: CI` and `codeql.yml:1` `name: CodeQL`) must be green. CI includes 9 jobs; CodeQL is the SARIF upload job. If you use required checks via Rulesets, add those check names instead. |
| `enforce_admins` | `true` | — | Admins cannot bypass |
| `required_pull_request_reviews.required_approving_review_count` | `1` | — | At least one approval |
| `required_pull_request_reviews.dismiss_stale_reviews` | `true` | — | New commits dismiss approvals |
| `required_pull_request_reviews.require_code_owner_reviews` | `true` | — | CODEOWNERS owners must approve when their paths are touched |
| `restrictions` | `null` | — | No push allowlist (anyone with write can push to PR branch, not to `main`) |
| `allow_force_pushes` | `false` | **no force-push** | `git push --force` to `main` rejected |
| `allow_deletions` | `false` | — | `main` cannot be deleted |
| `required_conversation_resolution` | `true` | **conversations resolved** | All review threads must be resolved |
| `required_linear_history` | `false` | — | Merge commits allowed (set `true` if you want rebase-only) |
| `lock_branch` | `false` | — | Branch not read-only |

---

## 5. Verification (after applying)

```bash
# 1. Read back protection
gh api repos/tanviruchahs2580/AgroBridge/branches/main/protection --jq .

# Expect:
# .required_status_checks.checks[].context == ["CI","CodeQL"]
# .allow_force_pushes.enabled == false
# .required_conversation_resolution.enabled == true
# .enforce_admins.enabled == true

# 2. Test no force-push (should fail)
# git push -f origin main  # → remote: error: GH006: Protected branch update failed

# 3. Test PR gate: open a trivial PR → checks CI + CodeQL must appear as required → merge button disabled until green.

# 4. Test CODEOWNERS: open PR touching apps/api/payments/routes.ts → review required from @tanviruchahs2580.

# 5. Remove (if needed, admin only)
# gh api -X DELETE repos/tanviruchahs2580/AgroBridge/branches/main/protection
```

---

## 6. Ruleset Alternative (recommended for orgs, future)

If the org migrates to Rulesets (replaces branch protection UI), create a ruleset via:

```bash
gh api -X POST repos/tanviruchahs2580/AgroBridge/rulesets --input - <<'JSON'
{
  "name": "main protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "creation" },
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_status_checks", "parameters": { "required_status_checks": [{ "context": "CI" }, { "context": "CodeQL" }], "strict_required_status_checks_policy": true } },
    { "type": "pull_request", "parameters": { "required_approving_review_count": 1, "dismiss_stale_reviews_on_push": true, "require_code_owner_review": true, "require_last_push_approval": false, "required_review_thread_resolution": true } }
  ],
  "bypass_actors": []
}
JSON
```

---

## 7. Next (when push/admin allowed)

1. Commit `.github/CODEOWNERS` (this PR) → CI green.
2. Run the `gh api -X PUT .../protection --input docs/generated/governance-branch-protection.json` command with an admin token (or apply via GitHub UI: Settings → Branches → Add rule → `main` → Require PR, Require status checks `CI` + `CodeQL`, Require conversation resolution, Do not allow force pushes).
3. Verify with `gh api .../protection --jq .` and a test PR touching `apps/api/payments/`.
4. This doc is the source of truth — do not hand-edit protection in UI without updating the JSON here.

---

## 8. Companion JSON file (for `gh api --input`)

> The JSON below is also intended to be saved as `docs/generated/governance-branch-protection.json` for the `--input` flag.

```json
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "CI" },
      { "context": "CodeQL" }
    ],
    "contexts": ["CI", "CodeQL"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "require_last_push_approval": false,
    "dismissal_restrictions": {},
    "bypass_pull_request_allowances": {}
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "required_linear_history": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
```
