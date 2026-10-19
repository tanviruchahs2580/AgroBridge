# ADR-0009 — Offline write queueing: allow-listed endpoints, client-generated idempotency, owner-scoped replay

- Status: accepted
- Date: 2026-10-18
- Deciders: engineering; decision documented from the shipped implementation during the 2026-10-18 architecture audit

## Context

The app targets intermittent 3G-class connections, and a farmer recording a farm event or updating
a cart must not lose that write when the network drops. Two models were possible:

1. **Offline app shell** — a service worker caches the UI and queues everything. This repository
   deliberately has no service worker (see ADR-0008 and `apps/web/public/sw.js`, which exists only
   as a kill switch for the workbox SW the app once shipped), so this path does not exist.
2. **Write queueing in the data layer** — a small, explicit queue in front of a deliberately
   narrow set of endpoints, with the server owning idempotency. This is what shipped:
   `apps/web/src/lib/offlineQueue.ts` + `apps/web/src/lib/api.ts`.

The design constraints that shaped it: a replayed mutation must never double-apply (checkout, in
particular, is not idempotent), a stale replay must not overwrite newer server state, and a queue
entry must not become a way to read or clobber another user's row.

## Decision

1. **Allow-list, method-aware.** Only `POST`/`PATCH`/`DELETE` requests whose URL matches `/events`,
   `/cart` or `/orders` are queued (`isQueueable`, offlineQueue.ts). Reads are never queued —
   replaying a GET later would send stale input as if it were work. `/orders/checkout` is
   explicitly excluded by `NEVER_QUEUE`: a manual retry after a queued attempt would create a
   second order and decrement stock twice.
2. **Client-generated idempotency token.** Each entry carries a `clientUuid` (WebCrypto
   `randomUUID`, with a timestamp+counter fallback — never `Math.random`, an earlier audit
   finding). Dedupe is by `clientUuid` first; auto-generated entries also compare a small
   payload hash (`payloadHash`) so the same mutation queued twice offline collapses to one row.
   The hash is a dedupe heuristic (the current implementation is djb2; the file's header comment
   says SHA-256 and is wrong — recorded here so the discrepancy is not rediscovered as a bug),
   not a security primitive.
3. **Server-side, owner-scoped replay.** `POST /farms/:id/events` looks up
   `{ clientUuid, farmId, actorId }` (apps/api/src/modules/farms/routes.ts) and returns the
   caller's already-stored event for that UUID. Owner scoping is part of the contract: an earlier
   global lookup let anyone who knew another user's `clientUuid` read their event row as a
   "replay" (AUD-101 / B-09 fix).
4. **Conflict policy: the server wins, collisions are refused.** A replayed write returns the
   stored row — the client's copy is never merged over newer server state. If creation hits the
   unique `clientUuid` constraint (`P2002`), the row cannot belong to this actor (their own replay
   returned above), so the API answers 409 conflict instead of echoing someone else's row.
5. **Replay lifecycle.** `flushAll()` replays in queue order on the `online` event and app boot:
   success removes the entry; network/timeout/5xx keeps it for the next flush; 401/403 is
   re-queued once and dropped on the second strike; any other 4xx is dropped immediately (it will
   never succeed) and the user gets a bilingual "this write is gone" toast instead of a silent
   console warning. Behavior is locked by `offlineQueue.test.ts` and the API side by
   `farm-event-sync-scoping.test.ts`.

## Consequences

- Losing connectivity degrades to "your change is saved and will be sent" for exactly the three
  families above. Everything else fails in the moment with a normal error — honest, and it keeps
  the queue from becoming a half-implemented sync engine.
- The queue is client-local (localStorage per device): reinstalling the app or clearing site data
  loses pending writes. There is no server-side queue to fall back on (ADR-0010).
- Every new queueable endpoint must accept `clientUuid` and implement owner-scoped replay before
  it is added to the allow-list; the allow-list is the gate, not an invitation.
- The `queueable` surface is intentionally tiny: farm events, cart mutations, order-sync
  endpoints. Broadening it is a design decision (this ADR), not a config change.

## Amendment — 2026-10-19

The original decision treated the queue as device-scoped state. In practice the device is
often shared — a family or a shop phone in the markets this app targets — and the queue
outlived the session that filled it: a mutation queued by one account replayed under the
next account that signed in, and an entry could sit in localStorage indefinitely. Four
changes, all in `apps/web/src/lib/offlineQueue.ts`, close that gap.

1. **Session-scoped entries.** Every entry carries `queuedAt` (epoch ms) and `ownerId`
   (the queueing user's `userId`, `""` when no session was known). Enqueue stamps both
   from `sessionManager.getSession()`; the dependency is one-way (the queue reads the
   manager, never the reverse). Entries persisted before this change are stamped on
   first load and the upgrade is written back — their age cannot be reconstructed, so
   they start their window then rather than being dropped by the migration.
2. **The queue does not outlive its session.** A subscription purges the queue
   (`purgeQueue(reason)`) when the signed-in identity changes or the session ends. Losing
   queued work on logout is the deliberate trade: replaying it under whoever signs in
   next is worse than dropping it. "Session ends" is read as *tokens cleared first*, which
   is how every real logout/expiry path in `session.tsx` is written — a boot that merely
   could not confirm the session offline keeps its tokens (so the user is not logged out)
   and therefore keeps its queue, which is the case the queue exists for. The flush
   screens entries again before any request leaves the device — an entry owned by another
   account is dropped (status 0, outcome `discarded`) — as a backstop for the paths where
   the purge could not fire (e.g. a cold boot straight into a different session).
3. **A 72 h replay window, visible to the user.** Entries older than 72 h are dropped at
   flush time with the new `DropOutcome` `"expired"` and their own bilingual toast copy.
   A days-old write applied blind (crop stage, stock, prices have moved) is stale data
   winning over what the user sees now.
4. **Persistence failures are reported, not swallowed.** `save()` no longer discards the
   queue silently when localStorage rejects the write (quota/private mode): the list is
   kept in memory for the tab, `onStorageError` fires with `{ keptInMemory: true }`,
   `storageDegraded()` reports the state, and App.tsx raises an error toast. A later
   successful write retires the fallback.

Behavior is locked by the added cases in `offlineQueue.test.ts` (legacy stamping, purge
on switch, purge on logout, TTL expiry, foreign-owner skip, storage-error notification);
the 38 pre-existing cases are unchanged. The consequences in the main section still
hold — the queue remains client-local and is still lost on reinstall or site-data clear —
but it is no longer lost *silently*, and it can no longer leak across accounts on the
same device.
