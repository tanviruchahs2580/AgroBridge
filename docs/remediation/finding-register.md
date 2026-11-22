# Finding register — 2026-11-21 audit (v1.4.3)

Verbatim copy of Appendix A of *AgroBridge-Remediation-Master-Prompt-v1.0.md* (the corrected finding
register from the cross-checked audit). Work-package mapping and current status live in
`docs/remediation/PROGRESS.md`. `*` = severity rises to High at the live-payments gate (ADR-0013 trigger).

| ID | Sev | Finding | WP |
|---|---|---|---|
| ARC-01 | High | Route files mix HTTP, rules and Prisma (god modules) | 16 |
| ARC-02 | Medium | Dual-dialect schema: 3 files, 2 chains (ADR-0004) | 15b (DR-01) |
| ARC-03 | Low | No shared contracts package; types are fixture-guarded | 19 |
| ARC-04 | Medium | No async boundary; side effects inline (ADR-0010) | 18 |
| ARC-05 | Medium | Audit narratives in code comments | QW-08 |
| ARC-06 | Low | Roles/permissions declared without routes | 20 |
| ARC-07 | Medium | Multi-tenancy over-claimed in docs | 29, QW-03 |
| SEC-01 | High | Refresh throttled per IP; a 429 logs users out | 01 |
| SEC-02 | Medium* | Tokens in `localStorage` (ADR-0003) | 08 |
| SEC-03 | Medium | OTP attempts non-atomic; raw-phone limiter key; shared pepper | 06 |
| SEC-04 | Medium* | No MFA/step-up (ADR-0013) | 14 |
| SEC-05 | Medium | Callback URL from `Host` when `API_PUBLIC_URL` unset | 07 |
| SEC-06 | Medium | Hand-rolled multipart; PNG/WebP metadata kept | 23 |
| SEC-07 | Medium | Rate limits per instance without Redis; fails open | 05 |
| SEC-08 | Low | "Neutral" registration response is distinguishable | QW-02 |
| SEC-09 | Low | One HS256 secret, no `kid`/rotation overlap | 25 |
| SEC-10 | Low | PII in audit metadata | QW-01 |
| SEC-11 | Low | bcryptjs; length-only password policy | backlog |
| SEC-12 | Low | Android hardening (minify, FileProvider, integrity) | QW-07 |
| DAT-01 | High | String "enums" unconstrained; drift (`REFUNDED`, `DELETED`) | 15a |
| DAT-02 | Medium | 32-bit money columns | QW-05, 17 |
| DAT-03 | Medium | JSON stored as strings | 15b |
| DAT-04 | Medium | Polymorphic refs without FKs; ledger `userId` has no FK | 15a, 17 |
| DAT-05 | Medium | Audit log mutable | 30 |
| DAT-06 | High | Backup/PITR/DR unproven | 13 |
| DAT-07 | Low | Growth tables unpartitioned | 33 |
| DAT-08 | Low | Geo as floats | backlog |
| DAT-09 | Low | Forward-only migrations without a playbook | 15a |
| PAY-01 | High | Gateway signature unproven; tests circular | 03 |
| PAY-02 | High | Single-entry ledger; refund debits buyer; manual payouts | 17 |
| PAY-03 | Medium | Webhook shares the global IP limiter | 03 |
| PAY-04 | Medium | Locking idiom relies on a no-op `UPDATE` | 17 |
| PAY-05 | Medium | No fulfilment workflow | 20 |
| PAY-06 | High | Buyer can hard-delete a `PAID` order | 02 |
| PAY-07 | Low | `SSLCOMMERZ_SANDBOX` is a free string | QW-04 |
| API-01 | Low | No OpenAPI (deferred by ADR-0021) | 19 |
| API-02 | Low | Offset pagination | backlog |
| API-03 | Low | No deprecation/sunset policy | 19 |
| REL-01 | Medium | Client↔API round trip to `iad1` for Bangladesh users | 09 |
| REL-02 | Low | Auth status read per request (cheap when co-located) | 22 |
| REL-03 | Medium | Serverless cold starts / pool contract | 25 |
| REL-04 | Medium | No back-pressure for slow dependencies | 18 |
| REL-05 | Medium | Cron inside HTTP functions; no lock or missed-run alert | 18 |
| REL-06 | Low | Single region, no failover | 25 |
| TST-01 | Medium | Circular payment tests | 03 |
| TST-02 | Medium | Web coverage modest; two shells at 0 % | 32 |
| TST-03 | Medium | SQLite-first default suite | 15b, 32 |
| TST-04 | Low | No mutation/fuzz/pentest | 31, 32 |
| TST-05 | Low | Hand-written counts drift | QW-06 |
| OPS-01 | Medium | Two deployment paths (Compose scaffold never run) | 25 |
| OPS-02 | Medium | No IaC or secrets manager | 25 |
| OPS-03 | Medium | Zero required approvals; CODEOWNERS unenforced | 26 |
| OPS-04 | Low | `ci.yml` is 1,047 lines | backlog |
| OPS-05 | Low | nginx master runs as root; no canary | backlog |
| OPS-06 | Low | `dev` script portability; untyped `.mjs` scripts | backlog |
| OBS-01 | High | No alert sink or on-call | 10 |
| OBS-02 | Medium | No error tracking or tracing backend | 10, 24 |
| OBS-03 | Medium | SLOs unadopted; DR unverified | 13, 24 |
| OBS-04 | Low | Monitoring stack exists only in the Docker topology | 25 |
| CLI-01 | High (product) | No offline reads (ADR-0008/0009) | 21 |
| CLI-02 | Medium | Capacitor wrapper: no secure storage, FCM, background sync | 08, 28 |
| CLI-03 | Low | Large `ui.tsx`/`i18n.ts` (data layer is deliberate, ADR-0002) | backlog |
| CLI-04 | Low | Toolchain drift (ESLint 8, React 18, Tailwind 3) | 34 |
| CLI-05 | Low | No Bangla voice / icon-first flows | 27 |
| AIG-01 | High | KB entirely unsourced (8 entries, all `UNSOURCED`) | 11 |
| AIG-02 | High (product) | No disease classifier or reviewer UI | 27 |
| AIG-03 | Medium | Keyword retrieval over 8 entries | 27 |
| AIG-04 | Medium | Governance gaps (eval gates, PII coverage, DPIA) | 11, 27, 31 |
| AIG-05 | Info | Hosted-LLM path not activated | 27 |
| CMP-01 | High | Deletion guard inconsistent with the order lifecycle | 02 |
| CMP-02 | Medium | Legal documents await counsel; no production domain | OA-08 |
| CMP-03 | Medium | MIT licence on a proprietary product | 12 |
| CMP-04 | Low | No Bangladesh regulatory mapping or DPIA | 31 |
| PRC-01 | High | Bus factor 1; zero required approvals | 26 |
| PRC-02 | Medium | Documentation volume and drift; unverifiable citations | QW-03 |
