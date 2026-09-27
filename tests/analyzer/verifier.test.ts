/**
 * Unit tests for analyzer/verifier.ts — pure helper logic only.
 *
 * These tests exercise the applyRepair() function without spawning any child
 * process, touching the filesystem, or making network requests.
 *
 * The integration test (tests/synthetic-app/verifier.test.ts) covers the full
 * verifyRepair() path that spawns a real server.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { applyRepair } from "@/analyzer/verifier";
import { suggestRepair } from "@/analyzer/repair-suggester";
import { compareSnapshots } from "@/analyzer/comparator";
import { CANONICAL_SIGNAL_NAMES } from "@/analyzer/types";
import type { DiagnosticSignal, EvidenceSnapshot } from "@/analyzer/types";

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
// (inline fixture; the real file is never read by applyRepair)
// ---------------------------------------------------------------------------

const CHANGED_SOURCE = `import express, { Request, Response, NextFunction } from "express";
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
      logger.error({ requestId, orderId });
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
// Fixtures — comparison result with 5 lost signals
// ---------------------------------------------------------------------------

const ALL_SIGNAL_NAMES = [...CANONICAL_SIGNAL_NAMES];
const CHANGED_SIGNAL_NAMES = ["requestId", "orderId"];
const LOST_SIGNAL_NAMES = ["paymentProvider", "operation", "errorType", "errorCode", "originalMessage"];

const baseline = makeSnapshot("baseline", ALL_SIGNAL_NAMES);
const changed = makeSnapshot("changed", CHANGED_SIGNAL_NAMES);
const comparison = compareSnapshots(baseline, changed);
const suggestion = suggestRepair(comparison, CHANGED_SOURCE);

// ---------------------------------------------------------------------------
// A. Repair application — pure string checks (no filesystem, no child process)
// ---------------------------------------------------------------------------

describe("applyRepair — repaired source content", () => {
  const repairedSource = applyRepair(CHANGED_SOURCE, suggestion, comparison);

  it("returns a non-empty string", () => {
    expect(typeof repairedSource).toBe("string");
    expect(repairedSource.length).toBeGreaterThan(0);
  });

  it("repaired source contains paymentProvider signal", () => {
    expect(repairedSource).toContain("paymentProvider");
  });

  it("repaired source contains operation signal", () => {
    expect(repairedSource).toContain("operation");
  });

  it("repaired source contains errorType signal", () => {
    expect(repairedSource).toContain("errorType");
  });

  it("repaired source contains errorCode signal", () => {
    expect(repairedSource).toContain("errorCode");
  });

  it("repaired source contains originalMessage signal", () => {
    expect(repairedSource).toContain("originalMessage");
  });

  it("repaired source still contains requestId", () => {
    // requestId was preserved — it must remain in the repaired call.
    expect(repairedSource).toContain("requestId");
  });

  it("repaired source still contains orderId", () => {
    expect(repairedSource).toContain("orderId");
  });

  it("repaired source does NOT contain the degraded next(new Error) propagation", () => {
    expect(repairedSource).not.toContain('next(new Error("Payment failed"))');
  });

  it("repaired source contains the fixed 502 response", () => {
    expect(repairedSource).toContain("res.status(502)");
    expect(repairedSource).toContain("err.code");
  });
});

describe("applyRepair — unrelated source is not modified", () => {
  const repairedSource = applyRepair(CHANGED_SOURCE, suggestion, comparison);

  it("import statements are unchanged", () => {
    expect(repairedSource).toContain('import express, { Request, Response, NextFunction }');
    expect(repairedSource).toContain('import { randomUUID }');
    expect(repairedSource).toContain('import { chargePayment, PaymentError }');
    expect(repairedSource).toContain('import { logger }');
  });

  it("success path is unchanged", () => {
    expect(repairedSource).toContain("payment.success");
    expect(repairedSource).toContain("transactionId: result.transactionId");
  });

  it("unexpected-error branch is unchanged", () => {
    expect(repairedSource).toContain("payment.unexpected_error");
    expect(repairedSource).toContain("res.status(500)");
  });

  it("server listen boilerplate is unchanged", () => {
    expect(repairedSource).toContain("app.listen");
    expect(repairedSource).toContain("SERVER_READY");
  });
});

describe("applyRepair — determinism", () => {
  it("calling applyRepair twice with the same inputs yields identical output", () => {
    const r1 = applyRepair(CHANGED_SOURCE, suggestion, comparison);
    const r2 = applyRepair(CHANGED_SOURCE, suggestion, comparison);
    expect(r1).toBe(r2);
  });
});

describe("applyRepair — baseline source is NOT required", () => {
  it("does not accept a baseline source parameter (function only takes changedSource)", () => {
    // applyRepair(changedSource, suggestion, comparison) — 3 parameters; no baseline.
    // This test confirms the signature is correct and the call succeeds.
    expect(() => applyRepair(CHANGED_SOURCE, suggestion, comparison)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Report builder — pure unit test
// ---------------------------------------------------------------------------

import { buildDiagnosticReport } from "@/analyzer/report-builder";
import type { VerificationResult } from "@/analyzer/types";

describe("buildDiagnosticReport", () => {
  const scenario = {
    id: "payment-provider-timeout",
    description: "Payment provider timeout",
    endpoint: "POST /api/orders/:orderId/payment",
    injectedCondition: "timeout" as const,
    expectedSignals: [...CANONICAL_SIGNAL_NAMES],
  };

  const demoRepaired: EvidenceSnapshot = {
    version: "repaired",
    scenarioId: "payment-provider-timeout",
    signals: ALL_SIGNAL_NAMES.map(makeSignal),
    rawLogLines: [],
    capturedAt: Date.now(),
  };

  const verification: VerificationResult = {
    restored: true,
    restoredSignals: LOST_SIGNAL_NAMES.map(makeSignal),
    stillMissing: [],
    repaired: demoRepaired,
  };

  // buildDiagnosticReport is now async (calls granite-explainer internally).
  // No WATSONX_API_KEY is set in tests → graniteExplanation will be undefined.
  let report: import("@/analyzer/types").DiagnosticReport;
  beforeAll(async () => {
    report = await buildDiagnosticReport({ scenario, comparison, repair: suggestion, verification });
  });

  it("returns a DiagnosticReport with a runId", () => {
    expect(typeof report.runId).toBe("string");
    expect(report.runId.length).toBeGreaterThan(0);
  });

  it("runId contains the scenario id", () => {
    expect(report.runId).toContain("payment-provider-timeout");
  });

  it("preserves the scenario", () => {
    expect(report.scenario).toBe(scenario);
  });

  it("preserves comparison severity = high", () => {
    expect(report.comparison.severity).toBe("high");
  });

  it("preserves lostSignals list (5 items)", () => {
    expect(report.comparison.lostSignals).toHaveLength(5);
  });

  it("preserves preservedSignals list (2 items)", () => {
    expect(report.comparison.preservedSignals).toHaveLength(2);
  });

  it("preserves repair", () => {
    expect(report.repair).toBe(suggestion);
  });

  it("preserves verification result", () => {
    expect(report.verification).toBe(verification);
  });

  it("preserves verification.restored = true", () => {
    expect(report.verification.restored).toBe(true);
  });

  it("preserves verification.stillMissing = []", () => {
    expect(report.verification.stillMissing).toHaveLength(0);
  });

  it("graniteExplanation is undefined when no WATSONX_API_KEY is set", () => {
    expect(report.graniteExplanation).toBeUndefined();
  });

  it("two calls produce distinct runIds", async () => {
    const r1 = await buildDiagnosticReport({ scenario, comparison, repair: suggestion, verification });
    // Ensure at least 1ms passes so Date.now() differs.
    const start = Date.now();
    while (Date.now() === start) { /* spin */ }
    const r2 = await buildDiagnosticReport({ scenario, comparison, repair: suggestion, verification });
    expect(r1.runId).not.toBe(r2.runId);
  });
});
