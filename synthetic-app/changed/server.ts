/**
 * Changed order-payment API server — intentionally degraded diagnostics.
 *
 * Route: POST /api/orders/:orderId/payment
 *
 * Functional behavior is preserved: payment failures still return HTTP 502.
 *
 * Diagnostic evidence is intentionally reduced compared to the baseline:
 *   1. The structured failure log retains only `requestId` and `orderId`.
 *      The following 5 canonical signals are removed:
 *        - paymentProvider
 *        - operation
 *        - errorType
 *        - errorCode
 *        - originalMessage
 *   2. The original PaymentError is replaced with a generic Error —
 *      the typed cause chain is lost.
 *   3. The 502 response body is generic — requestId and errorCode are omitted.
 */

import express, { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { chargePayment, PaymentError } from "./payment-provider";
import { logger } from "./logger";

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// POST /api/orders/:orderId/payment
// ---------------------------------------------------------------------------
app.post("/api/orders/:orderId/payment", async (req: Request, res: Response, next: NextFunction) => {
  const requestId = randomUUID();
  const { orderId } = req.params;

  try {
    const result = await chargePayment(orderId);
    logger.info({ requestId, orderId, event: "payment.success", transactionId: result.transactionId });
    res.status(200).json({ requestId, transactionId: result.transactionId });
  } catch (err) {
    if (err instanceof PaymentError) {
      // DEGRADED: only requestId and orderId are logged.
      // paymentProvider, operation, errorType, errorCode, and originalMessage are removed.
      logger.error({ requestId, orderId });

      // DEGRADED: original PaymentError is replaced with a generic Error —
      // the typed error, cause chain, and all fields are lost.
      next(new Error("Payment failed"));
    } else {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ requestId, orderId, event: "payment.unexpected_error", originalMessage: message });
      res.status(500).json({ requestId, error: "Internal server error" });
    }
  }
});

// ---------------------------------------------------------------------------
// Global error handler — catches re-thrown errors (e.g. the generic Error
// thrown by the payment failure branch above) and returns the degraded 502.
// ---------------------------------------------------------------------------
app.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  if (err instanceof Error && err.message === "Payment failed") {
    // DEGRADED: generic body — requestId and errorCode are absent.
    res.status(502).json({ error: "Payment failed" });
  } else {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT ?? "3101", 10);

const server = app.listen(PORT, () => {
  logger.info({ event: "server.start", port: PORT });
  // Deterministic readiness marker — consumed by the integration test.
  process.stdout.write(`SERVER_READY:${PORT}\n`);
});

// Allow graceful shutdown in tests.
export { app, server };
