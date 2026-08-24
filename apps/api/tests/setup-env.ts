// Runs in every vitest worker BEFORE app modules are imported.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./test.db";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-0123456789abcdef";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-fedcba9876543210";
process.env.WEATHER_PROVIDER = process.env.WEATHER_PROVIDER ?? "mock";
process.env.AI_PROVIDER = process.env.AI_PROVIDER ?? "offline";
process.env.PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER ?? "sandbox";

export {};
