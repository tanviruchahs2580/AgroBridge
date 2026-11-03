# UI copy — what the product is allowed to say

> **Owner:** engineering · **Applies to:** every user-visible string in `apps/web` · **Enforced by:**
> `src/lib/i18n.deadkeys.test.ts` (no marketing-shaped keys), `scripts/i18n-check.mjs` (every key used,
> every used key defined, no inline `lang === "bn" ? "…" : "…"` copy)

The interface has four jobs: **say what is here, say what just happened, say what the user can do,
and say what went wrong.** Anything that is not one of those four is not copy — it is decoration,
and it goes in the layout or nowhere.

The reference points are Linear and Apple Notes: a screen shows *state* and *actions*, and it
assumes the person looking at it can read. Neither product explains itself, greets you twice, or
tells you that its marketplace has fair prices.

## The test to apply before adding a string

Read the string back to yourself and ask: **if it were gone, what would the user do differently or
know less?** If the answer is nothing, do not add it. If the answer is "they wouldn't know why the
screen is asking for this", the fix is usually the layout — a label, a heading, a button — not a
sentence underneath it.

## What is copy

| Kind | Example | Where it lives |
|---|---|---|
| **Label** — names a control, a field, a column | `netPayable`, `withdrawMethodLabel` | next to the thing it names |
| **State** — what is true right now | `noActiveCrops`, `farmDataUnavailable`, `statusSHIPPED` | as the heading of the region it describes |
| **Outcome** — what just happened | `saved`, `bookingReceivedToast`, `queuedChangeDropped` | toast or inline, once |
| **Constraint** — a rule the user cannot infer | `passwordHint` (8 characters), `withdrawMinNote` (৳100), `withdrawAvailable` | attached to the control it constrains |
| **Error** — what failed and what to do | `errRateLimited`, `errInsufficientBalance` | at the field, or in the banner |
| **Disclosure** — required by law or by honesty | `advisoryDisclaimer`, `deleteAccountWarning`, `sandboxPaymentNote` | plain, complete, not shortened for looks |

## What is not copy

- **Taglines.** "AI in every farmer's hand" belongs on a store listing, not under the app name in a
  header the user sees on every screen.
- **Restatements of the title.** "Settings / Profile, phone verification and account" says the word
  twice. `PageHeader` has no `subtitle` prop for this reason.
- **Restatements of an action.** "Fix the highlighted errors and try again", under the errors that
  are highlighted. The button and the field messages already said it.
- **Restatements of an empty state.** "No orders yet" plus "You don't have any orders yet" is one
  fact and two sentences. `EmptyState` has no `description` prop for this reason.
- **Sub-lines under labels.** "Services / Drone, Tractor, Harvester" — the four tiles named four
  services and then described them again. If a tile is too wide for its label, the tile is the
  problem: the Home quick actions became icon-over-label for exactly this reason.
- **Marketing sections on utility screens.** A "How it works" (three steps describing the dialog the
  next tap opens), a "Why AgroBridge" (three claims the client cannot evidence), and a closing CTA
  used to sit under the services catalogue. They were removed; the catalogue is the product.
- **Fabricated content.** Eight per-category "fallback descriptions" were printed on service cards
  as though the provider had written them. A service with no description now shows none.

## When a removal makes a screen hard to read

The instruction is *fix the layout*, not *put the sentence back*. Worked examples from the pass
that introduced this file:

| Was | Now |
|---|---|
| A "Farm readiness" pill, a state headline, and a sentence explaining the state, beside a bare `87%` ring | The state headline, the ring, and a three-word caption inside the ring that names what it measures (`farmReadiness`, or `farmReadinessBasisNoWeather` when the weather read failed) |
| Four quick-action tiles, each with a label and a sub-line | Four tiles, icon over label, centred — the shape fits the shorter content |
| A district/upazila form with a sentence about what the fields are used for | The same form with a three-word caption (`districtWeatherHintShort`) beside the fields |
| A "details ›" span styled like a link next to a real "View plots" button | The button alone |

## Honesty rules that outrank brevity

Removing a sentence is never a reason to remove a claim. Two cases where the longer string stays:

- **A state the app cannot see must say so.** `farmDataUnavailable` exists because an empty farm
  array is both "no farms" and "the request failed", and the screen used to show the empty copy for
  both. `unreadCountUnavailable`, `weatherUnavailable`, `alertsUnavailable` are the same shape.
- **A basis claim must name its basis.** `farmReadinessBasisNoWeather` says the readiness number was
  computed without weather, because that is what happened.

## Mechanics

- Every string lives in `apps/web/src/lib/i18n.ts` with `bn` and `en`. Inline
  `lang === "bn" ? "…" : "…"` in a component fails `npm run i18n:check --workspace apps/web`
  (hard-zero ratchet).
- A key that nothing references fails the unit suite. Adding a key "just in case" is not possible.
- A key whose *name* is marketing-shaped (`tagline`, `hero*`, `promo`, `slogan`) fails the same
  suite — the rule above, made mechanical.
- Enum values (`status*`, `role*`, `svc*`, `stage*`, `careTask*`) are labels, not prose; keep them
  noun-shaped and parallel across languages.
