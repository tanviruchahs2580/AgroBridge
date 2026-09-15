# Security Waivers

Accepted-risk register for known vulnerabilities that cannot be fixed immediately.
Every waiver needs: reason, compensating control, and an **expiry date** — expired rows
must be re-reviewed or remediated. Reviewed monthly alongside `npm audit` (docs/operations.md).

| CVE/GHSA | Package | Severity | Why accepted | Compensating control | Expiry date |
|---|---|---|---|---|---|
| GHSA-5xrq-8626-4rwp | vitest (+@vitest/*) | Moderate | Dev-only test dependency — never installed in production images (runtime stage uses `npm ci --omit=dev`); fix requires a major-version test-framework bump scheduled separately | Not exposed to network traffic; CI-only execution; production tree audited clean (`npm audit --omit=dev` = 0 findings, verified 2026-09-15) | **2026-12-31** |
| — | @capacitor/cli, autocannon | Moderate | Dev/ops tooling only (Android build, local load test) — not present in any shipped image | Local execution only; not reachable from production | **2026-12-31** |

Resolved by remediation (2026-09-15, no longer waived):
qs (GHSA via body-parser/express/superagent `~6.15.x`) and deepmerge-ts (`@prisma/config` chain)
were pulled to fixed versions via root `overrides` in `package.json`
(`qs@^6.16.0`, `deepmerge-ts@^8.0.0`); `npm audit --omit=dev` is now **0 findings**
and CI fails the build on any moderate+ production finding.

Rules:

- No waivers for runtime dependencies without staff-engineer + security-engineer sign-off.
- Dev-dependency waivers may be accepted by any engineer but still expire.
- On expiry: bump the package or renew the waiver with fresh justification — silent rollover is not allowed.
