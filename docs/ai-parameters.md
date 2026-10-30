# AI parameter register (A1-03)

Every tunable in the AI agro-agent path, its current value, where it lives and
whether it was **measured**, **tuned against tests**, or **guessed** (a
conservative default with no measurement behind it). Regenerate the evaluation
numbers with `npm run eval:ai -w apps/api`; the artifact lands in
`apps/api/eval-artifacts/ai-eval-latest.json`.

Sources: `apps/api/src/providers/ai/*`, `apps/api/src/modules/aiagent/routes.ts`,
`apps/api/src/config/env.ts`, `apps/api/src/providers/weather/*`,
`apps/api/tests/ai-eval-metrics.ts`.

## 1. Retrieval and ranking (`knowledge.ts::retrieve`)

| Parameter | Value | Status | Why this value |
| --- | --- | --- | --- |
| Top-k entries returned | 2 | **Guessed (conservative)** | The corpus is small (7 entries) and answers are composed from the primary entry only; the second entry exists for tie-break and multi-entry confidence. No k-sweep has been run — a k-sweep is blocked on a corpus large enough to measure recall@k honestly. |
| Strong keyword hit (single token) | +1.5 | **Tuned by tests** | Set together with the topical gate; regression suites (`ai-retrieval-regression`) pin that a bare crop mention cannot outrank a topical keyword. |
| Strong phrase hit (multi-token) | +2.2 | **Tuned by tests** | Multi-word phrases are the most specific evidence available without embeddings. |
| Weak crop-alias mention | +0.5, max once per entry | **Tuned by tests** | Counted once so a long question repeating the crop name cannot inflate a non-topical entry. |
| Crop-context hint bonus (farmer's active crop cycle) | +2 | **Tuned by tests** | Tie-breaker among entries with topical evidence. It never grounds an answer on its own (regression: a rice-cycle farmer asking about irrigation timing got rice-blast advice). |
| Topical gate | ≥1 strong hit required | **Measured (regression-covered)** | 0 refs ⇒ abstain template; this is what makes the abstain corpus of the eval set pass at 100%. |
| Query normalization | lowercase + crop aliases | **Tuned by tests** | `normalizeQuery`; Banglish handling covered by `ai-bangla-transliteration`. |
| Question sanitisation | fence/marker stripping, 5–1000 chars | **Measured (schema)** | `sanitizeQuestion` + zod body schema; over-length questions rejected at the edge. |
| Chunking | one entry = one retrievable chunk | **Structural** | The corpus ships as curated entries; there is no tokenizer/chunker to configure. |

There is deliberately **no** embedding model, vector index, reranker or query
expansion (A3-04: none exists, and none is added without measured retrieval
failures to justify it).

## 2. Confidence (offline engine, `offline-engine.ts::ask`)

| Parameter | Value | Status |
| --- | --- | --- |
| Stored entry confidence | 0.82–0.90 (per entry) | **Guessed** — see below |
| Match-quality multiplier | `min(1, 0.75 + max(0, topScore − 1.5) × 0.125)` | **Tuned by tests** (regression: off-topic single-keyword answers used to be advertised at the entry's stored value) |
| Multi-entry bonus | +0.03 when 2 entries retrieved | **Guessed (small)** |
| Cap | 0.95 | **Structural** — no answer is ever presented as certain |
| LOW_CONFIDENCE_THRESHOLD | 0.55 | **Measured against the eval gate** (drives the expert-verification note) |
| Abstain confidence | 0.3, `lowConfidenceFlag: true` | **Structural** |
| UI presentation | 3 coarse bands (`supportHigh`/`supportModerate`/`lowConfidence`), never a percentage | **Deliberate** (A4-01): the score is a keyword-retrieval indicator, not a calibrated probability — see `apps/web/src/features/advisor/supportLabel.ts` |

The **stored per-entry confidences are authoring guesses**, not empirically
calibrated. Calibrating them against labelled outcomes is an agronomist-gated
follow-up (A8-04) and is recorded as such; the UI never shows the number, so no
user-facing claim rests on the guess.

## 3. Hosted provider adapter (`openai-compat.ts`)

| Parameter | Value | Status |
| --- | --- | --- |
| `temperature` | 0.2 | **Guessed (low-entropy default)** |
| `max_tokens` | 600 | **Guessed (bounded output)** |
| Request timeout | 20 s (`AbortSignal.timeout`) | **Guessed** |
| Retries | 1, only for retryable classes (HTTP 429/5xx); timeout/transport failures are single-attempt | **Tuned by tests** (`ai-provider-adapter`) |
| Retry delay | 0–300 ms full jitter | **Guessed** |
| Prompt version | `v1` (`PROMPT_VERSION`) | **Structural** — recorded on every hosted answer and in the audit trail |
| System-prompt guard | "Never invent pesticide/fertiliser dosages. Never execute actions (orders/payments)." | **Deliberate** (A4-09/A7-02) |
| Output validation | empty content / `content_filter` / `length` finish reasons become typed errors, never served | **Measured by tests** |
| Bulkhead (`maxConcurrent`) | not configured on this path | **Gap, documented** — the resilience layer supports it; no cap is set because the hosted path is off by default and the fallback is free |
| Live evaluation | **BLOCKED** — no provider credentials exist (`LIVE_AI_EVAL=test_key_only`, spend 0 USD); all negative-path behaviour is exercised through fixtures instead | — |

## 4. Guardrails and honesty paths

| Rule | Where | Status |
| --- | --- | --- |
| Out-of-corpus questions → honest no-grounding text + referral, never an invented answer | `offline-engine.ts` abstain branch | **Measured**: the eval set's 47 abstain + 13 clarify items pass at 100% |
| Low confidence → expert-verification note appended | `expertVerificationNote` | Covered by the eval gate's safety stratum (33 items) |
| Agrochemical guidance (names or doses an input) from an `UNSOURCED` corpus entry → review-pending note appended (A4-09) | `containsAgrochemGuidance` + `unreviewedTreatmentNote` | **Measured by tests** (`ai-citations-sources`): detector cases in bn/en, note present for unreviewed input guidance, absent for cultural guidance, absent for the same content when marked `REVIEWED` |
| Citations resolve to the live corpus; no fabricated URLs | `sourceRefOf`, `liveGroundedRefs/liveGroundedSources` | **Measured by tests**: ids in the payload always resolve; removed entries resolve to nothing; the citation shape has no URL field |
| User contributions cannot enter the KB at runtime | corpus is code-only | **Structural** (A7-04) |

## 5. Quotas, budgets and usage accounting

| Parameter | Value (default) | Env var | Status |
| --- | --- | --- | --- |
| Advisory rate limit | 30 / hour / account (per-account key, not per-IP) | `AI_HOURLY_LIMIT` | **Deliberate** |
| Monthly spend breaker | ৳500 (50 000 paisa); in production the hosted provider returns 429 `AI_BUDGET_EXCEEDED`, non-prod falls back to the offline engine | `AI_MONTHLY_BUDGET_PAISA` | **Deliberate**; production startup refuses `AI_PROVIDER=openai-compatible` with `AI_COST_PER_1K_TOKENS_PAISA=0` |
| Cost estimate | paisa per 1k tokens | `AI_COST_PER_1K_TOKENS_PAISA` | **Guessed** — the operator sets the real tariff |
| Usage log fields | provider, model, kbVersion, requestId, latencyMs, success, tokens in/out, cost estimate | `AiUsageLog` | **Structural**; no raw question/answer in the log table (they live in the owner-scoped advisory rows) |

## 6. Weather parameters (`providers/weather/*`, `modules/weather/*`)

| Parameter | Value | Status |
| --- | --- | --- |
| Units | request `units=metric`; wind m/s → km/h conversion in the adapter | **Measured by fixture tests** (`weather-adapter-fixtures`) |
| Rain fields | `rain.1h` (current), `rain.3h` summed per day (forecast); absent → 0 | **Measured by fixtures** |
| Timezone | `dt_txt` parsed as UTC, buckets by the Asia/Dhaka calendar day (18:00Z belongs to the next Dhaka day) | **Measured by fixtures + `timezone-boundaries`** |
| Nulls | missing `dt` → no `observedAt` (field absent, never invented); empty `weather[]` → "unknown" | **Measured by fixtures** |
| Fetch timeout | 8 s | **Guessed** |
| Retry policy | shared resilience: 1 retry on 429/5xx/network, never on other 4xx; circuit opens after 5 consecutive failures (30 s cooldown) | **Measured by tests** (`resilience`, `weather-adapter-fixtures`) |
| Cache TTL | 600 s | `WEATHER_CACHE_TTL_SECONDS`; single-flight coalescing keyed by lat/lng; only successful payloads stored | **Measured by tests** (`weather-cache`, `weather-single-flight`) |
| Provider default | `mock` (fixture) unless `WEATHER_PROVIDER=openweather` with a key; production startup refuses `openweather` without a key | **Structural** |

## 7. Evaluation-gate parameters (`tests/ai-eval-metrics.ts`)

Pre-registered before measurement (A8-07), each with rationale in the file:
hit-rate ≥ 0.80, containment ≥ 0.60, abstention ≥ 0.90, clarify ≥ 0.60,
language ≥ 0.95, safety-referral ≥ 0.90, citation validity = 1.00,
provider/fallback correctness = 1.00, abstention precision ≥ 0.99, latency p95
≤ 250 ms. 95% Wilson intervals are reported in the artifact; the derived
unsupported-claim rate is 1 − containment.

## Change control: regression gate and rollback (A8-09)

- Any change to the corpus, the retriever, the engine, the prompt template or
  the provider wiring runs the same frozen evaluation gate in CI
  (`ai-eval-harness`, 109 held-out items, per-stratum metrics), so an
  improvement in one language/crop cannot hide a regression in another: the
  metrics are computed per kind and the language stratum is measured separately
  (bn/banglish/en).
- Every answer records `kbVersion` (corpus content hash) and hosted answers
  record `promptVersion`; stored advisory rows carry both, so the answers
  affected by a bad revision are identifiable by joining on those columns.
- Rollback path: the corpus and prompts are code (no runtime ingestion), so the
  rollback is `git revert` of the offending commit — the KB hashes revert with
  it and the gate re-runs. A hosted-model change is rolled back by pinning
  `AI_PROVIDER=offline` (the default), which serves the deterministic KB engine
  with zero provider spend.

## Unmeasured / owner-gated follow-ups (honest list)

- Per-entry confidences and top-k: no k-sweep (corpus too small to measure
  recall@k meaningfully).
- Live-provider evaluation: BLOCKED without credentials; fixture-grade only.
- Agronomist review of contents and of the review-pending notes (A8-04) is an
  owner action; nothing in this register substitutes for it.
- External sourcing for KB entries (A2-01) is unrecorded — entries are honestly
  marked `UNSOURCED`, and no citation URL is fabricated anywhere.
