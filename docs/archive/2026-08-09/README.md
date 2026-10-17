# Archived root reports

These files were tracked at the repository root until 2026-10-18, when the Phase 4 repository
hygiene pass (`GOV-1` in `docs/CODE_QUALITY_REVIEW_2026-10-17.md`) moved them here. They are
kept for provenance only — several contradict each other and none describes the current state
of the repository. Read them as dated evidence of what was believed at the time they were
written, never as current status.

Current sources instead of these files:

- certification record: `ENTERPRISE_CERTIFICATION_STATUS.md` (repo root, with dated addenda)
- release facts: `version.json` + `CHANGELOG.md` + `docs/play/release-runbook.md`
- running history: `EXECUTION_LOG.md` (repo root)
- current operations: `docs/disaster-recovery.md`, `docs/runbooks/live-deployment.md`

## What is here, what superseded it, and when

| File | Dated | Superseded by |
|---|---|---|
| `PROJECT_STATUS.md` | 2026-08-25 (v1.1.0 pending) | `EXECUTION_LOG.md` as the running record; `ENTERPRISE_CERTIFICATION_STATUS.md` (2026-09-15) for certification state. Its "remote: none configured" and "tags: none" facts are long obsolete. |
| `PRODUCTION_GAP_REGISTER.md` | 2026-08-25 | `ENTERPRISE_CERTIFICATION_STATUS.md` (2026-09-15); launch gaps re-registered in `docs/PLAY_STORE_LAUNCH_PLAN.md` (2026-10-17) and `docs/CODE_QUALITY_REVIEW_2026-10-17.md` §8. Most GAP-00x items were fixed in the v1.2/v1.3 rounds; do not treat as open. |
| `PRODUCTION_CERTIFICATION_REPORT.md` | 2026-08-25 — "v1.1.1 candidate" | `ENTERPRISE_CERTIFICATION_STATUS.md` (2026-09-15). The candidate version was never released; see `CHANGELOG.md` for what actually shipped. |
| `PERFORMANCE_REPORT.md` | 2026-08-25 | Never re-run after that date. The harness (`apps/api/scripts/loadtest.mjs`) is current, but no later claim should cite this report's numbers; it explicitly documents that no new load test was executed even then. |
| `DISASTER_RECOVERY_REPORT.md` | 2026-08-25 | `docs/disaster-recovery.md` (current procedure) and the 2026-09-15 rehearsal recorded there. |
| `ENTERPRISE_MASTER_REPORT.md` | 2026-08-25 (v1.1.2) | `ENTERPRISE_CERTIFICATION_STATUS.md` (2026-09-15). Its "8.7/10 production ready with limitations" verdict predates the 09-10 and 09-11 audits that found deeper gaps. |
| `ENTERPRISE_CERTIFICATION_REPORT_v1.2.0.md` | 2026-08-25 (v1.2.0 tag) | `ENTERPRISE_CERTIFICATION_STATUS.md` (2026-09-15) and its addenda through 2026-10-16. |
| `FINAL_ENTERPRISE_VALIDATION_REPORT.md` | 2026-08-26 (v1.3.0) | `ENTERPRISE_CERTIFICATION_STATUS.md` (2026-09-15) — "final" was not final; later validation lives in that file's addenda. |
| `ENTERPRISE_QA_AUDIT_REPORT_2026-09-10.md` | 2026-09-10 (v1.3.x) | The 2026-09-11 architecture audit below, then `ENTERPRISE_CERTIFICATION_STATUS.md` (2026-09-15). |
| `AGROBRIDGE_ENTERPRISE_ARCHITECTURE_QA_AUDIT.md` | 2026-09-11 | `ENTERPRISE_CERTIFICATION_STATUS.md` (2026-09-15), whose §3 records which of its findings were fixed. Its `PROJECT_STATUS.md`/`README.md` test-count complaints are themselves now historical. |
| `LIVE_TEST_CI_CD_REPORT_2026-09-15.md` | 2026-09-15 (`main` @ `524c3a1`) | Later live-verification rounds in `EXECUTION_LOG.md` (2026-10-15 and 2026-10-17); current topology and procedure in `docs/runbooks/live-deployment.md`. |
| `RELEASE_MANIFEST.md` | 2026-08-26 | `version.json` + `CHANGELOG.md` + `docs/play/release-runbook.md`. Its own header already declares it historical: it announced a "v1.5.0 (candidate)" that was never cut (the shipped line is 1.4.0). |

Cross-references between files in this directory remain valid — they moved together.
