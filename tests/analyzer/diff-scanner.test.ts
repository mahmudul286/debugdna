/**
 * Unit tests for analyzer/diff-scanner.ts
 *
 * Pure in-process tests — no child processes, no network, no filesystem I/O.
 */

import { describe, it, expect } from "vitest";
import { scanDiff } from "@/analyzer/diff-scanner";

// ---------------------------------------------------------------------------
// Minimal fixtures — self-contained inline source strings.
// ---------------------------------------------------------------------------

const SIMPLE_A = `line one
line two
line three
line four
`;

const SIMPLE_B = `line one
line TWO changed
line three
line FOUR changed
`;

// Stripped-down versions of the real synthetic-app server files, containing
// only the sections relevant to payment-error handling.

const BASELINE_ERROR_BLOCK = `
app.post("/api/orders/:orderId/payment", async (req, res) => {
  const requestId = randomUUID();
  const { orderId } = req.params;
  try {
    const result = await chargePayment(orderId);
    logger.info({ requestId, orderId, event: "payment.success" });
    res.status(200).json({ requestId });
  } catch (err) {
    if (err instanceof PaymentError) {
      logger.error({
        requestId,
        orderId,
        paymentProvider: err.provider,
        operation: "chargePayment",
        errorType: err.name,
        errorCode: err.code,
        originalMessage: err.originalMessage,
      });
      res.status(502).json({ requestId, errorCode: err.code });
    } else {
      logger.error({ requestId, orderId, event: "unexpected" });
      res.status(500).json({ requestId });
    }
  }
});
`;

const CHANGED_ERROR_BLOCK = `
app.post("/api/orders/:orderId/payment", async (req, res, next) => {
  const requestId = randomUUID();
  const { orderId } = req.params;
  try {
    const result = await chargePayment(orderId);
    logger.info({ requestId, orderId, event: "payment.success" });
    res.status(200).json({ requestId });
  } catch (err) {
    if (err instanceof PaymentError) {
      logger.error({ requestId, orderId });
      next(new Error("Payment failed"));
    } else {
      logger.error({ requestId, orderId, event: "unexpected" });
      res.status(500).json({ requestId });
    }
  }
});
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scanDiff — changed line ranges", () => {
  it("returns no ranges for identical source texts", () => {
    const result = scanDiff(SIMPLE_A, SIMPLE_A);
    expect(result.changedRanges).toHaveLength(0);
  });

  it("detects changed lines in a simple two-line modification", () => {
    const result = scanDiff(SIMPLE_A, SIMPLE_B);
    // Lines 2 and 4 changed.
    expect(result.changedRanges.length).toBeGreaterThan(0);
    const allChangedLines = result.changedRanges.flatMap((r) => {
      const lines: number[] = [];
      for (let l = r.start; l <= r.end; l++) lines.push(l);
      return lines;
    });
    expect(allChangedLines).toContain(2);
    expect(allChangedLines).toContain(4);
    // Line 1 and 3 are unchanged.
    expect(allChangedLines).not.toContain(1);
    expect(allChangedLines).not.toContain(3);
  });

  it("detects that the payment error-handling area changed", () => {
    const result = scanDiff(BASELINE_ERROR_BLOCK, CHANGED_ERROR_BLOCK);
    expect(result.changedRanges.length).toBeGreaterThan(0);
  });

  it("reports more changed lines when more content differs", () => {
    const totalChangedLines = scanDiff(BASELINE_ERROR_BLOCK, CHANGED_ERROR_BLOCK)
      .changedRanges.reduce((acc, r) => acc + (r.end - r.start + 1), 0);
    expect(totalChangedLines).toBeGreaterThanOrEqual(3);
  });

  it("every changedRange has start <= end", () => {
    const result = scanDiff(BASELINE_ERROR_BLOCK, CHANGED_ERROR_BLOCK);
    for (const range of result.changedRanges) {
      expect(range.start).toBeLessThanOrEqual(range.end);
    }
  });

  it("every changedRange has start >= 1", () => {
    const result = scanDiff(BASELINE_ERROR_BLOCK, CHANGED_ERROR_BLOCK);
    for (const range of result.changedRanges) {
      expect(range.start).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("scanDiff — affected functions", () => {
  it("identifies app.post route as an affected function", () => {
    const result = scanDiff(BASELINE_ERROR_BLOCK, CHANGED_ERROR_BLOCK);
    const found = result.affectedFunctions.some((f) => f.startsWith("app.post"));
    expect(found).toBe(true);
  });

  it("returns no affected functions for identical texts", () => {
    const result = scanDiff(SIMPLE_A, SIMPLE_A);
    expect(result.affectedFunctions).toHaveLength(0);
  });

  it("detects named function declaration", () => {
    const a = `function processPayment(id) {\n  return id;\n}\n`;
    const b = `function processPayment(id) {\n  return id + 1;\n}\n`;
    const result = scanDiff(a, b);
    expect(result.affectedFunctions).toContain("processPayment");
  });

  it("detects arrow function assigned to const", () => {
    const a = `const handleError = (err) => {\n  console.log(err);\n};\n`;
    const b = `const handleError = (err) => {\n  console.error(err);\n};\n`;
    const result = scanDiff(a, b);
    expect(result.affectedFunctions).toContain("handleError");
  });
});
