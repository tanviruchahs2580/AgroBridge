# AI Agro Agent

## Pipeline (per request)
```
Question → sanitize (strip code fences, role prefixes, [INST]-style markers, angle brackets; ≤1000 chars)
        → context extraction (farmer, active crop + stage, district)
        → provider gateway
             ├── offline-agro-engine (default): grounded retrieval over curated KB
             └── openai-compatible adapter: KB entries injected as clearly-delimited
                 reference data, hardened system prompt, refuse-if-insufficient instruction
        → confidence scoring → low-confidence ⇒ expert-verification note appended
        → persistence (AdvisoryQuery) + usage telemetry (AiUsageLog)
```

The adapter supports an optional weather line in the prompt, but **no caller populates
`weatherSummary` today** — the branch is reserved/unimplemented, not a live feature. The
district and crop-stage fields are populated; the retrieval step does not condition advice
on them.

## Guarantees
1. **Grounded or honest.** The offline engine answers only from the knowledge base
   (`src/providers/ai/knowledge.ts` — rice blast/urea schedule, wheat rust, mustard aphid, jute rot,
   soil testing, irrigation). Unknown questions return low confidence with explicit guidance to
   consult an agronomist. Tests assert both behaviours.
2. **No dangerous actions from chat.** The agent never places orders/payments/bookings; those require
   explicit API flows by the authenticated user.
3. **Provider independence, with precise failure semantics.** `AIProvider` interface; set
   `AI_PROVIDER=openai-compatible` + `OPENAI_API_KEY` to enable an LLM. On a provider failure the
   gateway serves the offline engine **outside production only**; in production it marks AI down and
   returns `502 AI_PROVIDER_UNAVAILABLE` — it never silently degrades to fixed answers. The adapter
   itself classifies failures (429 rate limit / 5xx upstream / empty content / `content_filter` /
   truncated `length` / timeout) and retries at most once for 429/5xx.
4. **Observability & cost control.** Every call logs provider/model/latency/success to `AiUsageLog`;
   admin endpoint `/admin/ai-usage` aggregates. Rate limit 30 req/h/user on advisory.
5. **Injection resistance.** Code fences, role prefixes, `[INST]/[SYS]` markers and angle brackets
   are stripped from user text; the LLM prompt keeps the user turn in the user role and fences all
   retrieved KB text as untrusted reference data the model must not follow as instructions.
   `tests/ai-prompt-injection.test.ts` drives 51 cases across ten attack categories.
6. **Evaluation gate.** `tests/ai-eval-harness.test.ts` runs a frozen, synthetic, 100+ item held-out
   set (`tests/fixtures/ai-eval/questions.json`) through the offline engine against pre-registered
   thresholds (hit-rate, containment, abstention, clarify, language, safety referral, p95 latency)
   and writes `apps/api/eval-artifacts/ai-eval-latest.json`. `tests/ai-eval-degradation.test.ts`
   proves the gate fails under a deliberately broken retriever.

## Knowledge-base provenance
Every `knowledge.ts` entry carries a sources ledger (`sourceName`, `sourceUrl`, `reviewedAt`,
`status`). **All entries are currently `UNSOURCED`**: no external source, rights basis or agronomist
sign-off has been recorded. Provenance and re-use rights are pending owner + agronomist review —
the fields exist so that gap is visible and must not be filled with invented citations.

## Disease detection stance
Without a trained classifier configured, uploaded images are stored, validated (MIME + magic bytes),
and queued as `PENDING_REVIEW` for human agronomists. The product **never shows a fabricated AI
diagnosis**. The case model already carries `confidence/severity/diagnosis/reviewedBy` fields so a
model provider can be plugged in behind the same workflow later.
