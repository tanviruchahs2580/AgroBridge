# Verification receipt — web edge policy and delivery performance (2026-10-18)

Why this file exists: the numbers below were produced on a workstation. CI produces its own
(PR runs and the deploy gate assert the live headers); this records what was measured here and
what each guard does when it fails.

**Machine:** Windows 11 (win32 10.0.26300), Node 24.19.0, npm 11.17.0, Playwright (chromium)
**Baseline commit:** `6897e7b` (main after PR #31)

## 1. The gap this closed (measured against production)

`curl -sI https://agrobridge-web.vercel.app/` on 2026-10-18, before:

```
HTTP/1.1 200 OK
Accept-Ranges: bytes
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=0, must-revalidate
Content-Type: text/html; charset=utf-8
Server: Vercel
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Vercel-Cache: HIT
```

No `Content-Security-Policy`, no `X-Content-Type-Options`, no `X-Frame-Options`, no
`Referrer-Policy`, no `Permissions-Policy`, no `Cross-Origin-Opener-Policy` — on the origin that
runs the application's JavaScript and stores the tokens (ADR-0003). The API had all of them; the
SPA had HSTS and nothing else. Every hashed asset was also revalidated on every visit
(`max-age=0, must-revalidate` is Vercel's default for static files).

## 2. What ships now

Both `vercel.json` files (root and `apps/web`) carry the same policy — the repo root because the
Vercel project's root directory is the repository root, `apps/web` because the documented CLI flow
reads that one. Rationale per header: `docs/deployment.md` §7, decision: ADR-0008.

| Measured after the change | Value |
|---|---|
| `Content-Security-Policy` | `script-src 'self' 'sha256-YUcwMzZ0gx97FWbqxA9+Cavq+c8Ee6RP3CVy8jWZp00='` (the inline theme boot), `frame-ancestors 'none'`, `object-src 'none'`, `connect-src` naming the two API origins |
| `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` | `nosniff` / `DENY` / `no-referrer` |
| `Permissions-Policy` | `camera=(self), microphone=(), geolocation=(), payment=(), usb=()` |
| `/assets/*` cache | `public, max-age=31536000, immutable` |
| `/fonts`, `/icons`, `/images`, `/brand` cache | `public, max-age=604800, stale-while-revalidate=86400` |
| document / `version.json` / `sw.js` | still revalidating |

## 3. The CSP was verified in a real browser, not by reading the header

`dist/` served with the exact header set (minus `upgrade-insecure-requests`, which is a no-op over
https and would rewrite the local http subresources), driven by Playwright with a
`securitypolicyviolation` listener installed before any script ran:

| Check | Result |
|---|---|
| theme boot executed under `script-src 'self' 'sha256-…'` | `dataset.theme="light"` — the hash allowlist works |
| routes rendered (login, `/`, `/farm`, `/market`, `/services`, `/sell`, `/wallet`, `/orders`, `/notifications`, `/settings`, `/advisor`) | every one rendered real content (Home 885 chars, Services 1892 chars, …) |
| images | loaded on every route (`/services` 8/9 — one is the modal hero, not rendered until opened) |
| **CSP violations** | **0** across all routes |
| failing requests | exactly `/service-worker.js` (HEAD, 404) — the app's own probe, one per load; on Vercel the same 404 is logged. Cosmetic, and it disappears when a real service worker ships (roadmap P1) |

## 4. The trap this pass would have shipped, caught by its own preflight

After a rebuild, `preflight.mjs` failed:

```
✗ an inline script in the built index.html is NOT allowlisted by the CSP — it would be blocked in production.
     expected in script-src: sha256-Cql5D10Ad6TkJXetDkVqWFv5H2UBKYaZbbxZ+m9jxUQ=
     script-src currently: 'self' 'sha256-YUcwMzZ0gx97FWbqxA9+Cavq+c8Ee6RP3CVy8jWZp00='
```

The rebuilt script was 455 bytes instead of 445, because the working tree had **CRLF** endings
(`core.autocrlf=true` on Windows) while Vercel builds on Linux from LF bytes. The CSP hash that
passed locally would have blocked the theme boot in production — and the only symptom would be a
theme flash on every reload, which nothing alerts on.

Fixed at the root, not by editing the hash: `.gitattributes` now forces `eol=lf` for text files
(the index is already 100% LF, so this changes no committed content), and the preflight fails on
any CR byte in a built inline script with the re-checkout command in the message. Rebuild hash:
445 bytes → `sha256-YUcwMzZ0gx97FWbqxA9+Cavq+c8Ee6RP3CVy8jWZp00=`, matching what ships.

## 5. Delivery performance (measured, bytes)

| Item | Before | After |
|---|---|---|
| Bengali font files shipped | 14 files, **821,176 B** | 11 files, **498,016 B** |
| `noto-bengali-*.woff2` copies | 4 byte-identical files (md5 `a330372a…`), one referenced nowhere | 1 file, three weight faces pointing at it |
| font preloads in `index.html` | 4 (two of them the same 105 kB bytes under different names → 210 kB on the critical path) | 3, no duplicate |
| entry bundle (gzip) | 139.1 kB | 139.1 kB (unchanged; budgets cap it at 150 kB) |
| all JS (gzip) | 206.3 kB | 206.3 kB (budget 225 kB) |

Budgets are enforced by `preflight.mjs` in CI because the repo's Lighthouse config is
`workflow_dispatch`-only and never fails a build.

## 6. Frontend defects fixed (both found by the audit, both verified by test)

- **The offline toast appeared twice per queued mutation.** `offlineQueue.notifyEnqueue()` fired
  the React notifier *and* dispatched `agrobridge:offline-queued`; `App.tsx` subscribed to both.
  Nothing outside React listened to the event (its only subscriber was the test asserting it). One
  notification path now, and the test fails if an event is emitted again.
- **`/farms` had three cache identities** (`farms`, `services-farms`, `sell-crop-farms`) while
  `invalidate()` matches exactly — so a mutation through one name could not refresh the others, and
  nothing was visibly broken only because every screen remounts and refetches on navigation. All
  consumers now use `RESOURCE_KEYS.farms`, and `resourceKeys.test.ts` fails the build if a feature
  fetches `/farms` without it. Onboarding — which created the first farm with no invalidation at
  all — now invalidates the shared key.

Both guards were falsified before being kept: the resource-key guard fails naming
`services/Services.tsx` when the key is changed back, and passes when restored.

## 7. Local gates

| Gate | Result |
|---|---|
| `npm run lint` · `npm run i18n:check` | clean · 321 referenced / 527 declared / 0 missing |
| `npm run test:unit` | **127 passed** (126 + the resource-key guard) |
| `npm run build` + `npm run preflight` | clean; all eight preflight checks pass |
| `npx playwright test` (local stack) | **27/27 passed** (4.1 min) |
| functional sweep (local stack) | **39 passed / 0 failed / 0 skipped** |

**Deviation worth recording.** The first attempt at these two suites failed — 25/27 with a 30 s
timeout in the a11y scan and a primary-nav count of 0, and 37/39 in the sweep with an add-to-cart
button that resolved *disabled*. Both were produced by my own session, not by the change: the suites
ran while `npm run build` occupied the machine (the timeouts and the unrendered shell), and the
long-lived `dev.db` had been drained by the day's earlier runs (the disabled cart button — the first
product's stock was 0). Resetting the local database (`prisma migrate reset --force`) and re-running
with nothing else running gave the numbers above. The lesson is the repo's own: an e2e result is only
evidence when the environment is stated.

## 8. Post-merge live verification

Recorded in the final report of this pass: the deploy gate's header/cache assertions, the live
`curl -I` output, and the live UI check. The commit that lands this is on `main` with the gate
result attached.
