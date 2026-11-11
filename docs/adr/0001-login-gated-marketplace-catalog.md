# ADR-0001 — Marketplace catalog is login-gated by design

- Status: accepted
- Date: 2026-09-15
- Deciders: QA audit (this engagement), product owner (implicit: frontend already redirects all routes to /login)

## Context

`GET /api/v1/products` requires authentication (`productsRouter.use(requireAuth)`). An earlier
sub-audit flagged this as an availability/UX defect ("anonymous visitors cannot browse the
market"). Verification against the frontend showed the SPA guards **every** route
(`App.tsx` → `if (!session) return <Navigate to="/login" …/>`), so an anonymous visitor can
never reach a product list in the current product design. The platform's commercial flow is
dealer-onboarding-gated: prices are B2B and not published publicly.

## Decision

Keep the catalog login-gated. The backend requirement is consistent with the intended UX and
is the safer default (no scraping of price/stock data without an identity).

If a public marketing/catalog landing page is ever introduced, this ADR must be revisited and
`GET /products` (list + detail, read-only, field-limited) un-gated with a dedicated anonymous
rate limiter.

## Consequences

- Documented; no code change. Prevents "fixing" a non-defect and silently weakening the
  security boundary.
