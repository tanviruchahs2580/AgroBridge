# Threat model — STRIDE per trust boundary (ARC-16)

Status: living document; each mitigation names the control that ENFORCES it (test,
gate, or code path) — a row without an enforcing control is a residual risk;
residuals are listed at the bottom. Rows marked (owner) need owner review.

## Assets
1. Farmer PII (phone, name, location) and auth material (password hashes, refresh tokens).
2. Money: wallet balances, ledger rows, payment intents/refunds.
3. Availability of the advisory surfaces farmers depend on in the field.

## Trust boundaries
`Internet → Edge/CDN → API instance → (DB | object storage | AI/weather/SMS vendors)`
and `App (WebView) → API`.

## STRIDE (condensed to the scored rows)

| # | Threat | Component | Mitigation (enforcing artifact) |
|---|---|---|---|
| S1 | Spoofed farmer JWT | API auth | HS256 allowlist + issuer check (`middleware/auth.ts`); `journey-auth` suite |
| S2 | Stolen refresh-token replay | auth | SHA-256 at rest, rotation + reuse-detection kills the token family (`journey-auth`) |
| S3 | Forged role claim | RBAC | role re-read from DB on every request (`auth-hot-path` specs) |
| T1 | Token theft from web storage | web | accepted risk (OD-02): CSP + webview hardening (`SEC-05`/`WEB-06`) (owner) |
| R1 | Admin repudiates suspension/role change | audit | append-only audit rows on every privileged action (`journey-admin`) |
| R2 | Money movement without an intent trail | payments | `PAYMENT_INTENT_CREATED` + refund audit rows (hardening-round11) |
| I1 | Reading another farmer's farms/orders/notifications | farmer routes | ownership scoping + cross-user negative suites (`cross-user-negative`, `tenant-isolation`) |
| I2 | SQL injection | DB layer | parameterised Prisma only; raw SQL is a parameterised tagged template (`auth-hot-path`) |
| I3 | Prompt-injection steering the agro agent | AI gateway | 51-case injection suite + grounded refs (`ai-prompt-injection`) |
| D1 | Brute-force login | auth | per-account limiter + per-credential global limiter (`rate-limit-keys`) |
| D2 | Upload storage exhaustion | disease | 30/hour upload limiter + 8 MB cap + MIME allowlist (`hardening-round11`, `disease-upload-hardening`) |
| E1 | Privilege escalation via role params | admin/RBAC | privilege boundaries + negatives (`rbac-fixes`, `security-matrix`) |
| E2 | Sandbox payments marking orders PAID in production | payments | fail-fast without the explicit production flag (`payments-integrity`) |

## Residual risks (accepted or owner-bound)
- **Uploads durability** (AUD-165, S1): uploads live on the instance disk until the
  object-store/DB rollout the owner gates; failure = loss of uploaded images on
  redeploy. No exfiltration path — the bucket would be private-read.
- **Knowledge-base sourcing** (AUD-127/128): advisory citations need agronomist
  sign-off (owner/expert).
- **Notification suppression is silent** (this branch): a disabled category is
  skipped without telling the user. Acceptable for badge-cosmetic categories and
  unreachable for CRITICAL while the prefs default stays `true` — the runbook row
  recording that invariant needs owner confirmation.
