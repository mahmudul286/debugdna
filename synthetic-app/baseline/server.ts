/**
 * Baseline order-payment API server.
 *
 * Route: POST /api/orders/:orderId/payment
 *
 * On payment failure the server:
 *   1. Logs a structured JSON diagnostic record containing the 7 canonical
 *      signal fields to stderr.
 *   2. Returns HTTP 502 with { requestId, errorCode } so the caller can
 *      correlate the failure.
 *
 * The original PaymentError is never swallowed — it is preserved in the log.
 */

import express, { Request, Response } from "express";
import { randomUUID } from "crypto";
import { chargePayment, PaymentError } from "./payment-provider";
import { logger } from "./logger";

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// POST /api/orders/:orderId/payment
// ---------------------------------------------------------------------------
app.post("/api/orders/:orderId/payment", async (req: Request, res: Response) => {
  const requestId = randomUUID();
  const { orderId } = req.params;

  try {
    const result = await chargePayment(orderId);
    logger.info({ requestId, orderId, event: "payment.success", transactionId: result.transactionId });
    res.status(200).json({ requestId, transactionId: result.transactionId });
  } catch (err) {
    if (err instanceof PaymentError) {
      // Emit one structured diagnostic log with all 7 canonical signal fields.
      logger.error({
        // --- 7 canonical diagnostic signals ---
        requestId,
        orderId,
        paymentProvider: err.provider,
        operation: "chargePayment",
        errorType: err.name,
        errorCode: err.code,
        originalMessage: err.originalMessage,
        // --- end canonical signals ---
      });

      // Return 502 with correlation fields so the caller can identify the failure.
      res.status(502).json({ requestId, errorCode: err.code });
    } else {
      // Unexpected error — preserve the original and re-throw after logging.
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ requestId, orderId, event: "payment.unexpected_error", originalMessage: message });
      res.status(500).json({ requestId, error: "Internal server error" });
    }
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT ?? "3100", 10);

const server = app.listen(PORT, () => {
  logger.info({ event: "server.start", port: PORT });
  // Deterministic readiness marker — consumed by the integration test.
  process.stdout.write(`SERVER_READY:${PORT}\n`);
});

// Allow graceful shutdown in tests.
export { app, server };
