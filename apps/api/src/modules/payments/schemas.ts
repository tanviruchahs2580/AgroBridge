import { z } from "zod";

/**
 * Centralized Zod schemas for Payments / Wallet / Membership flows.
 * Inferred directly from existing routes.ts validation so the subsequent
 * thin-routes refactor can import these without behavioral change.
 */

// --- Shared primitives ---

export const purposeTypeEnum = z.enum(["ORDER", "BOOKING", "PROCUREMENT", "MEMBERSHIP"]);

export const paymentIdParamSchema = z.object({
  id: z.string().min(5).max(64),
});

export type PaymentIdParams = z.infer<typeof paymentIdParamSchema>;

// --- Payment intent ---

export const intentBodySchema = z.object({
  purposeType: purposeTypeEnum,
  purposeId: z.string().min(5).max(64),
});

export type IntentBody = z.infer<typeof intentBodySchema>;

// --- Payment confirm (no body, just params) ---

export const confirmParamsSchema = paymentIdParamSchema;
export type ConfirmParams = z.infer<typeof confirmParamsSchema>;

// --- Refund ---

export const refundBodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export type RefundBody = z.infer<typeof refundBodySchema>;

export const refundParamsSchema = paymentIdParamSchema;
export type RefundParams = z.infer<typeof refundParamsSchema>;

// --- Procurement payout ---

export const payoutBodySchema = z.object({
  poId: z.string().min(5).max(64),
});

export type PayoutBody = z.infer<typeof payoutBodySchema>;

// --- Withdrawals ---

export const MIN_WITHDRAWAL_PAISA = 10_000; // ৳100 — mirrors routes.ts constant

export const withdrawalChannelEnum = z.enum(["BKASH", "NAGAD", "BANK"]);

export const withdrawalBodySchema = z.object({
  amountPaisa: z.number().int().min(MIN_WITHDRAWAL_PAISA),
  channel: withdrawalChannelEnum.default("BKASH"),
});

export type WithdrawalBody = z.infer<typeof withdrawalBodySchema>;

export const withdrawalChannel = withdrawalChannelEnum;

// Preserve legacy name used in some handlers
export const withdrawalSchema = withdrawalBodySchema;

// --- Wallet query schemas (optional, for future) ---

export const listPaymentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100).optional(),
  offset: z.coerce.number().int().min(0).default(0).optional(),
});

export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;

// --- Composite schemas for validate() middleware ---

export const intentSchemas = {
  body: intentBodySchema,
} as const;

export const refundSchemas = {
  body: refundBodySchema,
  params: refundParamsSchema,
} as const;

export const payoutSchemas = {
  body: payoutBodySchema,
} as const;

export const withdrawalSchemas = {
  body: withdrawalBodySchema,
} as const;
