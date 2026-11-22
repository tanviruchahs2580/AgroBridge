# DR-04 — Offline reads for the field

Status: **open decision (owner)** · ADR-0008/0009 bind (the service worker is a deliberate kill
switch) · Phase A memo — no code until approved · Recorded: 2026-11-23 (WP-21)

## The gap (CLI-01)

Offline today = writes only: the allow-listed write queue (`lib/offlineQueue.ts`,
`clientUuid`-keyed, owner-scoped replay, checkout explicitly never queued) survives a dead zone,
but every screen shows a spinner until the network returns. A farmer in a low-signal district
cannot see the last-known weather, their farm list, or the crop calendar offline.

## Proposed design (when approved)

- **An IndexedDB cache inside the data layer** — not a service worker. ADR-0008 removed the SW
  deliberately and `AGENTS.md` §11 gates re-enabling; the cache belongs to the existing
  `useResource` layer (ADR-0002's hand-rolled data layer), which is where staleness rules are
  already expressible.
- Whitelist GET resources only: last-known weather, farms list, crop calendar. **Never** money or
  admin surfaces.
- Per-user scoped (keyed by the session's userId), cleared on logout and account deletion
  (data-protection discipline), size-capped, schema-versioned so an upgrade invalidates cleanly.
- Staleness shown in the UI: a bilingual "offline — showing data from HH:mm" line, not silent
  stale data.
- Move the write queue from `localStorage` to IndexedDB in the same change to escape the 5 MB cap
  while preserving ADR-0009's allow-list and replay semantics (`fake-indexeddb` for tests).

## What this deliberately does not do

- No service worker, no app shell caching, no background sync API — those are new ADRs (§11).
- No offline writes beyond the existing allow-list.

## Decision requested

Approve the IndexedDB-cache design (or the alternative: re-introduce a service worker as a new
ADR — not recommended).
