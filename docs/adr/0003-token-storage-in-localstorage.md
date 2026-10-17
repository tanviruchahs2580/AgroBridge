# ADR-0003 — Access and refresh tokens persist in localStorage

- Status: accepted (accepted risk with compensating controls)
- Date: 2026-10-18
- Deciders: engineering; decision already in force, recorded by the Phase 4 quality review

## Context

`apps/web/src/lib/sessionManager.ts` is the single owner of auth state. It reads and writes
`ab_at` (access token), `ab_rt` (refresh token) and `ab_session` (profile) in
`window.localStorage`, keeps in-memory mirrors hydrated once at module load, and synchronises
across tabs through `BroadcastChannel("agrobridge:session")` plus the `storage` event. The two
former token owners (`api.ts` module variables and a direct `localStorage` read in
`session.tsx`) were consolidated into it to kill a dual-truth bug (stale token in one path while
the other read storage); all other modules go through `getTokens` / `setTokens` /
`clearTokens` / `onChange`.

The exposure this accepts: **any script running on the web origin can read both tokens.**
localStorage has no protection against XSS. An injected script (or a malicious/compromised
dependency) can exfiltrate the refresh token — valid 7 days by default and rotating — or the
15-minute access token. Tokens in `httpOnly` cookies would be unreadable from JavaScript and
could additionally carry `SameSite` / `Secure` restrictions. The web app is a static bundle
served by Vercel with no CSP `script-src` restriction in `index.html`, so the compensating
control for XSS is code review and dependency hygiene, not a hardened script policy.

Why it was accepted for this client:

- **Cross-origin by architecture.** The SPA is served from a different host than the API
  (separate Vercel projects), and inside the Capacitor app the WebView origin is
  `https://localhost` / `capacitor://localhost` (see the `WEB_ORIGIN` allow-list in
  `apps/api/src/config/env.ts`). Cookies in that position are third-party, need
  `SameSite=None; Secure` + credentialed CORS, and are exactly what browser third-party-cookie
  restrictions keep breaking — a fragile path for a login that must also work in a WebView and
  in an installed PWA.
- **Persistent access without a server round trip.** The offline queue (`lib/offlineQueue.ts`)
  replays queued mutations after reconnect, including after a cold start; a token stored in
  localStorage is the only thing that survives an app restart without a cookie jar the WebView
  does not reliably persist.
- **The token lifecycle is already defensive.** Access TTL is 15 minutes
  (`ACCESS_TOKEN_TTL` default), refresh tokens are stored server-side as SHA-256 hashes with
  rotation and revocation, suspension/role change revokes every refresh token immediately, and
  `requireAuth` re-validates account status per request. A stolen access token has a small
  window; a stolen refresh token is detectable on rotation.

## Decision

Keep token persistence in localStorage for the Capacitor/PWA client, with the existing
mitigations (short access TTL, rotating hashed refresh tokens, immediate server-side revocation,
uniform errors, cross-tab logout, tokens cleared on a definitive 401). Record this as an
accepted risk, not a hidden one.

## Migration trigger — when to move to httpOnly cookies

Move when **both** are feasible:

1. The web app and API share a first-party origin — e.g. the SPA is served behind the same
   domain or the same origin proxy as the API — so cookies can be `Secure` and `SameSite=Lax`
   instead of third-party; and
2. The cookie path can carry its own CSRF strategy (double-submit token or a custom header on
   every mutating request).

Any change here must also rework: the cross-tab logout broadcast (cookie changes are invisible
to `storage` events), the offline queue's access to a token at replay time, and the Capacitor
WebView session lifecycle. Until then, cookie auth would trade a real XSS read for a broken
login on the primary client.

## Consequences

- XSS on the web origin is a session-theft class bug; security review must treat script
  injection findings in `apps/web` as P0.
- The API stays stateless bearer-token auth, which also serves the APK and any future clients
  without cookie plumbing.
- `sessionManager.ts` is the enforcement point: a migration only has to change this module plus
  the API's token delivery, not every call site.
