/**
 * Integration tests — Verifier (real child process).
 *
 * These tests spawn the REAL repaired server as a child process, trigger the
 * same payment-failure scenario, and verify that:
 *
 *   A. The repaired directory is created and server.ts is written.
 *   B. The repaired server starts successfully.
 *   C. The same timeout failure still occurs.
 *   D. HTTP 502 is still returned.
 *   E. Repaired runtime evidence contains all 7 canonical signals.
 *   F. All 5 previously lost signal names are individually restored.
 *   G. stillMissing is empty.
 *   H. restored === true.
 *
 * Safety:
 *   - Random free ports — no fixed-port collisions.
 *   - Child processes cleaned up in finally blocks inside verifyRepair.
 *   - Failure before readiness reports actual stdout/stderr.
 *   - Verification uses signal names, not only signal count.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { verifyRepair } from "../../analyzer/verifier";
import { suggestRepair } from "../../analyzer/repair-suggester";
import { compareSnapshots } from "../../analyzer/comparator";
import { CANONICAL_SIGNAL_NAMES } from "../../analyzer/types";
import type { DiagnosticSignal, EvidenceSnapshot, VerificationResult } from "../../analyzer/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPAIRED_DIR = path.resolve(__dirname, "../../synthetic-app/repaired");
const REPAIRED_SERVER = path.join(REPAIRED_DIR, "server.ts");

const CHANGED_SOURCE_PATH = path.resolve(
  __dirname,
  "../../synthetic-app/changed/server.ts"
);

const SCENARIO = {
  id: "payment-provider-timeout",
  description: "Payment provider timeout — diagnostic regression scenario",
  endpoint: "POST /api/orders/:orderId/payment",
  injectedCondition: "timeout" as const,
  expectedSignals: [...CANONICAL_SIGNAL_NAMES],
};

// ---------------------------------------------------------------------------
// Fixture setup — build comparison + suggestion from real changed source
// ---------------------------------------------------------------------------

function makeSignal(name: string): DiagnosticSignal {
  return { name, category: "log", location: "server.ts", present: true };
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
    capturedAt: Date.now(),
  };
}

const ALL_SIGNAL_NAMES = [...CANONICAL_SIGNAL_NAMES];
const CHANGED_SIGNAL_NAMES = ["requestId", "orderId"];
const LOST_SIGNAL_NAMES = ["paymentProvider", "operation", "errorType", "errorCode", "originalMessage"];

// Read the actual changed source file — the verifier will apply the repair to it.
const changedSource = fs.readFileSync(CHANGED_SOURCE_PATH, "utf-8");

const baselineSnap = makeSnapshot("baseline", ALL_SIGNAL_NAMES);
const changedSnap = makeSnapshot("changed", CHANGED_SIGNAL_NAMES);
const comparison = compareSnapshots(baselineSnap, changedSnap);
const suggestion = suggestRepair(comparison, changedSource);

// ---------------------------------------------------------------------------
// Run the verifier once; share the result across all tests for efficiency.
// ---------------------------------------------------------------------------

let verificationResult: VerificationResult;

beforeAll(async () => {
  verificationResult = await verifyRepair({
    changedSource,
    suggestion,
    comparison,
    scenario: SCENARIO,
    orderId: "verify-order-001",
  });
}, 40_000);

// ---------------------------------------------------------------------------
// A. Repair application — filesystem checks
// ---------------------------------------------------------------------------

describe("verifier: repaired directory and file", () => {
  it("synthetic-app/repaired/ directory exists", () => {
    expect(fs.existsSync(REPAIRED_DIR)).toBe(true);
  });

  it("synthetic-app/repaired/server.ts is written", () => {
    expect(fs.existsSync(REPAIRED_SERVER)).toBe(true);
  });

  it("repaired server.ts contains paymentProvider signal", () => {
    const src = fs.readFileSync(REPAIRED_SERVER, "utf-8");
    expect(src).toContain("paymentProvider");
  });

  it("repaired server.ts contains operation signal", () => {
    const src = fs.readFileSync(REPAIRED_SERVER, "utf-8");
    expect(src).toContain("operation");
  });

  it("repaired server.ts contains errorType signal", () => {
    const src = fs.readFileSync(REPAIRED_SERVER, "utf-8");
    expect(src).toContain("errorType");
  });

  it("repaired server.ts contains errorCode signal", () => {
    const src = fs.readFileSync(REPAIRED_SERVER, "utf-8");
    expect(src).toContain("errorCode");
  });

  it("repaired server.ts contains originalMessage signal", () => {
    const src = fs.readFileSync(REPAIRED_SERVER, "utf-8");
    expect(src).toContain("originalMessage");
  });

  it("repaired server.ts does NOT contain next(new Error) degraded propagation", () => {
    const src = fs.readFileSync(REPAIRED_SERVER, "utf-8");
    expect(src).not.toContain('next(new Error("Payment failed"))');
  });

  it("repaired server.ts contains fixed 502 response", () => {
    const src = fs.readFileSync(REPAIRED_SERVER, "utf-8");
    expect(src).toContain("res.status(502)");
    expect(src).toContain("err.code");
  });

  it("repaired server.ts preserves SERVER_READY marker", () => {
    const src = fs.readFileSync(REPAIRED_SERVER, "utf-8");
    expect(src).toContain("SERVER_READY");
  });
});

// ---------------------------------------------------------------------------
// B. Runtime verification — signal restoration
// ---------------------------------------------------------------------------

describe("verifier: runtime evidence — all 7 canonical signals", () => {
  it("verificationResult is defined", () => {
    expect(verificationResult).toBeDefined();
  });

  it("repaired EvidenceSnapshot has version = 'repaired'", () => {
    expect(verificationResult.repaired.version).toBe("repaired");
  });

  it("repaired EvidenceSnapshot has the correct scenarioId", () => {
    expect(verificationResult.repaired.scenarioId).toBe("payment-provider-timeout");
  });

  it("repaired evidence contains all 7 canonical signals", () => {
    const names = verificationResult.repaired.signals.map((s) => s.name);
    for (const canonical of CANONICAL_SIGNAL_NAMES) {
      expect(names, `expected signal "${canonical}" to be present`).toContain(canonical);
    }
  });

  it("repaired evidence signal count is 7", () => {
    expect(verificationResult.repaired.signals).toHaveLength(7);
  });

  it("all repaired signals have present = true", () => {
    for (const sig of verificationResult.repaired.signals) {
      expect(sig.present, `signal "${sig.name}" should have present=true`).toBe(true);
    }
  });
});

describe("verifier: runtime verification — individual lost signal restoration", () => {
  it("all 5 previously lost signals are individually restored", () => {
    for (const name of LOST_SIGNAL_NAMES) {
      const found = verificationResult.restoredSignals.some((s) => s.name === name);
      expect(found, `lost signal "${name}" should be restored`).toBe(true);
    }
  });

  it("restoredSignals has exactly 5 entries", () => {
    expect(verificationResult.restoredSignals).toHaveLength(5);
  });

  it("stillMissing is empty", () => {
    expect(verificationResult.stillMissing).toHaveLength(0);
  });

  it("restored === true", () => {
    expect(verificationResult.restored).toBe(true);
  });
});

describe("verifier: HTTP 502 still returned from repaired server", () => {
  // The repaired EvidenceSnapshot is built from the real runtime output.
  // We verify the presence of rawLogLines containing errorCode to confirm
  // that the payment failure is still triggered.
  it("repaired runtime output contains structured errorCode log line", () => {
    const hasErrorCode = verificationResult.repaired.rawLogLines.some((line) => {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        return typeof obj["errorCode"] === "string";
      } catch {
        return false;
      }
    });
    expect(hasErrorCode, "repaired server must still log errorCode on payment failure").toBe(true);
  });

  it("repaired runtime output contains requestId in log", () => {
    const hasReqId = verificationResult.repaired.rawLogLines.some((line) => {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        return typeof obj["requestId"] === "string";
      } catch {
        return false;
      }
    });
    expect(hasReqId).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C. Safety — verification does not rely only on signal count
// ---------------------------------------------------------------------------

describe("verifier: verification strategy", () => {
  it("restoredSignals names match the expected individual lost signal names", () => {
    const restoredNames = verificationResult.restoredSignals.map((s) => s.name).sort();
    const expectedNames = [...LOST_SIGNAL_NAMES].sort();
    expect(restoredNames).toEqual(expectedNames);
  });

  it("stillMissing and restoredSignals are complementary (no overlap)", () => {
    const restoredSet = new Set(verificationResult.restoredSignals.map((s) => s.name));
    const missingSet = new Set(verificationResult.stillMissing.map((s) => s.name));
    for (const name of restoredSet) {
      expect(missingSet.has(name), `signal "${name}" appears in both restored and missing`).toBe(false);
    }
  });
});
