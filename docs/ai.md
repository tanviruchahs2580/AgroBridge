# AI Agro Agent

See also: the request flow is drawn in `docs/architecture.md` ("AI advisory" sequence diagram);
prompt-injection controls and their tests are catalogued in `docs/threat-model.md` (AC-15).

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
   admin endpoint `/admin/ai-usage` aggregates. Rate limit 30 req/h/user on advisory, and the
   429 carries the standard error envelope with `requestId` (H-07).
   The monthly spend breaker multiplies usage by `AI_COST_PER_1K_TOKENS_PAISA`; with the default
   `0` it can never trip, so **production startup now fails closed**: `AI_PROVIDER=openai-compatible`
   in production requires a real `AI_COST_PER_1K_TOKENS_PAISA > 0` (guard `hostedAiCostProblem` in
   `src/config/env.ts`, documented here — the API refuses to boot instead of running the hosted
   provider with an inert money guard).
   When the budget is crossed anyway: in production the gateway refuses the hosted provider with
   `429 AI_BUDGET_EXCEEDED`; outside production it logs a warning, serves from the offline engine
   and increments `agrobridge_ai_requests_total{status="budget_fallback"}`
   (`apps/api/src/providers/ai/gateway.ts:25-47`). The window is the calendar month and the sum
   covers hosted-provider rows only.
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

## Versioning (`kbVersion` / `promptVersion`) — A2-04 / A3-07 / A4-06
- `KB_VERSION` (exported from `src/providers/ai/knowledge.ts`) is `sha256` of a stable
  serialization of the KB, first 12 hex chars, computed once at module load. Any content edit
  (answer, title, confidence, source ledger, keywords) changes it; the serialization is
  order-insensitive, so cosmetic reordering does not.
- **Every advisory response carries `kbVersion`** (both engines). The offline engine reports the
  version of the corpus it actually retrieved from — an evaluation-only corpus override gets its
  own hash and can never masquerade as the production KB.
- The hosted adapter adds `promptVersion` (`PROMPT_VERSION = "v1"` in `openai-compat.ts`, bumped
  whenever the prompt template changes materially) to its responses. **The offline engine omits
  `promptVersion`**: it has no prompt, and its `model` id (`kb-retrieval-v1`) is the template
  identity. The gateway logs both values in its existing usage/telemetry path (a structured
  `ai usage` debug line + provider/model in `AiUsageLog`; no new columns) and names the prompt
  version in the failure log context.

## Advisory feedback — A7-07
`POST /api/v1/ai/history/:id/feedback` (authenticated) with body `{ reason: string }`,
trimmed length 3–500. The advisory row must belong to the caller — another user's row is
indistinguishable from a missing one and returns **404** (no existence oracle). Writes
`feedbackReason` + `feedbackAt = now` on the row and appends an `AI_ADVISORY_FEEDBACK` audit log
entry (`entityType: "AdvisoryQuery"`, `entityId`, actor, IP). **A second report overwrites the
first**: a farmer refining their reason must not be blocked, and there is exactly one feedback
slot per advisory — the latest assessment wins. `GET /api/v1/ai/history` returns
`feedbackReason`/`feedbackAt` per row (additive).

## Disease detection stance
Without a trained classifier configured, uploaded images are stored, validated (MIME + magic bytes),
and queued as `PENDING_REVIEW` for human agronomists. The product **never shows a fabricated AI
diagnosis**. The case model already carries `confidence/severity/diagnosis/reviewedBy` fields so a
model provider can be plugged in behind the same workflow later.
