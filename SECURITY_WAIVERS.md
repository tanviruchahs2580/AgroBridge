# Security Waivers

Accepted-risk register for known vulnerabilities that cannot be fixed immediately.
Every waiver needs: reason, compensating control, and an **expiry date** — expired rows
must be re-reviewed or remediated. Reviewed monthly alongside `npm audit` (docs/operations.md).

| CVE/GHSA | Package | Severity | Why accepted | Compensating control | Expiry date |
|---|---|---|---|---|---|
| GHSA-5xrq-8626-4rwp | vitest (+@vitest/*) | Moderate | Dev-only test dependency — never installed in production images (runtime stage uses `npm ci --omit=dev`); fix requires a major-version test-framework bump scheduled separately | Not exposed to network traffic; CI-only execution; production tree audited clean (`npm audit --omit=dev` = 0 findings, verified 2026-09-15) | **2026-12-31** |
| — | @capacitor/cli, autocannon | Moderate | Dev/ops tooling only (Android build, local load test) — not present in any shipped image | Local execution only; not reachable from production | **2026-12-31** |

## Static-analysis (CodeQL / gitleaks) triage — 2026-10-18 audit

Alerts that are acknowledged rather than fixed in code. Four of the five open alerts at HEAD
(insecure randomness in the offline queue; three TOCTOU reads in the two `gen-docs.mjs`
scripts) were fixed in code and cleared on the next scan. The alert below was **dismissed on
GitHub on 2026-10-18** (state: dismissed / false positive) under explicit owner instruction,
with this rationale as the dismissal comment; the audit had originally withheld the change.
Because the query stays enabled, a future edit that shifts the flagged lines can surface a new
occurrence — dismiss again with this rationale, or replace the signature helper if the gateway
ever offers a stronger algorithm.

**gitleaks allowlist (`.gitleaksignore`, added 2026-10-18):** four finding fingerprints,
all rule `generic-api-key`, all commit-pinned, all false positives on non-secret test
strings — two in `apps/api/tests/ai-eval-metrics.ts` (commit `9c94a25`, metric-name string
comparisons that the entropy heuristic reads as an assigned secret; the variable was
renamed since), one historical line of the `.gitleaksignore` file itself (commit
`d6c967d`), and one in `apps/web/e2e/console-health.spec.ts` (commit `8512382`, a
password-looking literal used as a deliberately wrong password; the current tree uses a
low-entropy placeholder). No credential is involved in any of them. Commit-pinned entries
cover only those historical snapshots and exempt nothing else, now or later. Re-review by
**2027-01-31**. (An initial path-scoped `.gitleaks.toml` allowlist was tried first and did
not suppress the findings under gitleaks 8.24.3; it was replaced by the fingerprint file.)

| Alert | Location | Severity | Why accepted | Compensating control | Review by |
|---|---|---|---|---|---|
| js/insufficient-password-hash | `apps/api/src/modules/payments/routes.ts` (`sslcommerzSignature`) | High (false positive) | The MD5 **is the SSLCommerz-mandated signature algorithm**: it hashes the gateway's store credential together with request parameters to sign/verify gateway API calls. It is not password storage, and the gateway offers no stronger option. | The credential lives only in env; the hash output is never logged (pino redaction), and webhook `verify_sign` comparison is constant-time | **2027-01-31** |
| AVD-DS-0002 (Trivy config) | `docker/web.Dockerfile` (nginx master runs as root) | High (accepted) | The stock `nginx:alpine` image runs its master as root to bind :80 and :443 and manage cache paths; switching to the unprivileged variant changes runtime ports/paths and is its own reviewed change. **Corrected 2026-11-10 (F-87):** the previous text described this container as serving static assets with *no secrets*, while `docker-compose.prod.yml` mounted a certificate directory for TLS that `docker/web.nginx.prod.conf` never listened on. The container now really does terminate TLS (`listen 443 ssl`, certs from `TLS_CERTS_DIR` mounted read-only at `/etc/nginx/tls`, port 80 redirects), so the waiver is re-accepted on the true cost: this root process holds the TLS private key | The container serves static assets and proxies `/api` only; no NEW_PRIVILEGED caps, no host PID/network; it is the only container publishing ports and the api/db network is internal; the certificate directory is a read-only mount and every location ships the shared security header set (`docker/nginx/security-headers.conf`); the API container is non-root; suppression is scoped to this one path in `.trivyignore.yaml` with the same expiry. Terminating TLS in a front proxy instead (no key in this container, only :80 published) is the documented alternative | **2027-01-31** |

Resolved by remediation (2026-09-15, no longer waived):
qs (GHSA via body-parser/express/superagent `~6.15.x`) and deepmerge-ts (`@prisma/config` chain)
were pulled to fixed versions via root `overrides` in `package.json`
(`qs@^6.16.0`, `deepmerge-ts@^8.0.0`); `npm audit --omit=dev` is now **0 findings**
and CI fails the build on any moderate+ production finding.

Rules:

- No waivers for runtime dependencies without staff-engineer + security-engineer sign-off.
- Dev-dependency waivers may be accepted by any engineer but still expire.
- On expiry: bump the package or renew the waiver with fresh justification — silent rollover is not allowed.
