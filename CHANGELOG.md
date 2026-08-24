# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com) ·
SemVer.

## [1.0.0] — 2026-08-25

### Added
- Modular-monolith API (Express + TypeScript strict): auth with rotating refresh tokens and
  immediate suspension revocation; 13-role server-side RBAC; zod validation on all routes.
- Farm domain: farms, plots, crop cycles (auto lifecycle staging + bilingual task calendar),
  auditable farm events with idempotent offline sync (`clientUuid`).
- Weather intelligence: provider abstraction (mock/OpenWeather) converting forecasts into
  agricultural advisories (spray/rain/heat/irrigation/fungal risk) in Bengali & English.
- AI Agro Agent: grounded offline engine over curated crop KB, confidence scoring with mandatory
  expert-verification notes, prompt-injection sanitization, OpenAI-compatible adapter with automatic
  fallback, usage telemetry + hourly rate limit.
- Disease detection intake: validated image upload queued for agronomist review (no fabricated
  diagnoses), admin review workflow with notifications.
- Marketplace: product catalog, cart, transactional checkout with stock decrement and
  membership-tier discounts; sandbox payment intents clearly labelled as sandbox.
- Service marketplace: bookings with provider assignment, lifecycle states, rating aggregation.
- Procurement: auditable grade/moisture pricing, QC→PO→collect state machine, wallet payout via
  double-entry-style ledger.
- Membership tiers configurable from DB (BRONZE/SILVER/GOLD benefits).
- Admin control tower: live metrics, user management with session revocation, audit log viewer,
  AI usage analytics. Append-only audit logging of security-relevant actions.
- Notifications module with unread counts and mark-read.
- Observability: /health, /ready, structured redacted logs, request IDs everywhere.
- Web app (React+Vite+Tailwind): farmer home dashboard, My Farm, AI advisor chat, marketplace/cart,
  services booking, sell-crop, wallet/membership, notifications, Bengali/English toggle,
  admin panel — mobile-first, large touch targets.
- Tests: 64 Vitest/Supertest tests covering unit logic and every critical user journey incl.
  security baseline; CI runs lint/typecheck/tests/docker builds/npm audit.
- Docker: multi-stage API image (non-root, healthcheck), nginx web image, compose stack.
- Documentation set under docs/ + SECURITY.md + .env.example.
