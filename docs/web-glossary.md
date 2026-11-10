# bn/en product glossary (WEB-04) — SUPERSEDED (2026-11-10)

**This file is retired.** Its premise was that a single table could fix "WHICH word a concept maps
to, so the same English idea **never oscillates** between two Bengali words across screens" — and
its own repository falsified it: it named Farm → খামার while the dictionary rendered "আমার ফার্ম"
(`myFarm`), and the two glossaries then disagreed on Farm, Plot and Crop cycle. Two tables claiming
canonical status is a drift generator, so:

**→ The single authority is [glossary-bn-en.md](glossary-bn-en.md).**

That glossary quotes the dictionary verbatim with the exact i18n key for every row, lists the
places where the dictionary itself used more than one word instead of smoothing them over, and
carries the native-speaker review status.

Reconciliation recorded here for the decision trail (F-55/F-93,
`docs/audit/2026-11-10-full-qa-audit.md`): the web stream standardised **Farm → খামার** across the
dictionary on 2026-11-10 (`grep -c ফার্ম apps/web/src/lib/i18n.ts` → 0), superseding this file's
row too. The Plot and Crop-cycle disagreements were resolved in favour of the
`glossary-bn-en.md` rows.
