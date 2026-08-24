export interface CreatePaymentInput {
  amountPaisa: number;
  refNo: string;
  customerPhone: string;
  /** Sandbox hook: deterministic outcome for testing both paths. */
  forceFail?: boolean;
}

export interface PaymentIntent {
  provider: string;
  providerRef: string;
  redirectUrl?: string; // hosted checkout in real providers
}

/**
 * PaymentProvider abstraction (Section 24/54). Business logic never talks to
 * a specific gateway. Real gateways (SSLCommerz/bKash etc.) plug in here when
 * credentials are available — until then only sandbox mode is offered and is
 * clearly labelled as such everywhere it appears.
 */
export interface PaymentProvider {
  readonly name: string;
  readonly mode: "sandbox" | "live";
  createPayment(input: CreatePaymentInput): Promise<PaymentIntent>;
  verifyPayment(providerRef: string): Promise<{ status: "SUCCEEDED" | "FAILED" | "PENDING"; amountPaisa?: number }>;
}
