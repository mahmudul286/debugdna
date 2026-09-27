/**
 * Unit tests for analyzer/signal-extractor.ts
 *
 * Pure in-process tests — no child processes, no network, no filesystem I/O.
 * Fixture strings are inline copies/excerpts of the synthetic-app sources.
 */

import { describe, it, expect } from "vitest";
import { extractSignals, extractSignalsInRanges } from "@/analyzer/signal-extractor";
import { CANONICAL_SIGNAL_NAMES } from "@/analyzer/types";
import { scanDiff } from "@/analyzer/diff-scanner";

// ---------------------------------------------------------------------------
// Fixtures — inline copies of the relevant sections from the synthetic-app.
// ---------------------------------------------------------------------------

/**
 * Baseline server.ts — rich logger.error call with all 7 canonical signals.
 * (Verbatim copy of synthetic-app/baseline/server.ts)
 */
const BASELINE_SOURCE = `
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

const PORT = parseInt(process.env.PORT ?? "3100", 10);

const server = app.listen(PORT, () => {
  logger.info({ event: "server.start", port: PORT });
  process.stdout.write(\`SERVER_READY:\${PORT}\\n\`);
});

export { app, server };
`;

/**
 * Changed server.ts — degraded diagnostics: only requestId and orderId logged
 * in the payment-error branch.
 * (Verbatim copy of synthetic-app/changed/server.ts)
 */
const CHANGED_SOURCE = `
/**
 * Changed order-payment API server — intentionally degraded diagnostics.
 *
 * Route: POST /api/orders/:orderId/payment
 *
 * Functional behavior is preserved: payment failures still return HTTP 502.
 *
 * Diagnostic evidence is intentionally reduced compared to the baseline:
 *   1. The structured failure log retains only \`requestId\` and \`orderId\`.
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

app.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  if (err instanceof Error && err.message === "Payment failed") {
    res.status(502).json({ error: "Payment failed" });
  } else {
    res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = parseInt(process.env.PORT ?? "3101", 10);

const server = app.listen(PORT, () => {
  logger.info({ event: "server.start", port: PORT });
  process.stdout.write(\`SERVER_READY:\${PORT}\\n\`);
});

export { app, server };
`;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function signalNames(source: string): string[] {
  return extractSignals(source, "server.ts").signals.map((s) => s.name).sort();
}

// ---------------------------------------------------------------------------
// Tests — baseline
// ---------------------------------------------------------------------------

