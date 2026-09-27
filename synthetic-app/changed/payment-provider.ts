/**
 * Simulated payment provider.
 *
 * No real network calls are made. Failure behaviour is controlled exclusively
 * via the PAYMENT_FAILURE_MODE environment variable:
 *
 *   PAYMENT_FAILURE_MODE=timeout        — simulates a provider timeout
 *   PAYMENT_FAILURE_MODE=service-error  — simulates a provider 5xx error
 *
 * On success the provider returns a transaction id.
 */

export type FailureMode = "timeout" | "service-error";

export interface PaymentResult {
  transactionId: string;
  provider: string;
  orderId: string;
}

export class PaymentError extends Error {
  readonly code: string;
  readonly provider: string;
  readonly originalMessage: string;

  constructor(opts: { code: string; provider: string; originalMessage: string }) {
    super(opts.originalMessage);
    this.name = "PaymentError";
    this.code = opts.code;
    this.provider = opts.provider;
    this.originalMessage = opts.originalMessage;
  }
}

const PROVIDER_NAME = "AcmePay";

export async function chargePayment(orderId: string): Promise<PaymentResult> {
  const mode = process.env.PAYMENT_FAILURE_MODE as FailureMode | undefined;

  if (mode === "timeout") {
    throw new PaymentError({
      code: "PROVIDER_TIMEOUT",
      provider: PROVIDER_NAME,
      originalMessage: `Payment provider ${PROVIDER_NAME} timed out for order ${orderId}`,
    });
  }

  if (mode === "service-error") {
    throw new PaymentError({
      code: "PROVIDER_SERVICE_ERROR",
      provider: PROVIDER_NAME,
      originalMessage: `Payment provider ${PROVIDER_NAME} returned 503 for order ${orderId}`,
    });
  }

  // Happy path — deterministic fake transaction id.
  return {
    transactionId: `txn-${orderId}-${Date.now()}`,
    provider: PROVIDER_NAME,
    orderId,
  };
}
