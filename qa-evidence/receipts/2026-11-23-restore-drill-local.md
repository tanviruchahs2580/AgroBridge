# Restore drill receipt — 2026-11-22T20:35:17.223Z

Machine: Windows 11 (10.0.26300), Git Bash, Node v24.19.0 — both databases are disposable localhost containers (drill source + scratch, one postgres:16-alpine instance, ports bound to 127.0.0.1 only). Operator: engineering session (remediation WP-13). Commit under test: feat/backup-drill-tooling (drill script on this branch).

| Phase | Duration |
|---|---|
| Dump (export) | 938 ms |
| Restore (schema + data) | 309 ms |
| Row-count verification | 486 ms |
| Smoke queries | 32 ms |
| **Total rehearsal** | **22842 ms (22.8 s)** |

Verdict: RESTORE VERIFIED — 100% row integrity, no orphans.

## Smoke queries (timed)

| Query | Duration |
|---|---|
| users count | 7 ms |
| orders count | 6 ms |
| payments count | 4 ms |
| latest audit row | 8 ms |
| latest payment row | 7 ms |

## Row counts (dump = restored = source)

| Table | Rows | State |
|---|---|---|
| Organization | 0 | ok |
| User | 5 | ok |
| OrganizationMember | 0 | ok |
| RefreshToken | 0 | ok |
| FarmerProfile | 1 | ok |
| Farm | 1 | ok |
| Plot | 1 | ok |
| CropCycle | 1 | ok |
| FarmEvent | 1 | ok |
| AdvisoryQuery | 0 | ok |
| DiseaseCase | 0 | ok |
| Product | 8 | ok |
| Cart | 0 | ok |
| CartItem | 0 | ok |
| Order | 0 | ok |
| OrderItem | 0 | ok |
| Service | 8 | ok |
| ServiceProvider | 8 | ok |
| Booking | 0 | ok |
| ProcurementOrder | 0 | ok |
| Payment | 0 | ok |
| Wallet | 5 | ok |
| WalletTransaction | 1 | ok |
| MembershipPlan | 3 | ok |
| Notification | 1 | ok |
| AuditLog | 0 | ok |
| AiUsageLog | 0 | ok |
| LoginAttempt | 0 | ok |
| StoredObject | 0 | ok |
| PendingUploadPurge | 0 | ok |

RPO/RTO: the OWNER signs these numbers (docs/runbooks/restore-drill.md §RPO/RTO); this receipt records evidence, not claims. The dump file was deleted after verification.

Scope note: the source database held the provisioned demo seed only (no production-volume data) — these durations characterise the pipeline, not the RTO of a populated system; the populated drill is the owner-run Neon PITR drill this runbook hands over.
