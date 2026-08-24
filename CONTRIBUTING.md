# Contributing

## Branching
```
main     ← production-ready; protected
develop  ← integration branch (optional per team)
feature/<scope>-<summary>   fix/…   test/…   docs/…
```

## Commit style (Conventional Commits)
```
feat: implement farmer farm management
fix: resolve procurement payout race on wallet credit
test: add offline sync idempotency coverage
security: harden refresh token rotation
ci: add docker build stage
docs: expand deployment runbook
```
No `update`/`final`/`misc` commits. One logical change per commit.

## Pull requests
1. Branch from `develop` (or `main` for hotfixes).
2. CI must pass: lint, typecheck, tests, builds, audit.
3. New features require journey tests in `apps/api/tests`.
4. Update `docs/` + `CHANGELOG.md` when behaviour changes.
5. Never commit `.env`, keys, or real personal data.

## Local quality gates before pushing
```bash
cd apps/api && npx eslint src tests && npm run typecheck && npx vitest run
cd apps/web && npm run build
```
