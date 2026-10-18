# ADR-0008 — The static site carries its own edge policy, kept honest by a build-time preflight

- Status: accepted
- Date: 2026-10-18
- Deciders: engineering; decision forced by the 2026-10-18 architecture audit

## Context

The API has been hardened since its first deploy: helmet sets a CSP, HSTS, COOP/CORP, `nosniff`,
`X-Frame-Options` and `Referrer-Policy`, and `security-observability.test.ts` asserts they stay.

The **static site had none of that**. Measured against production on 2026-10-18, the SPA answered
with `Content-Type`, `ETag`, `Cache-Control: public, max-age=0, must-revalidate`, `Server: Vercel`
and HSTS — nothing else. No CSP, no `nosniff`, no frame or referrer policy. That is the origin that
runs the application's JavaScript and where the access and refresh tokens live (ADR-0003), i.e. the
one an injected script would want. The same responses revalidated every hashed asset on every visit,
so the cached-shell case cost a round trip per chunk on the 3G-class connections this app targets.

Two structural facts made a naive fix unsafe:

1. **Two deploy paths read two different config files.** The Vercel Git integration uses the
   repo-root `vercel.json` (the project's root directory is the repository root); the documented CLI
   flow uses `apps/web/vercel.json`. A policy added to one path and not the other is a policy that
   silently disappears depending on who deployed.
2. **A strict CSP breaks an inline script.** `index.html` boots the persisted theme before first
   paint, and it is inline on purpose: an external file is a render-blocking round trip before first
   paint. Under `script-src 'self'` that script is blocked — the app still works, the theme just
   flashes on every reload, which is precisely the kind of failure nobody reports.

## Decision

1. **Both Vercel configs carry the same header set**: CSP, `X-Content-Type-Options: nosniff`,
   `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`
   (`camera=(self)`, everything else denied), `Cross-Origin-Opener-Policy: same-origin`, HSTS.
2. **The inline theme boot stays inline and is allowlisted by SHA-256 hash.** The policy keeps
   `script-src 'self' 'sha256-…'` with no `'unsafe-inline'`. `style-src` keeps `'unsafe-inline'`
   because the UI sets inline styles at runtime (framer-motion); tightening that is a separate,
   verifiable step, not a ride-along.
3. **`connect-src` names the API origins explicitly** (`'self'` plus the two production API
   hostnames). Never a wildcard: the browser refuses the API call if the origin is wrong, so the
   list is a deliberate, reviewable coupling between the bundle's `VITE_API_BASE_URL` and the
   policy.
4. **Hashed assets are immutable, the shell revalidates.** `/assets/*` is
   `max-age=31536000, immutable`; `/fonts`, `/icons`, `/images`, `/brand` are a week with
   `stale-while-revalidate`; the document, `version.json` and `sw.js` keep Vercel's revalidating
   default so a client can always learn about a new bundle.
5. **A build-time preflight enforces the coupling** (`apps/web/scripts/preflight.mjs`, wired into
   the `web-quality` CI job and the `web` deploy gate):
   - recomputes the inline script's hash from the **built** HTML and requires it in both configs;
   - requires the API origin in `.env.production` to appear in `connect-src`;
   - requires both configs' header sets to be byte-identical;
   - enforces byte budgets for the entry bundle, total JS/CSS gzip, fonts and images.
   `deploy-verify.yml` independently asserts the live headers and the cache split after every push
   to `main`, so the policy is verified where it matters and not only where it is written.

## Consequences

- The SPA's edge posture is now comparable to the API's, and drops in it fail a gate rather than
  going unnoticed — the same failure mode the schema had before ADR-0007.
- The hash coupling adds a real maintenance step (edit the inline script → update two configs), and
  it is caught by tooling in the same run that would otherwise ship it broken. The alternative —
  moving the script out of line — was rejected to keep first paint free of an extra round trip.
- The budgets are deliberately loose enough for ordinary refactors and tight enough to catch a
  regression of the kind this pass fixed (four byte-identical Bengali font files, two of them
  preloaded, ~343 kB of shipped bytes).
- `Permissions-Policy: camera=(self)` is narrower than the app's current behaviour (the `<input
  capture>` intake is same-origin) but wider than `camera=()` would be; a future getUserMedia
  feature works without a policy change, a third-party frame cannot ask at all.
