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
