// Runs in every vitest worker BEFORE app modules are imported.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./test.db";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-0123456789abcdef";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-fedcba9876543210";
process.env.WEATHER_PROVIDER = process.env.WEATHER_PROVIDER ?? "mock";
process.env.AI_PROVIDER = process.env.AI_PROVIDER ?? "offline";
process.env.PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER ?? "sandbox";
// Required by the SSLCommerz webhook signature path; must exist before the app
// (and its env schema) is imported by tests/helpers.js.
process.env.SSLCOMMERZ_STORE_PASSWORD = process.env.SSLCOMMERZ_STORE_PASSWORD ?? "test-store-password";

export {};
