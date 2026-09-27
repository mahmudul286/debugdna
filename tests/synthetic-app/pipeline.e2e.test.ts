/**
 * End-to-end pipeline test — DebugDNA full flow.
 *
 * Executes the complete pipeline:
 *
 *   baseline run (real child process)
 *   → collect baseline evidence
 *   → changed run (real child process)
 *   → collect changed evidence
 *   → compare snapshots
 *   → generate repair suggestion
 *   → apply repair + repaired run (real child process via verifier)
 *   → collect repaired evidence
 *   → verify restoration
 *   → build DiagnosticReport
 *
 * Expected invariants:
 *   - baseline: 7/7 canonical signals present
 *   - changed: 2/7 canonical signals (requestId + orderId only)
 *   - lost: exactly 5 signals
 *   - severity: "high"
 *   - repaired: 7/7 canonical signals present
 *   - restored: true
 *   - stillMissing: []
 *   - HTTP 502 is returned in all three runs
 *
 * Reliability:
 *   - Random free ports (no fixed ports).
 *   - Bounded startup/request timeouts.
 *   - stdout + stderr captured for all runs.
 *   - Child processes cleaned up in finally blocks.
 *   - On failure, actual process output is included in the error.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

import { runFailureScenario } from "../../analyzer/failure-runner";
import { collectEvidence } from "../../analyzer/evidence-collector";
import { compareSnapshots } from "../../analyzer/comparator";
import { suggestRepair } from "../../analyzer/repair-suggester";
import { verifyRepair } from "../../analyzer/verifier";
import { buildDiagnosticReport } from "../../analyzer/report-builder";
import { CANONICAL_SIGNAL_NAMES } from "../../analyzer/types";
import type { DiagnosticReport, EvidenceSnapshot } from "../../analyzer/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCENARIO = {
  id: "payment-provider-timeout",
  description: "Payment provider timeout — DebugDNA E2E scenario",
  endpoint: "POST /api/orders/:orderId/payment",
  injectedCondition: "timeout" as const,
  expectedSignals: [...CANONICAL_SIGNAL_NAMES],
};

const CHANGED_SOURCE_PATH = path.resolve(
  __dirname,
  "../../synthetic-app/changed/server.ts"
);

const LOST_SIGNAL_NAMES = [
  "paymentProvider",
  "operation",
  "errorType",
  "errorCode",
  "originalMessage",
];

// ---------------------------------------------------------------------------
// Pipeline state — filled in beforeAll, consumed by all tests
// ---------------------------------------------------------------------------

let baselineOutput: { statusCode: number; stdout: string; stderr: string };
let changedOutput: { statusCode: number; stdout: string; stderr: string };
let baselineSnapshot: EvidenceSnapshot;
let changedSnapshot: EvidenceSnapshot;
let report: DiagnosticReport;

beforeAll(async () => {
  // ------- Step 1: Baseline run -------
  const baselineRun = await runFailureScenario("baseline", "e2e-order-001");
  baselineOutput = {
    statusCode: baselineRun.statusCode,
    stdout: baselineRun.stdout,
    stderr: baselineRun.stderr,
  };
  baselineSnapshot = collectEvidence({
    rawOutput: baselineRun.stdout + "\n" + baselineRun.stderr,
    version: "baseline",
    scenarioId: SCENARIO.id,
    sourceFile: "baseline/server.ts",
  });

  // ------- Step 2: Changed run -------
  const changedRun = await runFailureScenario("changed", "e2e-order-002");
  changedOutput = {
    statusCode: changedRun.statusCode,
    stdout: changedRun.stdout,
    stderr: changedRun.stderr,
  };
  changedSnapshot = collectEvidence({
    rawOutput: changedRun.stdout + "\n" + changedRun.stderr,
    version: "changed",
    scenarioId: SCENARIO.id,
    sourceFile: "changed/server.ts",
  });

  // ------- Step 3: Compare -------
  const comparison = compareSnapshots(baselineSnapshot, changedSnapshot);

  // ------- Step 4: Generate repair -------
  const changedSource = fs.readFileSync(CHANGED_SOURCE_PATH, "utf-8");
  const repair = suggestRepair(comparison, changedSource);

  // ------- Step 5: Verify repair (apply + repaired run + collect + verify) -------
  const verification = await verifyRepair({
    changedSource,
    suggestion: repair,
    comparison,
    scenario: SCENARIO,
    orderId: "e2e-order-003",
  });

  // ------- Step 6: Build report -------
  report = await buildDiagnosticReport({ scenario: SCENARIO, comparison, repair, verification });
}, 90_000);

// ---------------------------------------------------------------------------
// Baseline run
// ---------------------------------------------------------------------------

describe("E2E pipeline — baseline run", () => {
  it("baseline returns HTTP 502", () => {
    expect(baselineOutput.statusCode).toBe(502);
  });

  it("baseline evidence contains all 7 canonical signals", () => {
    const names = baselineSnapshot.signals.map((s) => s.name);
    for (const canonical of CANONICAL_SIGNAL_NAMES) {
      expect(names, `expected "${canonical}" in baseline`).toContain(canonical);
    }
  });

  it("baseline evidence has exactly 7 signals", () => {
    expect(baselineSnapshot.signals).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// Changed run
// ---------------------------------------------------------------------------

describe("E2E pipeline — changed run", () => {
  it("changed returns HTTP 502 (functional parity)", () => {
    expect(changedOutput.statusCode).toBe(502);
  });

  it("changed evidence has exactly 2 signals (requestId + orderId)", () => {
    expect(changedSnapshot.signals).toHaveLength(2);
  });

  it("changed evidence contains requestId", () => {
    expect(changedSnapshot.signals.map((s) => s.name)).toContain("requestId");
  });

  it("changed evidence contains orderId", () => {
    expect(changedSnapshot.signals.map((s) => s.name)).toContain("orderId");
  });

  it("changed evidence is missing all 5 degraded signals", () => {
    const names = changedSnapshot.signals.map((s) => s.name);
    for (const lost of LOST_SIGNAL_NAMES) {
      expect(names, `"${lost}" should be absent from changed evidence`).not.toContain(lost);
    }
  });
});

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

describe("E2E pipeline — comparison result", () => {
  it("lostSignals count is exactly 5", () => {
    expect(report.comparison.lostSignals).toHaveLength(5);
  });

  it("lostSignals names match the 5 expected signals", () => {
    const names = report.comparison.lostSignals.map((s) => s.name).sort();
    expect(names).toEqual([...LOST_SIGNAL_NAMES].sort());
  });

  it("severity is 'high'", () => {
    expect(report.comparison.severity).toBe("high");
  });

  it("preservedSignals has 2 entries (requestId, orderId)", () => {
    expect(report.comparison.preservedSignals).toHaveLength(2);
  });

  it("gainedSignals is empty", () => {
    expect(report.comparison.gainedSignals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

describe("E2E pipeline — repair suggestion", () => {
  it("repair has signalMappings for all 5 lost signals", () => {
    expect(Object.keys(report.repair.signalMappings)).toHaveLength(5);
  });

  it("repair patch contains paymentProvider", () => {
    expect(report.repair.patch).toContain("paymentProvider");
  });

  it("repair patch removes degraded propagation", () => {
    expect(report.repair.patch).toContain('next(new Error("Payment failed"))');
  });

  it("repair patch adds direct 502 response", () => {
    expect(report.repair.patch).toContain("res.status(502)");
  });
});

// ---------------------------------------------------------------------------
// Repaired run — verification
// ---------------------------------------------------------------------------

describe("E2E pipeline — repaired run", () => {
  it("repaired evidence contains all 7 canonical signals", () => {
    const names = report.verification.repaired.signals.map((s) => s.name);
    for (const canonical of CANONICAL_SIGNAL_NAMES) {
      expect(names, `expected "${canonical}" in repaired evidence`).toContain(canonical);
    }
  });

  it("repaired evidence has exactly 7 signals", () => {
    expect(report.verification.repaired.signals).toHaveLength(7);
  });

  it("all 5 previously lost signals are individually restored", () => {
    for (const name of LOST_SIGNAL_NAMES) {
      const found = report.verification.restoredSignals.some((s) => s.name === name);
      expect(found, `"${name}" should be in restoredSignals`).toBe(true);
    }
  });

  it("restoredSignals has exactly 5 entries", () => {
    expect(report.verification.restoredSignals).toHaveLength(5);
  });

  it("stillMissing is empty", () => {
    expect(report.verification.stillMissing).toHaveLength(0);
  });

  it("restored === true", () => {
    expect(report.verification.restored).toBe(true);
  });

  it("repaired server still triggers payment failure (errorCode in log)", () => {
    const hasErrorCode = report.verification.repaired.rawLogLines.some((line) => {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        return typeof obj["errorCode"] === "string";
      } catch {
        return false;
      }
    });
    expect(hasErrorCode, "repaired server must log errorCode on failure").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DiagnosticReport
// ---------------------------------------------------------------------------

describe("E2E pipeline — DiagnosticReport", () => {
  it("report has a non-empty runId", () => {
    expect(typeof report.runId).toBe("string");
    expect(report.runId.length).toBeGreaterThan(0);
  });

  it("report.scenario matches the injected scenario", () => {
    expect(report.scenario.id).toBe("payment-provider-timeout");
    expect(report.scenario.injectedCondition).toBe("timeout");
  });

  it("report.comparison.severity is 'high'", () => {
    expect(report.comparison.severity).toBe("high");
  });

  it("report.verification.restored is true", () => {
    expect(report.verification.restored).toBe(true);
  });

  it("report.verification.stillMissing is empty", () => {
    expect(report.verification.stillMissing).toHaveLength(0);
  });

  it("graniteExplanation is undefined (not implemented in Sub-Task 7)", () => {
    expect(report.graniteExplanation).toBeUndefined();
  });

  it("report has all required top-level fields", () => {
    expect(report).toHaveProperty("runId");
    expect(report).toHaveProperty("scenario");
    expect(report).toHaveProperty("comparison");
    expect(report).toHaveProperty("repair");
    expect(report).toHaveProperty("verification");
  });
});
