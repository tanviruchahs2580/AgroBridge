# WP-25 — One deployment path, IaC, secrets, rollback (decision memo)

Status: **open decision (owner)** · Recorded: 2026-11-23 · Findings: OPS-01, OPS-02, REL-03, REL-06, OBS-04, SEC-09

## Recommendation in one line

Make **Vercel + Neon the only production topology**, retitle the Compose/SSH scaffold as the DR
exercise path (or retire it), adopt minimal IaC for the CI-facing infra, keep secrets in the
platform managers, and rehearse a rollback before the next release.

## Per-topic memo

### Deployment topology (OPS-01)

Two paths exist: the Vercel one (live, verified) and a Compose/nginx/SSH staging scaffold that has
**never run** (`AGENTS.md` §14, deploy-staging.yml missing its secrets). Recommendation: declare
Vercel+Neon primary; either delete the scaffold or keep it **only** as a documented DR restore
target rehearsed once (it then needs its own review — it currently runs an unreviewed nginx
config as root, OPS-05). Keeping two half-alive paths is worse than keeping one.

### IaC scope (OPS-02)

The infrastructure surface is small: two Vercel projects, one Neon instance, env vars, cron
schedules, GitHub settings. Terraform for this today is ceremony without a second operator.
Recommendation: a **versioned env + config manifest** (generated, drift-checked like the other
docs) now; Terraform/OpenTofu when a second environment or region lands (DR-11 option B is the
natural trigger).

### Secrets (OPS-02/SEC-09)

Secrets already live only in platform managers (Vercel env, GitHub Actions secrets) — keep it that
way; never introduce a file-based store. For JWT rotation (SEC-09): the runbook exists
(`docs/runbooks/secret-rotation.md`); the structural fix is dual-key rotation (`kid` header,
overlap window) — a design worth doing when the auth surface next changes, not a standalone PR
during the stabilisation window.

### Rollback (the documented gap)

Immutable `sha-<commit>` images exist, but the reverse path has never been exercised.
Recommendation: a rollback **rehearsal** as its own drill (like WP-13's restore drill): on a
disposable deployment, redeploy the previous production commit, run the smoke, time it, write the
receipt. Vercel's instant-rollback makes the mechanics trivial; the drill exists to prove the
database migrations in the new release don't trap the old code (forward-only reality, ADR-0007 —
the drill must include a release whose migration is not backward-compatible, or state that
limitation in the receipt).

### Monitoring stack (OBS-04)

The Prometheus/Grafana compose stack exists only in the Docker topology. Recommendation: leave it
as the DR topology's monitoring; the production alerting path is the WP-10/OA-05 vendor decision,
not a second stack to maintain.