describe("extractSignals — baseline source", () => {
  it("finds all 7 canonical signals", () => {
    const { signals } = extractSignals(BASELINE_SOURCE, "server.ts");
    const names = signals.map((s) => s.name);
    for (const canonical of CANONICAL_SIGNAL_NAMES) {
      expect(names).toContain(canonical);
    }
  });

  it("returns exactly 7 signals (no duplicates, no extras)", () => {
    const { signals } = extractSignals(BASELINE_SOURCE, "server.ts");
    const names = signals.map((s) => s.name);
    expect(new Set(names).size).toBe(7);
    expect(signals).toHaveLength(7);
  });

  it("all signals have present=true", () => {
    const { signals } = extractSignals(BASELINE_SOURCE, "server.ts");
    for (const s of signals) {
      expect(s.present).toBe(true);
    }
  });

  it("missingSignals is empty for baseline", () => {
    const { missingSignals } = extractSignals(BASELINE_SOURCE, "server.ts");
    expect(missingSignals).toHaveLength(0);
  });

  it("location references the provided fileRef", () => {
    const { signals } = extractSignals(BASELINE_SOURCE, "server.ts");
    for (const s of signals) {
      expect(s.location).toMatch(/^server\.ts:/);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — changed source (full-file, unscoped)
// ---------------------------------------------------------------------------

describe("extractSignals — changed source (full-file)", () => {
  it("finds requestId", () => {
    expect(signalNames(CHANGED_SOURCE)).toContain("requestId");
  });

  it("finds orderId", () => {
    expect(signalNames(CHANGED_SOURCE)).toContain("orderId");
  });

  it("does NOT find paymentProvider", () => {
    expect(signalNames(CHANGED_SOURCE)).not.toContain("paymentProvider");
  });

  it("does NOT find operation", () => {
    expect(signalNames(CHANGED_SOURCE)).not.toContain("operation");
  });

  it("does NOT find errorType (generic Error does not count)", () => {
    expect(signalNames(CHANGED_SOURCE)).not.toContain("errorType");
  });

  it("does NOT find errorCode", () => {
    expect(signalNames(CHANGED_SOURCE)).not.toContain("errorCode");
  });

  it("the primary degraded payment branch (inline snippet) produces only requestId and orderId", () => {
    // Test against a minimal snippet of just the degraded branch (no else-branch).
    const degradedBranchOnly = `
      if (err instanceof PaymentError) {
        // DEGRADED: only requestId and orderId are logged.
        logger.error({ requestId, orderId });
        next(new Error("Payment failed"));
      }
    `;
    const names = signalNames(degradedBranchOnly);
    expect(names.sort()).toEqual(["orderId", "requestId"]);
  });
});

// ---------------------------------------------------------------------------
// Tests — scoped extraction (diff-scanner ranges applied to each version)
//
// This is the primary comparison path used by DebugDNA.
// Ranges come from scanDiff(baseline, changed) and represent the lines that
// changed in the changed file.  When those same ranges are applied to the
// *baseline* we capture the logger.error block that was replaced (all 7
// signals); when applied to the changed file we capture only the degraded
// logger.error({ requestId, orderId }) call.
//
// Crucially, the else-branch logger.error (which contains originalMessage)
// lives on a line that is UNCHANGED between baseline and changed — so it
// does NOT appear in the diff ranges and is excluded from the scoped result.
// ---------------------------------------------------------------------------

describe("extractSignalsInRanges — scoped to diff ranges", () => {
  // Compute the diff ranges once for the whole suite.
  const diffRanges = scanDiff(BASELINE_SOURCE, CHANGED_SOURCE).changedRanges;

  it("diff produces at least one changed range", () => {
    expect(diffRanges.length).toBeGreaterThan(0);
  });

  it("changed file scoped to diff ranges → exactly requestId and orderId", () => {
    const { signals } = extractSignalsInRanges(CHANGED_SOURCE, "server.ts", diffRanges);
    const names = signals.map((s) => s.name).sort();
    expect(names).toEqual(["orderId", "requestId"]);
  });

  it("changed file scoped to diff ranges → exactly 2 signals", () => {
    const { signals } = extractSignalsInRanges(CHANGED_SOURCE, "server.ts", diffRanges);
    expect(signals).toHaveLength(2);
  });

  it("changed scoped missingSignals contains the 5 lost signals", () => {
    const { missingSignals } = extractSignalsInRanges(CHANGED_SOURCE, "server.ts", diffRanges);
    expect(missingSignals).toContain("paymentProvider");
    expect(missingSignals).toContain("operation");
    expect(missingSignals).toContain("errorType");
    expect(missingSignals).toContain("errorCode");
    expect(missingSignals).toContain("originalMessage");
  });

  it("else-branch originalMessage is excluded from changed scoped result", () => {
    // The else-branch logger.error({ …, originalMessage: … }) line is IDENTICAL
    // in both versions, so diff-scanner does not mark it as changed.
    // Scoping to diff ranges must therefore never include it.
    const { signals } = extractSignalsInRanges(CHANGED_SOURCE, "server.ts", diffRanges);
    const names = signals.map((s) => s.name);
    expect(names).not.toContain("originalMessage");
  });

  it("else-branch originalMessage is excluded even when the branch text is present in the source", () => {
    // Construct a source that has the degraded payment branch PLUS an else-branch
    // containing originalMessage — and verify scoping keeps them separate.
    const source = `
function handler() {
  if (err instanceof PaymentError) {
    logger.error({ requestId, orderId });
  } else {
    logger.error({ requestId, orderId, originalMessage: message });
  }
}
`;
    // Manually define a range covering only the PaymentError branch (lines 3-4).
    const names = extractSignalsInRanges(source, "server.ts", [{ start: 3, end: 4 }])
      .signals.map((s) => s.name).sort();
    expect(names).toEqual(["orderId", "requestId"]);
    expect(names).not.toContain("originalMessage");
  });

  it("full-file extraction of changed source includes originalMessage from else-branch", () => {
    // Contrast: without scoping, originalMessage leaks in from the else-branch.
    const { signals } = extractSignals(CHANGED_SOURCE, "server.ts");
    const names = signals.map((s) => s.name);
    expect(names).toContain("originalMessage");
  });
});

// ---------------------------------------------------------------------------
// Tests — timestamp exclusion
// ---------------------------------------------------------------------------

describe("extractSignals — timestamp exclusion", () => {
  it("does not emit timestamp even when it appears in a logger call", () => {
    const source = `
      logger.error({
        requestId,
        orderId,
        timestamp: new Date().toISOString(),
        errorCode: "ERR_001",
      });
    `;
    const names = signalNames(source);
    expect(names).not.toContain("timestamp");
  });

  it("still extracts other canonical signals when timestamp is present", () => {
    const source = `
      logger.error({
        requestId,
        timestamp: Date.now(),
        errorCode: "ERR_001",
      });
    `;
    const names = signalNames(source);
    expect(names).toContain("requestId");
    expect(names).toContain("errorCode");
    expect(names).not.toContain("timestamp");
  });

  it("timestamp in a comment does not create a signal", () => {
    const source = `
      // timestamp: "2024-01-01"
      logger.error({ requestId });
    `;
    const names = signalNames(source);
    expect(names).not.toContain("timestamp");
    expect(names).toContain("requestId");
  });
});

// ---------------------------------------------------------------------------
// Tests — false-positive prevention
// ---------------------------------------------------------------------------

describe("extractSignals — no false positives", () => {
  it("does not match canonical names in comment-only lines", () => {
    const source = `
      // requestId orderId paymentProvider operation errorType errorCode originalMessage
      logger.error({ event: "noop" });
    `;
    const names = signalNames(source);
    expect(names).toHaveLength(0);
  });

  it("does not match non-canonical identifiers that partially match", () => {
    const source = `
      logger.error({
        myRequestId: "x",
        orderIdNew: "y",
        providerName: "stripe",
      });
    `;
    const names = signalNames(source);
    expect(names).toHaveLength(0);
  });

  it("does not match throw new Error (generic) as errorType", () => {
    const source = `throw new Error("Payment failed");`;
    const names = signalNames(source);
    expect(names).not.toContain("errorType");
  });

  it("does match throw new PaymentError as errorType", () => {
    const source = `throw new PaymentError("stripe", "TIMEOUT", "upstream timeout");`;
    const names = signalNames(source);
    expect(names).toContain("errorType");
  });

  it("returns empty signals for an empty source", () => {
    const names = signalNames("");
    expect(names).toHaveLength(0);
  });

  it("returns empty signals for a file with only comments", () => {
    const source = `// This is a comment\n/* Another comment */\n`;
    const names = signalNames(source);
    expect(names).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — data integrity
// ---------------------------------------------------------------------------

describe("extractSignals — data integrity", () => {
  it("all returned signal names are within CANONICAL_SIGNAL_NAMES", () => {
    const canonicalSet = new Set<string>(CANONICAL_SIGNAL_NAMES);
    const { signals } = extractSignals(BASELINE_SOURCE, "server.ts");
    for (const s of signals) {
      expect(canonicalSet.has(s.name)).toBe(true);
    }
  });

  it("each signal has a valid category", () => {
    const { signals } = extractSignals(BASELINE_SOURCE, "server.ts");
    const validCategories = new Set(["log", "error", "context"]);
    for (const s of signals) {
      expect(validCategories.has(s.category)).toBe(true);
    }
  });
});
