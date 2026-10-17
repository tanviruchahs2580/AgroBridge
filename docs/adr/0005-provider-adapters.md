# ADR-0005 — Weather, AI, payment and storage sit behind provider interfaces with explicit placeholder gates

- Status: accepted
- Date: 2026-10-18
- Deciders: engineering; arrangement already in force, recorded by the Phase 4 quality review

## Context

Every external dependency that costs money or cannot be exercised in tests is behind a small
interface in `apps/api/src/providers/*`, selected by environment variable:

| Domain | Interface | Implementations | Selection |
|---|---|---|---|
| Weather | `WeatherProvider` | `MockWeatherProvider`, `OpenWeatherProvider` | `WEATHER_PROVIDER=mock\|openweather` |
| AI | `AIProvider` (via `ai/gateway.ts` + knowledge base) | `offline-engine` (KB-only), `openai-compat` (+ graceful fallback to offline) | `AI_PROVIDER=offline\|openai-compatible` |
| Payment | `PaymentProvider` (`{ name, mode: "sandbox"\|"live", createPayment, verifyPayment }`) | `sandbox`, `sslcommerz` (signature-verified webhook + hosted checkout) | `PAYMENT_PROVIDER=sandbox\|sslcommerz` |
| Storage | `StorageProvider` | `LocalStorageProvider` (instance disk), S3/R2-compatible | `STORAGE_PROVIDER=local\|s3` |
| SMS/OTP delivery | notification/SMS adapter point | sandbox (code logged, not sent), `none` | `SMS_PROVIDER=sandbox\|none` |

Business logic never imports a concrete vendor SDK; routes call `getPaymentProvider()`,
`getWeatherProvider()` etc. The sandbox payment adapter moves no money and is labelled
`providerMode: "sandbox"` in every response that could be mistaken for a real charge.

The production gate lives in `apps/api/src/config/env.ts`:

- **Fail-fast:** in `NODE_ENV=production`, any placeholder provider (mock weather, offline AI,
  sandbox/none SMS, sandbox payments, local storage) **aborts boot** unless the operator sets
  `ALLOW_PLACEHOLDER_PROVIDERS=1`.
- **No silent degradation:** with the flag set, `placeholderManifest()` compiles the accepted
  list and every entry is logged as a startup warning — including the money-path
  `ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION=1` opt-in, which is listed in operator-facing words
  ("buyers can COMPLETE simulated payments on this deployment — demo/pilot only").
- **Genuine misconfigurations stay hard failures:** `openweather` without `OPENWEATHER_API_KEY`,
  `openai-compatible` without `OPENAI_API_KEY`, `s3` without its four credentials, `sslcommerz`
  without store id/password, and default/dev JWT secrets all refuse production startup.
- The payment route adds a second, route-level gate: a production deployment with no gateway
  refuses to hand back a payable intent (`PAYMENT_GATEWAY_NOT_CONFIGURED`) instead of letting a
  sandbox confirm mark an order paid for free.

History worth keeping: the original fail-fast rejected *every* value the placeholder enums
allow, so no production deployment could boot without paid contracts — the service stayed pinned
to an older commit until the explicit opt-in flag (`ALLOW_PLACEHOLDER_PROVIDERS=1` with a loud
warning) replaced it. The current shape is deliberate: the default is "refuse", acceptance is
auditable in one env var, and acceptance is visible in the logs.

## Decision

Keep adapters + env selection + fail-fast gates. New external integrations must follow the same
pattern: an interface in `providers/`, a real implementation, a clearly-labelled placeholder for
dev/demo, env-based selection, and — if it is a placeholder — an entry in `placeholderManifest()`
so it is named in the startup warning and in the production gate.

## Consequences

- Dev/test/CI run with zero external accounts; a pilot deployment can boot with placeholders but
  cannot do so invisibly.
- Production readiness is measurable: the startup log lists exactly what is simulated.
- Placeholder entries must be kept honest (a placeholder added without a manifest entry would be
  a silent degradation — the env guard unit tests are the backstop).
- When real credentials arrive (SSLCommerz, OpenWeather, OpenAI-compatible endpoint, S3), only
  the env selection and the adapter's own file change; routes and business logic do not.
