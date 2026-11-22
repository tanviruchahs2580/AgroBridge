# Knowledge-base review process (AIG-01 / OA-09)

The advisory KB lives in `apps/api/src/providers/ai/knowledge.ts` — 8 curated entries, every one
`UNSOURCED` today (2026-11-23). The owner's recorded policy (2026-11-22,
`docs/remediation-plan-2026-11.md` §2) is **serve-with-warning**: unsourced entries keep
contributing with the prominent unreviewed note + DAE-officer referral until an agronomist signs
off. This document is the process that sign-off follows; `assertKbReviewProvenance` (same file) is
the CI guard that makes a half-filled promotion impossible.

## Who reviews

An agronomist-grade reviewer (DAE officer, BARI/BADC agronomist, or university faculty) — the
owner arranges and records the reviewer's identity (OA-09). Engineering never reviews agronomy
content and never fills the provenance fields to unblock work.

## What a reviewer signs off, per entry

| Field | Requirement |
|---|---|
| `sourceName` | Human-readable title of the source the content came from (e.g. "DAE Fertilizer Recommendation Guide 2018, ch. 3") |
| `sourceUrl` | A **public** URL for that source (publisher page or document); `http(s)://`, non-empty |
| `reviewedAt` | The date the reviewer signed off, ISO-parseable |

Plus, in the PR description (not schema fields): the reviewer's name/affiliation, and the
**rights basis** for reproducing the material (public-domain government publication; quoted with
attribution; paraphrased from the reviewer's own professional knowledge). If no rights basis
exists, the content must be rewritten in the reviewer's own words before promotion.

## How an entry is promoted (the PR mechanics)

1. A PR edits the single entry in `knowledge.ts`: fills the three fields and flips
   `status: "UNSOURCED"` → `"REVIEWED"`.
2. CI runs `assertKbReviewProvenance` over the whole array (`tests/kb-review-promotion-guard.test.ts`):
   a `REVIEWED` entry missing any field, with a non-URL source, or with an unparseable date fails
   the suite naming the entry and the missing fields.
3. `kbVersion` (the string the `AiAnswer` carries as `groundedRefs`/`kbVersion` provenance) is
   **bumped in the same PR** — answers grounded in newly-reviewed content must be traceable to the
   version that carried it. Where `kbVersion` lives: `apps/api/src/providers/ai/gateway.ts`.
4. The unreviewed-treatment note is added by the engine **only** for `UNSOURCED` entries
   (`providers/ai/types.ts`: on a `REVIEWED` entry the note is not needed and not added) — so
   promotion changes the user-visible disclaimer automatically. Verify in
   `npm run eval:ai --workspace apps/api` that the entry's answers no longer carry the warning and
   still hit the groundedness thresholds.

## What promotion does NOT do

- It does not turn the advisory into a diagnosis: disease photos stay `PENDING_REVIEW` until an
  agronomist acts (AGENTS.md §5), and answers keep their confidence + field-verification framing.
- It does not change retrieval: keywords, weights and `RETRIEVAL_TOP_K` are content-independent
  and have their own reproducibility suite.
- It is not batch-able: each entry carries its own provenance; a "reviewed everything" claim with
  per-entry sources is exactly what the guard rejects.

## Current state and the path to G8

All 8 entries are `UNSOURCED` → gate G8 (agronomist sign-off on every treatment-bearing entry) is
open with the owner (OA-09). The agronomy review sheet (`docs/agronomy-review-sheet.md`) is the
per-entry worksheet the reviewer fills; the PR then transcribes it.
