# Exploratory charters

Plans, not results. Each charter defines a mission, the area to explore, a time box and the
heuristics to steer with. Nothing in this file is a finding; record what you observe in the defect
log below and attach the session evidence (screenshots, request ids from the `X-Request-Id`
response header, console output).

Defect log template (append one row per observation, keep the charter id):

```
| Date | Charter | Severity (S1–S4) | What happened | Steps to reproduce | Evidence (requestId / screenshot / receipt) |
|------|---------|------------------|---------------|--------------------|---------------------------------------------|
```

Session setup shared by all charters:

- API and web running locally per `README.md`; seeded demo data present (`npm run db:seed`).
- Prefer a throwaway account over the seeded demo accounts for state-changing sessions.
- Keep the browser console and the API log visible the whole time.
- Note: without loading a test instance, the login limiter is the production policy (20/15 min per
  IP) — plan repeated-login charters accordingly (`apps/api/src/modules/auth/routes.ts:34-45`).

## CH-01 — Login and OTP under hostile input

- **Mission:** break the login and OTP journeys without breaking the server.
- **Area:** Login, Register, Settings → Phone verification.
- **Time box:** 60 min.
- **Heuristics:** boundary values on the phone field (10/11/12 digits, `+880`, Bengali digits,
  spaces/dashes); wrong-but-valid numbers; password at 7/8/72/73 characters; submit while the
  request is in flight; back/forward around OTP; resend chains; expired-code path.
- **Watch for:** user enumeration (message or timing differences), lost form state, double-submit
  toasts, codes that leak into the UI outside development.

## CH-02 — Farm records: farm → plot → crop

- **Mission:** try to create records that should be impossible and find where the UI lies about it.
- **Area:** My Farm screens and their API routes.
- **Time box:** 90 min.
- **Heuristics:** zero/negative/enormous plot area; duplicate names; second active crop on one plot;
  decimal bigha; editing a plot under an active crop; deleting something referenced elsewhere;
  switching language mid-form.
- **Watch for:** stage/calendar claims that disagree with the planted date, orphaned tasks, and any
  place another account's data surfaces.

## CH-03 — Weather advisories and provenance

- **Mission:** prove that what the screen says about when the weather was fetched matches reality.
- **Area:** Home weather card, Weather screen, district settings.
- **Time box:** 45 min.
- **Heuristics:** district boundaries (typed district vs. farm district), repeated loads inside and
  outside the cache window (default 600 s, `apps/api/src/config/env.ts:45`), offline reload,
  provider-error path with the mock provider, language switch.
- **Watch for:** a "current" card that is silently old, missing as-of line, or a cached label that
  disappears.

## CH-04 — AI advisor: grounding, refusal, tone

- **Mission:** get the advisor to answer outside its knowledge or to sound more certain than it is.
- **Area:** AI Agro Agent (question input, history, feedback).
- **Time box:** 60 min.
- **Heuristics:** out-of-domain questions (weather for next month, human health, loans), mixed
  Bangla/English/Banglish, very long input, instruction-like text inside the question, rapid-fire
  questions against the 30/hour limit, feedback twice on one answer.
- **Watch for:** confident unsourced advice, missing low-confidence note, citations that do not
  match the answer, an unclear rate-limit message.

## CH-05 — Marketplace checkout: price, stock, double-submit

- **Mission:** make the total wrong or produce two orders from one intent.
- **Area:** Market, Cart, Checkout wizard, My Orders.
- **Time box:** 75 min.
- **Heuristics:** subtotal exactly BDT 5,000 vs. one paisa below (delivery-fee boundary,
  `apps/api/src/modules/marketplace/routes.ts:412`); qty at and above stock; parallel tabs
  submitting the same cart; back button mid-wizard; membership discount visible vs. applied;
  language switch on the review step.
- **Watch for:** totals that do not add up, discount shown but not applied, an order created twice,
  checkout that fails without telling the user what happened to the cart.

## CH-06 — Order cancel and delete: money-safe boundaries

- **Mission:** find a path that cancels something paid or restocks twice.
- **Area:** My Orders (cancel, delete), admin order view if available.
- **Time box:** 45 min.
- **Heuristics:** cancel unpaid; cancel twice quickly; cancel while payment is pending; delete a
  finished order; delete a paid order; act from two browsers at once.
- **Watch for:** stock restored twice, a paid order cancelled, error copy that hides what happened.

## CH-07 — Wallet withdrawal and holds

- **Mission:** move money that should not be movable, or get stuck with money that should be.
- **Area:** Wallet (balance, summary, withdrawals), admin withdrawal queue.
- **Time box:** 60 min.
- **Heuristics:** amounts at ৳99/৳100/available/exactly available+pending; two withdrawals from two
  sessions; unverified phone; approve twice; reject then re-request; month boundary display in
  Dhaka time (`apps/api/src/modules/payments/routes.ts:552-581`).
- **Watch for:** available balance that ignores a hold, double debit, a rejected request that keeps
  the money held, month figures that shift between languages or sessions.

## CH-08 — Settings, export and account deletion

- **Mission:** leave the account in a state the product cannot explain — or delete it while money
  is in motion.
- **Area:** Settings (profile, language, phone), My data export, Delete account, legal pages.
- **Time box:** 60 min.
- **Heuristics:** delete with a pending withdrawal; delete with an in-progress order; delete then
  sign in again; export and inspect the file (scope, password absence, open-in-new-tab behaviour);
  change phone fields mid-verification; toggle language on every settings screen.
- **Watch for:** half-deleted state, export containing another account's rows or a password hash,
  post-deletion login that shows a stale session or a misleading error.

## CH-09 — Offline queue in a real browser

- **Mission:** make the queue lie about what it saved.
- **Area:** Offline banner, queued mutations, toasts; use browser devtools offline mode and process
  suspension.
- **Time box:** 75 min.
- **Heuristics:** queue farm events and cart changes offline; close the tab before reconnect;
  reconnect; replay into a server-side conflict (edit the same record in another session first);
  expiry of the access token while entries are queued; private-mode storage restrictions; storage
  quota pressure.
- **Watch for:** silent loss, duplicate application, a queue badge that disagrees with the entries
  actually replayed, checkout that gets queued (`/orders/checkout` must never be queued —
  `apps/web/src/lib/offlineQueue.ts:25`).

## CH-10 — Service booking lifecycle and providers

- **Mission:** get work started or completed by the wrong actor.
- **Area:** Services (catalog, booking wizard), My Bookings, provider/admin transitions.
- **Time box:** 60 min.
- **Heuristics:** book a per-bigha and a flat-unit service and compare the estimate (rule in
  `apps/api/src/modules/services/routes.ts:117-122`); schedule in the past/now; pick an incompatible
  provider; two providers accepting at once; cancel from REQUESTED/ASSIGNED/IN_PROGRESS; rate a
  booking twice; rate before completion.
- **Watch for:** estimates that ignore the unit, transitions by the wrong role, ratings that count
  twice, cancel copy that does not match the resulting state.

## Charter hygiene

- One charter per session when possible; if you stop early, stop the clock and say so in the log.
- Findings go to the defect log with a reproducible path and evidence; unresolved questions about
  expected behaviour go to the owner instead of being filed as defects.
- Re-run a charter after any change to its area; charters are cheap to repeat, assumptions are not.
