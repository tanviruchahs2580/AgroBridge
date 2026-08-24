# Testing

Framework: **Vitest + Supertest** against the real Express app with a dedicated SQLite database
(migrations applied, demo seed loaded) — no mocks of the HTTP or DB layers.

```bash
cd apps/api
npx vitest run        # 64 tests
```

## Coverage by layer
- **Unit** — procurement price engine (grade multipliers, moisture deductions), membership discount,
  weather→agri-risk engine (spray/rain/heat/irrigation/fungal rules), crop lifecycle staging +
  bilingual calendar, KB retrieval & prompt-injection sanitization.
- **API / Integration / E2E journeys (Section 37 of the build brief):**
  1. Registration → login → profile (+ duplicate/weak-input rejection, refresh rotation, replayed
     refresh rejected).
  2. Farm → plot → crop with auto stage + planting record; second active crop rejected; plot area cap.
  3. Weather endpoint returns risks; invalid coords 400; auth required.
  4. AI agent: grounded answer w/ refs ≥0.7 confidence; unknown question flagged low-confidence with
     expert note; history persisted.
  5. Disease: valid JPEG queued PENDING_REVIEW (no fabricated diagnosis); non-image magic bytes
     rejected; farmer blocked from review; admin review notifies farmer.
  6. Marketplace: pagination/category filter; cart → checkout → stock decrement verified; delivery
     fee rule; empty-cart rejection; over-stock rejection; Silver-tier discount applied at checkout.
  7. Booking: provider-assigned creation, past-date rejection, RBAC on assign, rating only after
     completion, provider aggregate updated.
  8. Procurement: catalogue validation, auditable calculation asserted numerically, state machine
     transitions incl. invalid jumps, payout credits wallet + ledger entry.
  9. Sandbox payment intent+confirm marks order/booking paid (clearly labelled sandbox).
  10. Admin metrics from live queries; user search/suspend revokes access instantly; audit log records
      AUTH events; AI usage telemetry.
  11. RBAC: farmer 403s on assign/review/payout/admin endpoints.
  12. Notifications: generated on order events, unread counts, mark-all-read, cross-user isolation.
  13. Offline sync: identical `clientUuid` replays return the original row (single copy stored).

## Security baseline tests
Helmet headers present; unknown route structured 404; malformed JSON → 400 (not 500); oversized
payload → 413; forged JWT → 401; CORS does not reflect arbitrary origins.

## CI
`.github/workflows/ci.yml` runs lint, typecheck, the full test suite, web typecheck+build, Docker
image builds and `npm audit` on every push/PR to `main`/`develop`.
