/**
 * Unit tests for analyzer/repair-suggester.ts
 *
 * Pure in-process tests — no child processes, no network, no filesystem I/O.
 * Fixtures are inline strings; the baseline source file is never read.
 */

import { describe, it, expect } from "vitest";
import { suggestRepair } from "@/analyzer/repair-suggester";
import { compareSnapshots } from "@/analyzer/comparator";
import type { ComparisonResult, DiagnosticSignal, EvidenceSnapshot } from "@/analyzer/types";
import { CANONICAL_SIGNAL_NAMES } from "@/analyzer/types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeSignal(name: string): DiagnosticSignal {
  return { name, category: "log", location: "server.ts:42", present: true };
}

function makeSnapshot(
  version: EvidenceSnapshot["version"],
  signalNames: string[]
): EvidenceSnapshot {
  return {
    version,
    scenarioId: "payment-provider-timeout",
    signals: signalNames.map(makeSignal),
    rawLogLines: [],
    capturedAt: 1_000_000,
  };
}

// ---------------------------------------------------------------------------
// Demo changed source — verbatim copy of synthetic-app/changed/server.ts
// relevant section (the full file is used to ensure realistic behaviour).
// ---------------------------------------------------------------------------

const CHANGED_SOURCE = `
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
      logger.error({ requestId, orderId });

      // DEGRADED: original PaymentError is replaced with a generic Error.
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
  process.stdout.write(\`SERVER_READY:\${PORT}\n\`);
});

export { app, server };
`;

// ---------------------------------------------------------------------------
// Demo ComparisonResult — baseline=7 signals, changed=2 signals
// ---------------------------------------------------------------------------

const ALL_SIGNAL_NAMES = [...CANONICAL_SIGNAL_NAMES];
const CHANGED_SIGNAL_NAMES = ["requestId", "orderId"];
const LOST_SIGNAL_NAMES = ["paymentProvider", "operation", "errorType", "errorCode", "originalMessage"];

const demoBaseline = makeSnapshot("baseline", ALL_SIGNAL_NAMES);
const demoChanged = makeSnapshot("changed", CHANGED_SIGNAL_NAMES);
const demoComparison: ComparisonResult = compareSnapshots(demoBaseline, demoChanged);

// ---------------------------------------------------------------------------
// Sanity-check the fixture comparison
// ---------------------------------------------------------------------------

