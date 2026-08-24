# Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| API exits at boot: `Invalid environment configuration` | Missing/weak env vars (JWT secrets ≥16 chars, DATABASE_URL) | Fill `.env` from `.env.example`; in production never ship dev secrets |
| `Error: listen EADDRINUSE :4000` | Another process on port 4000 | `PORT=4001` or kill the stale process |
| `/ready` returns 503 | DB unreachable/migrations missing | Check `DATABASE_URL`; run `npx prisma migrate deploy` |
| Prisma `P2002` conflict on register | Phone/email already exists | Use a different phone — UI surfaces 409 already |
| Login always 401 after user import | Passwords were hashed elsewhere with different scheme | Re-hash via bcrypt cost ≥10 or re-register |
| Weather returns `provider:"mock"` | No real provider configured (`WEATHER_PROVIDER`) | Set `WEATHER_PROVIDER=openweather` + `OPENWEATHER_API_KEY` |
| AI answer says "low confidence / consult agronomist" | Working as designed for questions outside the grounded KB | Add KB entries or enable an LLM provider (`AI_PROVIDER=openai-compatible`) |
| Disease case stays PENDING_REVIEW | No trained classifier configured; human review required by design | Admin reviews via `POST /disease/cases/:id/review` |
| Payment shows "sandbox" | Real gateway not configured | Integrate gateway behind `PaymentProvider` (docs/architecture.md); sandbox is intentionally obvious |
| Web dev server can't reach API | API not running on :4000 or proxy target changed | Start API first; adjust `vite.config.ts` proxy if needed |
| Vitest fails to start | Stale test DB lock file | Delete `apps/api/prisma/test.db*` and rerun |
| 429 responses during load tests | Global rate limit active outside development | Raise `RATE_LIMIT_MAX` per environment, or add Redis store when multi-replica |

## Getting the request ID for support
Every response carries `X-Request-Id` (also echoed in JSON envelope). Provide it with log excerpts
when filing issues.
