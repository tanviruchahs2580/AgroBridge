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
 * Verdict of the gateway's own Order Validation API (SSLCommerz "Validation
 * Server", developer.sslcommerz.com/docs.html, retrieved 2026-11-22). VALID is
 * a first successful validation; VALIDATED is the documented status when the
 * same val_id is validated more than once — both are successful settlements.
 * INVALID covers the documented negative statuses; UNKNOWN covers anything
 * retryable (unreachable gateway, unreadable answer, undocumented status).
 */
export type OrderValidation =
  | { status: "VALID" | "VALIDATED"; amountPaisa: number; currency: string; tranId: string; riskLevel: 0 | 1; riskTitle?: string }
  | { status: "INVALID" }
  | { status: "UNKNOWN" };

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
  /**
   * Server-to-server validation of a gateway-issued val_id, where the gateway
   * offers one. The webhook holds every adapter that exposes this to a
   * VALID/VALIDATED verdict before it settles — an IPN's signature proves the
   * POST came from the gateway, not that the transaction settled (PAY-01).
   * Adapters without it (sandbox) settle on their own documented contract.
   */
  validateOrder?(valId: string): Promise<OrderValidation>;
}
