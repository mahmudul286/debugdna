/**
 * Unit tests — Evidence Collector.
 *
 * All tests are pure: no child processes, no network, no filesystem.
 * Inputs are inline fixture strings.
 */

import { describe, it, expect } from "vitest";
import { collectEvidence } from "../../analyzer/evidence-collector";
import { CANONICAL_SIGNAL_NAMES } from "../../analyzer/types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a newline-delimited JSON log line from a plain object. */
function jsonLine(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

/** The full 7-signal baseline diagnostic record. */
const BASELINE_RECORD = {
  level: "error",
  timestamp: "2024-06-01T10:00:00.000Z",
  requestId: "req-abc-123",
  orderId: "order-xyz-456",
  paymentProvider: "AcmePay",
  operation: "chargePayment",
  errorType: "PaymentError",
  errorCode: "PROVIDER_TIMEOUT",
  originalMessage: "Payment provider AcmePay timed out",
};

/** The 2-signal changed diagnostic record (degraded). */
const CHANGED_RECORD = {
  level: "error",
  timestamp: "2024-06-01T10:00:01.000Z",
  requestId: "req-def-789",
  orderId: "order-uvw-012",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("collectEvidence — baseline (7 canonical signals)", () => {
  const rawOutput = [
    jsonLine({ level: "info", timestamp: "2024-06-01T09:59:59.000Z", event: "server.start", port: 3199 }),
    `SERVER_READY:3199`,
    jsonLine(BASELINE_RECORD),
  ].join("\n");

  const snapshot = collectEvidence({
    rawOutput,
    version: "baseline",
    scenarioId: "payment-provider-timeout",
  });

  it("returns version = baseline", () => {
    expect(snapshot.version).toBe("baseline");
  });

  it("returns correct scenarioId", () => {
    expect(snapshot.scenarioId).toBe("payment-provider-timeout");
  });

  it("extracts all 7 canonical signals", () => {
    const names = snapshot.signals.map((s) => s.name);
    for (const canonical of CANONICAL_SIGNAL_NAMES) {
      expect(names).toContain(canonical);
    }
    expect(snapshot.signals).toHaveLength(7);
  });

  it("marks all signals present=true", () => {
    for (const signal of snapshot.signals) {
      expect(signal.present).toBe(true);
    }
  });

  it("captures requestId value", () => {
    const sig = snapshot.signals.find((s) => s.name === "requestId");
    expect(sig?.value).toBe("req-abc-123");
  });

  it("captures orderId value", () => {
    const sig = snapshot.signals.find((s) => s.name === "orderId");
    expect(sig?.value).toBe("order-xyz-456");
  });

  it("captures paymentProvider value", () => {
    const sig = snapshot.signals.find((s) => s.name === "paymentProvider");
    expect(sig?.value).toBe("AcmePay");
  });

  it("captures operation value", () => {
    const sig = snapshot.signals.find((s) => s.name === "operation");
    expect(sig?.value).toBe("chargePayment");
  });

  it("captures errorType value", () => {
    const sig = snapshot.signals.find((s) => s.name === "errorType");
    expect(sig?.value).toBe("PaymentError");
  });

  it("captures errorCode value", () => {
    const sig = snapshot.signals.find((s) => s.name === "errorCode");
    expect(sig?.value).toBe("PROVIDER_TIMEOUT");
  });

  it("captures originalMessage value", () => {
    const sig = snapshot.signals.find((s) => s.name === "originalMessage");
    expect(sig?.value).toBe("Payment provider AcmePay timed out");
  });

  it("does NOT include timestamp as a signal", () => {
    const names = snapshot.signals.map((s) => s.name);
    expect(names).not.toContain("timestamp");
  });

  it("stores timestamp value in capturedAt (not zero)", () => {
    // The server.start line at 09:59:59 should be the earliest timestamp.
    expect(snapshot.capturedAt).toBe(Date.parse("2024-06-01T09:59:59.000Z"));
  });

  it("rawLogLines contains only valid JSON records (excludes SERVER_READY)", () => {
    // SERVER_READY is not JSON — must not appear
    for (const line of snapshot.rawLogLines) {
      expect(() => JSON.parse(line)).not.toThrow();
      expect(line).not.toMatch(/SERVER_READY/);
    }
  });
});

// ---------------------------------------------------------------------------

describe("collectEvidence — changed (2 canonical signals)", () => {
  const rawOutput = [
    jsonLine({ level: "info", timestamp: "2024-06-01T10:00:00.500Z", event: "server.start", port: 3198 }),
    `SERVER_READY:3198`,
    jsonLine(CHANGED_RECORD),
  ].join("\n");

  const snapshot = collectEvidence({
    rawOutput,
    version: "changed",
    scenarioId: "payment-provider-timeout",
  });

  it("returns version = changed", () => {
    expect(snapshot.version).toBe("changed");
  });

  it("extracts exactly 2 canonical signals", () => {
    expect(snapshot.signals).toHaveLength(2);
  });

  it("contains requestId", () => {
    const names = snapshot.signals.map((s) => s.name);
    expect(names).toContain("requestId");
  });

  it("contains orderId", () => {
    const names = snapshot.signals.map((s) => s.name);
    expect(names).toContain("orderId");
  });

  it("does NOT contain paymentProvider", () => {
    const names = snapshot.signals.map((s) => s.name);
    expect(names).not.toContain("paymentProvider");
  });

  it("does NOT contain operation", () => {
    const names = snapshot.signals.map((s) => s.name);
    expect(names).not.toContain("operation");
  });

  it("does NOT contain errorType", () => {
    const names = snapshot.signals.map((s) => s.name);
    expect(names).not.toContain("errorType");
  });

  it("does NOT contain errorCode", () => {
    const names = snapshot.signals.map((s) => s.name);
    expect(names).not.toContain("errorCode");
  });

  it("does NOT contain originalMessage", () => {
    const names = snapshot.signals.map((s) => s.name);
    expect(names).not.toContain("originalMessage");
  });

  it("does NOT include timestamp as a signal", () => {
    const names = snapshot.signals.map((s) => s.name);
    expect(names).not.toContain("timestamp");
  });
});

// ---------------------------------------------------------------------------

describe("collectEvidence — SERVER_READY lines ignored", () => {
  const rawOutput = [
    `SERVER_READY:9999`,
    `SERVER_READY:0`,
    jsonLine({ level: "error", timestamp: "2024-06-01T10:00:02.000Z", requestId: "r1", orderId: "o1" }),
  ].join("\n");

  const snapshot = collectEvidence({
    rawOutput,
    version: "baseline",
    scenarioId: "payment-provider-timeout",
  });

  it("SERVER_READY lines do not appear in rawLogLines", () => {
    for (const line of snapshot.rawLogLines) {
      expect(line).not.toMatch(/^SERVER_READY:/);
    }
  });

  it("still extracts signals from the JSON line", () => {
    const names = snapshot.signals.map((s) => s.name);
    expect(names).toContain("requestId");
    expect(names).toContain("orderId");
  });
});

// ---------------------------------------------------------------------------

describe("collectEvidence — malformed / non-JSON lines ignored", () => {
  const rawOutput = [
    "not json at all",
    "   ",
    "{broken json",
    "[1,2,3]", // JSON array — not an object record
    "42",       // JSON primitive
    jsonLine({ level: "error", timestamp: "2024-06-01T10:00:03.000Z", requestId: "r2", orderId: "o2" }),
    "another plain text line",
  ].join("\n");

  const snapshot = collectEvidence({
    rawOutput,
    version: "baseline",
    scenarioId: "payment-provider-timeout",
  });

  it("does not throw on any malformed line", () => {
    expect(snapshot).toBeDefined();
  });

  it("rawLogLines contains only the valid JSON object line", () => {
    expect(snapshot.rawLogLines).toHaveLength(1);
  });

  it("extracts signals from the valid line only", () => {
    const names = snapshot.signals.map((s) => s.name);
    expect(names).toContain("requestId");
    expect(names).toContain("orderId");
    expect(snapshot.signals).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

describe("collectEvidence — never invents missing signals", () => {
  // A log with NO canonical signal fields at all.
  const rawOutput = jsonLine({
    level: "info",
    timestamp: "2024-06-01T10:00:04.000Z",
    event: "server.start",
    port: 3100,
  });

  const snapshot = collectEvidence({
    rawOutput,
    version: "baseline",
    scenarioId: "payment-provider-timeout",
  });

  it("signals array is empty when no canonical fields are present", () => {
    expect(snapshot.signals).toHaveLength(0);
  });

  it("rawLogLines still contains the JSON line", () => {
    expect(snapshot.rawLogLines).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("collectEvidence — capturedAt metadata preserved", () => {
  const ts = "2024-06-01T12:34:56.789Z";
  const rawOutput = jsonLine({
    level: "info",
    timestamp: ts,
    requestId: "r3",
    orderId: "o3",
  });

  const snapshot = collectEvidence({
    rawOutput,
    version: "baseline",
    scenarioId: "payment-provider-timeout",
  });

  it("capturedAt matches the timestamp in the log", () => {
    expect(snapshot.capturedAt).toBe(Date.parse(ts));
  });

  it("timestamp does not appear in signals", () => {
    const names = snapshot.signals.map((s) => s.name);
    expect(names).not.toContain("timestamp");
  });
});

// ---------------------------------------------------------------------------

describe("collectEvidence — empty input", () => {
  const snapshot = collectEvidence({
    rawOutput: "",
    version: "baseline",
    scenarioId: "payment-provider-timeout",
  });

  it("returns an EvidenceSnapshot with empty signals and rawLogLines", () => {
    expect(snapshot.signals).toHaveLength(0);
    expect(snapshot.rawLogLines).toHaveLength(0);
  });
});
