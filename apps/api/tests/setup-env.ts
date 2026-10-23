// Runs in every vitest worker BEFORE app modules are imported.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./test.db";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-0123456789abcdef";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-fedcba9876543210";
process.env.WEATHER_PROVIDER = process.env.WEATHER_PROVIDER ?? "mock";
process.env.AI_PROVIDER = process.env.AI_PROVIDER ?? "offline";
process.env.PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER ?? "sandbox";
// Required by the SSLCommerz webhook signature path; must exist before the app
// (and its env schema) is imported by tests/helpers.js. STORE_ID is inert
// while PAYMENT_PROVIDER stays "sandbox" — it exists so the live adapter can
// be constructed and exercised against a stubbed fetch
// (payments-reconciliation-amount.test.ts).
process.env.SSLCOMMERZ_STORE_PASSWORD = process.env.SSLCOMMERZ_STORE_PASSWORD ?? "test-store-password";
process.env.SSLCOMMERZ_STORE_ID = process.env.SSLCOMMERZ_STORE_ID ?? "test-store-id";
// Guards the scheduled-ops endpoint (tests/ops-retention-endpoint.test.ts);
// must exist before the app's env schema parses.
process.env.CRON_SECRET = process.env.CRON_SECRET ?? "test-cron-secret";
// The auth suites deliberately exercise brute-force paths (per-account lock
// thresholds, timing equalisation) which exceed the human-scale per-IP login
// policy. The limiter's own behaviour is pinned by auth-rate-limit-envelope
// (OTP limiter) and rate-limit-envelope (financial limiter) tests; CI sets this
// same documented variable for its e2e job.
process.env.LOGIN_RATE_LIMIT_MAX = process.env.LOGIN_RATE_LIMIT_MAX ?? "500";

export {};