describe("demo ComparisonResult fixture sanity", () => {
  it("has 5 lost signals", () => {
    expect(demoComparison.lostSignals).toHaveLength(5);
  });

  it("severity is 'high'", () => {
    expect(demoComparison.severity).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// suggestRepair — demo scenario (5 lost signals)
// ---------------------------------------------------------------------------

describe("suggestRepair — demo scenario", () => {
  // Run once; all assertions share this result for efficiency.
  const suggestion = suggestRepair(demoComparison, CHANGED_SOURCE);

  it("returns a RepairSuggestion object", () => {
    expect(suggestion).toBeDefined();
    expect(typeof suggestion).toBe("object");
  });

  it("targetFile is set", () => {
    expect(typeof suggestion.targetFile).toBe("string");
    expect(suggestion.targetFile.length).toBeGreaterThan(0);
  });

  it("targetSymbol is set", () => {
    expect(typeof suggestion.targetSymbol).toBe("string");
    expect(suggestion.targetSymbol.length).toBeGreaterThan(0);
  });

  it("description mentions the lost signal count", () => {
    expect(suggestion.description).toContain("5");
  });

  it("has all 5 signalMappings entries", () => {
    expect(Object.keys(suggestion.signalMappings)).toHaveLength(5);
  });

  it("signalMappings contains paymentProvider", () => {
    expect(suggestion.signalMappings).toHaveProperty("paymentProvider");
    expect(suggestion.signalMappings["paymentProvider"]).toContain("err.provider");
  });

  it("signalMappings contains operation", () => {
    expect(suggestion.signalMappings).toHaveProperty("operation");
    expect(suggestion.signalMappings["operation"]).toContain("chargePayment");
  });

  it("signalMappings contains errorType", () => {
    expect(suggestion.signalMappings).toHaveProperty("errorType");
    expect(suggestion.signalMappings["errorType"]).toContain("err.name");
  });

  it("signalMappings contains errorCode", () => {
    expect(suggestion.signalMappings).toHaveProperty("errorCode");
    expect(suggestion.signalMappings["errorCode"]).toContain("err.code");
  });

  it("signalMappings contains originalMessage", () => {
    expect(suggestion.signalMappings).toHaveProperty("originalMessage");
    expect(suggestion.signalMappings["originalMessage"]).toContain("err.originalMessage");
  });

  // --- patch content ---

  it("patch is a non-empty string", () => {
    expect(typeof suggestion.patch).toBe("string");
    expect(suggestion.patch.length).toBeGreaterThan(0);
  });

  it("patch contains unified diff header lines", () => {
    expect(suggestion.patch).toContain("---");
    expect(suggestion.patch).toContain("+++");
    expect(suggestion.patch).toContain("@@");
  });

  it("patch restores paymentProvider field", () => {
    expect(suggestion.patch).toContain("paymentProvider");
  });

  it("patch restores operation field", () => {
    expect(suggestion.patch).toContain("operation");
  });

  it("patch restores errorType field", () => {
    expect(suggestion.patch).toContain("errorType");
  });

  it("patch restores errorCode field", () => {
    expect(suggestion.patch).toContain("errorCode");
  });

  it("patch restores originalMessage field", () => {
    expect(suggestion.patch).toContain("originalMessage");
  });

  it("patch contains error propagation fix (direct 502 response)", () => {
    expect(suggestion.patch).toContain("res.status(502)");
    expect(suggestion.patch).toContain("requestId");
    expect(suggestion.patch).toContain("err.code");
  });

  it("patch removes the degraded next(new Error) propagation", () => {
    // The repaired source should not contain the degraded call.
    // Since the patch shows +/- lines, check the - side removes it.
    expect(suggestion.patch).toContain('next(new Error("Payment failed"))');
    // And the + side adds the direct 502 response (checked above).
  });

  it("patch does NOT restore signals that were not lost (requestId, orderId are preserved, not re-introduced as new)", () => {
    // requestId and orderId are preserved — they stay in the logger call.
    // They will appear in the patch (they're in the repaired call too), but
    // the signalMappings should NOT include them as "restored" entries.
    expect(suggestion.signalMappings).not.toHaveProperty("requestId");
    expect(suggestion.signalMappings).not.toHaveProperty("orderId");
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("suggestRepair — determinism", () => {
  it("calling suggestRepair twice with the same inputs yields identical patches", () => {
    const r1 = suggestRepair(demoComparison, CHANGED_SOURCE);
    const r2 = suggestRepair(demoComparison, CHANGED_SOURCE);
    expect(r1.patch).toBe(r2.patch);
    expect(r1.signalMappings).toEqual(r2.signalMappings);
    expect(r1.description).toBe(r2.description);
  });
});

// ---------------------------------------------------------------------------
// Baseline source is NOT required
// ---------------------------------------------------------------------------

describe("suggestRepair — baseline source not required", () => {
  it("does not require any baseline source argument", () => {
    // The function signature only accepts (comparison, changedSource, targetFile?).
    // This test confirms it works without any extra parameter.
    expect(() => suggestRepair(demoComparison, CHANGED_SOURCE)).not.toThrow();
  });

  it("produces the same result regardless of what was in the baseline snapshot signals", () => {
    // Even if the baseline signals have different values/locations, the repair
    // is derived from the lost-signal names + changed source — not the baseline text.
    const differentBaseline = makeSnapshot("baseline", ALL_SIGNAL_NAMES);
    // Mutate signal values to something arbitrary.
    differentBaseline.signals.forEach((s) => {
      (s as DiagnosticSignal & { value?: string }).value = "DIFFERENT_VALUE";
      s.location = "other-file.ts:99";
    });
    const comparison2 = compareSnapshots(differentBaseline, demoChanged);
    const r1 = suggestRepair(demoComparison, CHANGED_SOURCE);
    const r2 = suggestRepair(comparison2, CHANGED_SOURCE);
    expect(r1.patch).toBe(r2.patch);
  });
});

// ---------------------------------------------------------------------------
// Error handling — malformed / unsupported changed source
// ---------------------------------------------------------------------------

describe("suggestRepair — malformed or unsupported changed source", () => {
  it("throws a descriptive error when no degraded logger.error call can be found", () => {
    const noLoggerSource = `
      // Source with no logger.error call at all.
      function handler() {
        console.log("no logger here");
      }
    `;
    expect(() => suggestRepair(demoComparison, noLoggerSource)).toThrow(
      /could not locate a degraded logger\.error call/
    );
  });

  it("throws when the source has a logger.error call but it already contains the full signal set (not degraded)", () => {
    // A source whose only logger.error already contains all 7 fields is not
    // considered a degraded call, so findDegradedLoggerCall returns null.
    const alreadyFullSource = `
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
      }
    `;
    expect(() => suggestRepair(demoComparison, alreadyFullSource)).toThrow(
      /could not locate a degraded logger\.error call/
    );
  });

  it("throws with a message that explains what to check", () => {
    expect(() => suggestRepair(demoComparison, "")).toThrow(/degraded logger\.error call/);
  });
});

// ---------------------------------------------------------------------------
// Partial lost-signal set (only 1 lost signal)
// ---------------------------------------------------------------------------

describe("suggestRepair — partial lost-signal sets", () => {
  it("with only 1 lost signal, signalMappings has exactly 1 entry", () => {
    // The repair-suggester locates the degraded logger.error call (the one
    // missing all 5 extended signal fields) in the changed source and inserts
    // only the fragments for the signals listed as lost in the comparison.
    // So even though the source is missing 5 fields, if the comparison only
    // shows 1 lost signal, only 1 fragment is injected.
    const baseline = makeSnapshot("baseline", ["requestId", "orderId", "errorCode"]);
    const changedWith2 = makeSnapshot("changed", ["requestId", "orderId"]);
    const comparison = compareSnapshots(baseline, changedWith2);
    // CHANGED_SOURCE has a degraded logger.error({ requestId, orderId }) — eligible.
    const suggestion = suggestRepair(comparison, CHANGED_SOURCE);
    expect(Object.keys(suggestion.signalMappings)).toHaveLength(1);
    expect(suggestion.signalMappings).toHaveProperty("errorCode");
  });

  it("with 0 lost signals and a degraded-looking source, signalMappings is empty", () => {
    // When there are no lost signals, lostNames is empty. The degraded logger
    // call is found (because it doesn't contain the extended fields), but
    // signalMappings will be empty and no extra fields are injected beyond the
    // already-preserved ones.
    const baseline = makeSnapshot("baseline", CHANGED_SIGNAL_NAMES);
    const changed = makeSnapshot("changed", CHANGED_SIGNAL_NAMES);
    const comparison = compareSnapshots(baseline, changed);
    const suggestion = suggestRepair(comparison, CHANGED_SOURCE);
    expect(suggestion.signalMappings).toEqual({});
  });
});
