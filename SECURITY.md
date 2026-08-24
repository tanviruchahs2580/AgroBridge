# Security Policy

## Supported versions
| Version | Support |
|---|---|
| main branch | active development — security fixes land here first |

## Reporting a vulnerability
**Do not open public issues for security problems.**

Contact: **security@agrobridge.example** (replace with your operational mailbox before launch) with:
- description and impact
- reproduction steps or PoC
- affected endpoints/commits

You will receive an acknowledgement within 72 hours and a fix timeline within 7 days.
We credit reporters in the release notes unless anonymity is requested.

## Handling rules for maintainers
1. Reproduce → assess severity (CVSS) → patch on a private branch.
2. Add regression tests covering the vulnerability.
3. Release patch + `CHANGELOG.md` security entry; notify affected deployers.

## Hardening expectations for operators
- Unique 64-char JWT secrets per environment; rotate quarterly.
- TLS termination in front of both API and web tiers; HSTS enabled at the proxy.
- Restrict database network access to the API service only.
- Review `/admin/audit-logs` weekly during early operations.
