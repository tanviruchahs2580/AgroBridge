export interface CreatePaymentInput {
  amountPaisa: number;
  refNo: string;
  customerPhone: string;
  /**
   * Buyer's display name, where the gateway wants one (SSLCommerz v4
   * `cus_name`). Optional: a caller without it still gets a session.
   */
  customerName?: string;
  /**
   * Absolute base URL of the MOUNTED API (includes the `/api/v1` prefix, no
   * trailing slash); the provider appends its own success/fail/cancel callback
   * paths and the IPN `notify_url`.
   */
  returnBaseUrl: string;
  /** Sandbox hook: deterministic outcome for testing both paths. */
  forceFail?: boolean;
}

export interface PaymentIntent {
  provider: string;
  providerRef: string;
  redirectUrl?: string; // hosted checkout in real providers
  /** Extra metadata returned by the provider (e.g. SSLCommerz val_id for verifyPayment). */
  meta?: Record<string, unknown>;
}

/**
 * PaymentProvider abstraction. Business logic never talks to
 * a specific gateway. Real gateways (SSLCommerz/bKash etc.) plug in here when
 * credentials are available — until then only sandbox mode is offered and is
 * clearly labelled as such everywhere it appears.
 */
export interface PaymentProvider {
  readonly name: string;
  readonly mode: "sandbox" | "live";
  createPayment(input: CreatePaymentInput): Promise<PaymentIntent>;
  /**
   * `providerRef` is the merchant-side reference (our refNo / tran_id) — the
   * only key every gateway can resolve. `meta` carries the extras stored at
   * intent creation (e.g. SSLCommerz's val_id for the Validation API); live
   * adapters take the gateway-specific key they need from meta when present
   * and fall back to providerRef, never the reverse.
   */
  verifyPayment(
    providerRef: string,
    meta?: Record<string, unknown>
  ): Promise<{ status: "SUCCEEDED" | "FAILED" | "PENDING"; amountPaisa?: number }>;
}
