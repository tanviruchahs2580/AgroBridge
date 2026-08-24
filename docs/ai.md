# AI Agro Agent

## Pipeline (per request)
```
Question → sanitize (strip injection patterns, ≤1000 chars)
        → context extraction (farmer, active crop + stage, district, weather-aware prompt)
        → provider gateway
             ├── offline-agro-engine (default): grounded retrieval over curated KB
             └── openai-compatible adapter: KB entries injected as grounding context,
                 hardened system prompt, refuse-if-insufficient instruction
        → confidence scoring → low-confidence ⇒ expert-verification note appended
        → persistence (AdvisoryQuery) + usage telemetry (AiUsageLog)
```

## Guarantees
1. **Grounded or honest.** The offline engine answers only from the knowledge base
   (`src/providers/ai/knowledge.ts` — rice blast/urea schedule, wheat rust, mustard aphid, jute rot,
   soil testing, irrigation). Unknown questions return low confidence with explicit guidance to
   consult an agronomist. Tests assert both behaviours.
2. **No dangerous actions from chat.** The agent never places orders/payments/bookings; those require
   explicit API flows by the authenticated user.
3. **Provider independence.** `AIProvider` interface; set `AI_PROVIDER=openai-compatible` +
   `OPENAI_API_KEY` to enable an LLM; the gateway falls back to the offline engine on any provider error.
4. **Observability & cost control.** Every call logs provider/model/latency/success to `AiUsageLog`;
   admin endpoint `/admin/ai-usage` aggregates. Rate limit 30 req/h/user on advisory.
5. **Injection resistance.** Code fences and role-prefix patterns are stripped before processing;
   the LLM system prompt instructs answer-only-from-grounding.

## Disease detection stance
Without a trained classifier configured, uploaded images are stored, validated (MIME + magic bytes),
and queued as `PENDING_REVIEW` for human agronomists. The product **never shows a fabricated AI
diagnosis**. The case model already carries `confidence/severity/diagnosis/reviewedBy` fields so a
model provider can be plugged in behind the same workflow later.
