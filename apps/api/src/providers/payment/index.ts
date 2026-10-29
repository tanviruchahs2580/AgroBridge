import { env } from "../../config/env.js";
import { SandboxPaymentProvider } from "./sandbox.js";
import { SSLCommerzProvider } from "./sslcommerz.js";
import type { PaymentProvider } from "./types.js";

export * from "./types.js";

/**
 * The configured payment gateway. Business logic depends on the
 * `PaymentProvider` interface only, so switching from the simulated sandbox to
 * SSLCommerz is a configuration change (`PAYMENT_PROVIDER` + credentials).
 */
export function getPaymentProvider(): PaymentProvider {
  if (env.PAYMENT_PROVIDER === "sslcommerz" && env.SSLCOMMERZ_STORE_ID && env.SSLCOMMERZ_STORE_PASSWORD) {
    return new SSLCommerzProvider();
  }
  return new SandboxPaymentProvider();
}

/**
 * Payment readiness for `/ready`: which gateway is active and whether it is the
 * sandbox. Mirrors `storageReadiness` — a property that decides whether real
 * money can move should be readable from a deployment's own state, not inferred
 * from an environment file.
 */
export function paymentsReadiness(): { provider: string; sandbox: boolean } {
  try {
    const provider = getPaymentProvider();
    return { provider: provider.name, sandbox: provider.mode === "sandbox" };
  } catch {
    return { provider: "unconfigured", sandbox: true };
  }
}
