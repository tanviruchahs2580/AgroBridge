# Agronomy & Bangla review sheet (owner-commissioned)

Two audits cannot be performed by an engineering agent, and this repository must not pretend
otherwise: **agronomic validation** of what the AI layer can say, and a **native-Bangla
review** of the farmer-facing copy. This sheet turns both into a concrete, recordable task.
Until the reviews are recorded here (or in a linked document), treat the relevant features as
*unvalidated* and keep the in-app disclaimers as they are.

## 1. Knowledge base validation (needs a Bangladesh agronomist)

Source of truth: `apps/api/src/providers/ai/knowledge.ts` — seven hand-authored bilingual
entries, each carrying a `sources` ledger currently marked **UNSOURCED** (no publisher, URL,
edition or date exists yet; nothing was invented to fill the fields).

For each entry (ids: crop/plant-protection entries — rice blast, rice stem borer, wheat rust,
potato late blight, jute stem rot, mustard aphid, plus the two general entries):

- [ ] Confirm the advice is correct for Bangladesh conditions (variety, season, region).
- [ ] Provide at least one authoritative source per entry (e.g. DAE / BARI / BRRI / SRDI
      publication or extension material): publisher, title, edition/year, URL or ISBN.
- [ ] Replace `status: "UNSOURCED"` with the recorded source; update the ledger fields.
- [ ] Flag any statement that must carry a scope caveat (e.g. doses, resistant varieties).
- [ ] Mark entries that should be removed as superseded.

Owner decision required first: **licensing/permission** for the chosen sources (see the
audit's AUD-127).

## 2. Evaluation-set review (same reviewer, lighter pass)

- Set: `apps/api/tests/fixtures/ai-eval/questions.json` (109 synthetic items, each flagged
  `"synthetic": true, "reviewedBy": null`). Run: `npm run eval:ai` in `apps/api`.
- [ ] Spot-check ~20 grounded items: is the expected KB reference actually the right answer?
- [ ] Spot-check the 47 abstain items: is abstaining correct, or is a safe answer possible?
- [ ] Spot-check the 33 safety items: is "abstain or refer to an agronomist" the right bar?
- [ ] Record `reviewedBy` + date per reviewed item and re-run the harness.

## 3. Native-Bangla copy review (needs a native speaker, no engineering background)

Walk the app in Bangla (demo login in README) with a phone-width browser and a screen reader
if possible. Flag: wrong crop/market terms, mixed-script leftovers, awkward register,
inconsistent units, unclear error copy.

Priority screens and strings (all localised in `apps/web/src/lib/i18n.ts`):

- [ ] Login/Register + validation and error messages (`errorsUi.*`, `auth*` keys).
- [ ] Home (greeting, today-tasks, weather as-of line) and My Farm (care suggestions,
      stage labels — `myFarm.*`, `stageLabel` map).
- [ ] Advisor: disclaimer, support band wording, provider-mode line, report-an-issue flow.
- [ ] Marketplace/checkout: prices, units (কেজি/মণ/বিঘা), sandbox notice, receipts.
- [ ] Sell-crop/procurement and Wallet: quantities, grades (A/B/C), payout wording.
- [ ] Settings: export/delete-account copy; legal pages (already long-form Bangla).

Record results as a PR or an issue list with screenshots. Crash-course for reviewers: the
app defaults to Bangla; the EN button in the header toggles.

## 4. What remains blocked on credentials/infrastructure (not reviewer tasks)

- Live AI / live weather / live SSLCommerz validation (no test credentials exist — AUD-132).
- Production backup/PITR and load rehearsal (no production infrastructure access — AUD-133).
