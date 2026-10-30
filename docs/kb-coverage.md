# Knowledge-base coverage map (A2-02)

What the built-in agronomy corpus actually covers, and what it does **not**.
This document is verified against the code by
`apps/api/tests/kb-coverage-doc.test.ts`: every row must match a live
`KNOWLEDGE_BASE` entry (id, crop, title, provenance status) or the test fails.

## Entries

| Entry ID | Crop / topic | Language | Title (en) | Title (bn) | Provenance status | Reviewer sign-off |
| --- | --- | --- | --- | --- | --- | --- |
| `rice-blast` | rice — fungal leaf disease | en + bn | Rice blast / fungal leaf disease management | ধানের ব্লাস্ট / ছত্রাকজনিত পাতা-রোগ ব্যবস্থাপনা | UNSOURCED | none |
| `rice-urea` | rice — nutrition (urea schedule) | en + bn | Urea application schedule for rice | ধানে ইউরিয়া প্রয়োগের সময়সূচি | UNSOURCED | none |
| `wheat-rust` | wheat — rust disease | en + bn | Wheat rust disease | গমের রাস্ট (মরিচা) রোগ | UNSOURCED | none |
| `jute-stem-rot` | jute — stem rot / yellowing | en + bn | Jute stem rot & yellowing | পাটের কাণ্ড পচা ও হলুদ হয়ে যাওয়া | UNSOURCED | none |
| `mustard-aphid` | mustard — aphid control | en + bn | Mustard aphid control | সরিষার জাবপোকা দমন | UNSOURCED | none |
| `soil-test` | general — soil testing | en + bn | Soil testing guidance | মাটি পরীক্ষার নির্দেশিকা | UNSOURCED | none |
| `irrigation-general` | general — irrigation practice | en + bn | Irrigation best practice | সেচের সর্বোত্তম চর্চা | UNSOURCED | none |

**Provenance status**: `UNSOURCED` means no external source, rights basis or
agronomist sign-off has been recorded (see A2-01). Answers built on these
entries carry the review-pending note when they name or dose an input (A4-09).
Recording real sources and sign-offs is an owner/agronomist action — nothing
here is invented to fill the fields.

## Coverage claims and limits

- **No national coverage claim.** The corpus is a curated minimum-viable set
  for the crops above; it is explicitly *not* exhaustive.
- **Not covered at all**: vegetables, pulses, oilseeds other than mustard,
  fruits, livestock, fisheries, post-harvest storage, machinery and
  agrochemical product selection/registration.
- **Region/season**: no region-specific or crop-calendar data is encoded;
  entries state their own scope in text (e.g. the urea schedule names the
  Boro/Aus season) and the engine does not apply a universal rule beyond the
  retrieved entry.
- **Language**: every entry ships English and Bengali answer text; the Bengali
  titles are translations of the entry titles, authored with the entry.
- **Crop synonym matching**: aliases per crop live in `CROP_ALIASES`
  (`knowledge.ts`); a bare crop mention is weak evidence and can never ground
  an answer on its own (topical gate).

## Conflict, duplicate and staleness policy (A2-08)

- The corpus is **single-source and code-reviewed**: entries change only by
  commit, so duplicate ids are impossible by test and two conflicting variants
  of the same advice cannot coexist silently.
- Every answer carries the corpus content hash (`kbVersion`), so a silent edit
  is visible in stored advisory rows instead of untraceable (`A2-04`).
- Staleness is visible per entry: `reviewedAt: null` on all entries means none
  has ever been reviewed; the owner review is pending (A8-04).
- There is no runtime ingestion path, so no user-contributed content can enter
  the corpus or create unresolved priority conflicts (A7-04).
