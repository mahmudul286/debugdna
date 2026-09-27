/**
 * Unit tests for analyzer/comparator.ts
 *
 * Pure in-process tests — no child processes, no network, no filesystem I/O.
 * All EvidenceSnapshot fixtures are built inline.
 */

import { describe, it, expect } from "vitest";
import { compareSnapshots } from "@/analyzer/comparator";
import { CANONICAL_SIGNAL_NAMES, type DiagnosticSignal, type EvidenceSnapshot } from "@/analyzer/types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeSignal(name: string): DiagnosticSignal {
  return {
    name,
    category: "log",
    location: "server.ts:42",
    present: true,
  };
}

function makeSnapshot(
  version: EvidenceSnapshot["version"],
  signalNames: string[],
  capturedAt = 1_000_000
): EvidenceSnapshot {
  return {
    version,
    scenarioId: "payment-provider-timeout",
    signals: signalNames.map(makeSignal),
    rawLogLines: [],
    capturedAt,
  };
}

/** All 7 canonical signal names */
const ALL_SIGNALS = [...CANONICAL_SIGNAL_NAMES];

/** The 2 signals retained in the demo changed version */
const CHANGED_SIGNALS = ["requestId", "orderId"];

/** The 5 signals lost in the demo */
const LOST_SIGNAL_NAMES = ["paymentProvider", "operation", "errorType", "errorCode", "originalMessage"];

// ---------------------------------------------------------------------------
// Severity thresholds
// ---------------------------------------------------------------------------

describe("compareSnapshots — severity thresholds", () => {
  it("0 lost signals → severity 'none'", () => {
    const baseline = makeSnapshot("baseline", ALL_SIGNALS);
    const changed = makeSnapshot("changed", ALL_SIGNALS);
    const result = compareSnapshots(baseline, changed);
    expect(result.severity).toBe("none");
    expect(result.lostSignals).toHaveLength(0);
  });

  it("1 lost signal → severity 'low'", () => {
    const baseline = makeSnapshot("baseline", ALL_SIGNALS);
    const changed = makeSnapshot("changed", ALL_SIGNALS.slice(1)); // drop requestId
    const result = compareSnapshots(baseline, changed);
    expect(result.severity).toBe("low");
    expect(result.lostSignals).toHaveLength(1);
  });

  it("2 lost signals → severity 'medium'", () => {
    const baseline = makeSnapshot("baseline", ALL_SIGNALS);
    const changed = makeSnapshot("changed", ALL_SIGNALS.slice(2));
    const result = compareSnapshots(baseline, changed);
    expect(result.severity).toBe("medium");
    expect(result.lostSignals).toHaveLength(2);
  });

  it("3 lost signals → severity 'medium'", () => {
    const baseline = makeSnapshot("baseline", ALL_SIGNALS);
    const changed = makeSnapshot("changed", ALL_SIGNALS.slice(3));
    const result = compareSnapshots(baseline, changed);
    expect(result.severity).toBe("medium");
    expect(result.lostSignals).toHaveLength(3);
  });

  it("4 lost signals → severity 'high'", () => {
    const baseline = makeSnapshot("baseline", ALL_SIGNALS);
    const changed = makeSnapshot("changed", ALL_SIGNALS.slice(4));
    const result = compareSnapshots(baseline, changed);
    expect(result.severity).toBe("high");
    expect(result.lostSignals).toHaveLength(4);
  });

  it("5 lost signals → severity 'high'", () => {
    const baseline = makeSnapshot("baseline", ALL_SIGNALS);
    const changed = makeSnapshot("changed", ALL_SIGNALS.slice(5));
    const result = compareSnapshots(baseline, changed);
    expect(result.severity).toBe("high");
    expect(result.lostSignals).toHaveLength(5);
  });

  it("6 lost signals → severity 'critical'", () => {
    const baseline = makeSnapshot("baseline", ALL_SIGNALS);
    const changed = makeSnapshot("changed", ALL_SIGNALS.slice(6));
    const result = compareSnapshots(baseline, changed);
    expect(result.severity).toBe("critical");
    expect(result.lostSignals).toHaveLength(6);
  });

  it("7 lost signals → severity 'critical'", () => {
    const baseline = makeSnapshot("baseline", ALL_SIGNALS);
    const changed = makeSnapshot("changed", []);
    const result = compareSnapshots(baseline, changed);
    expect(result.severity).toBe("critical");
    expect(result.lostSignals).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// Demo scenario: baseline=7 signals, changed=2 signals
// ---------------------------------------------------------------------------

describe("compareSnapshots — demo scenario (5 lost, high severity)", () => {
  const baseline = makeSnapshot("baseline", ALL_SIGNALS);
  const changed = makeSnapshot("changed", CHANGED_SIGNALS);
  const result = compareSnapshots(baseline, changed);

  it("produces severity 'high'", () => {
    expect(result.severity).toBe("high");
  });

  it("has exactly 5 lost signals", () => {
    expect(result.lostSignals).toHaveLength(5);
  });

  it("lost signal names match the expected 5", () => {
    const lostNames = result.lostSignals.map((s) => s.name).sort();
    expect(lostNames).toEqual([...LOST_SIGNAL_NAMES].sort());
  });

  it("has exactly 2 preserved signals", () => {
    expect(result.preservedSignals).toHaveLength(2);
  });

  it("preserved signal names are requestId and orderId", () => {
    const preservedNames = result.preservedSignals.map((s) => s.name).sort();
    expect(preservedNames).toEqual(["orderId", "requestId"]);
  });

  it("has 0 gained signals", () => {
    expect(result.gainedSignals).toHaveLength(0);
  });

  it("paymentProvider is in lostSignals", () => {
    const names = result.lostSignals.map((s) => s.name);
    expect(names).toContain("paymentProvider");
  });

  it("operation is in lostSignals", () => {
    const names = result.lostSignals.map((s) => s.name);
    expect(names).toContain("operation");
  });

  it("errorType is in lostSignals", () => {
    const names = result.lostSignals.map((s) => s.name);
    expect(names).toContain("errorType");
  });

  it("errorCode is in lostSignals", () => {
    const names = result.lostSignals.map((s) => s.name);
    expect(names).toContain("errorCode");
  });

  it("originalMessage is in lostSignals", () => {
    const names = result.lostSignals.map((s) => s.name);
    expect(names).toContain("originalMessage");
  });

  it("baseline and changed are preserved on the result", () => {
    expect(result.baseline).toBe(baseline);
    expect(result.changed).toBe(changed);
  });
});

// ---------------------------------------------------------------------------
// Gained signals
// ---------------------------------------------------------------------------

describe("compareSnapshots — gained signals", () => {
  it("detects a signal present in changed but not in baseline", () => {
    // baseline has 6 signals (no errorCode); changed has all 7.
    const noErrorCode = ALL_SIGNALS.filter((n) => n !== "errorCode");
    const baseline = makeSnapshot("baseline", noErrorCode);
    const changed = makeSnapshot("changed", ALL_SIGNALS);
    const result = compareSnapshots(baseline, changed);
    expect(result.gainedSignals).toHaveLength(1);
    expect(result.gainedSignals[0].name).toBe("errorCode");
    expect(result.lostSignals).toHaveLength(0);
    expect(result.severity).toBe("none");
  });

  it("a gained signal does not contribute to severity (severity is 0 lost = none)", () => {
    const baseline = makeSnapshot("baseline", ["requestId", "orderId"]);
    const changed = makeSnapshot("changed", ALL_SIGNALS);
    const result = compareSnapshots(baseline, changed);
    expect(result.severity).toBe("none");
    expect(result.lostSignals).toHaveLength(0);
    expect(result.gainedSignals).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Timestamp is ignored
// ---------------------------------------------------------------------------

describe("compareSnapshots — timestamp ignored", () => {
  it("different capturedAt values do not affect the result", () => {
    const baselineA = makeSnapshot("baseline", ALL_SIGNALS, 1_000_000);
    const changedA = makeSnapshot("changed", CHANGED_SIGNALS, 1_000_000);
    const baselineB = makeSnapshot("baseline", ALL_SIGNALS, 9_999_999);
    const changedB = makeSnapshot("changed", CHANGED_SIGNALS, 9_999_999);
    const resultA = compareSnapshots(baselineA, changedA);
    const resultB = compareSnapshots(baselineB, changedB);
    expect(resultA.severity).toBe(resultB.severity);
    expect(resultA.lostSignals.map((s) => s.name).sort()).toEqual(
      resultB.lostSignals.map((s) => s.name).sort()
    );
  });

  it("a snapshot with a 'timestamp' signal name in the raw array is filtered out — timestamp is not a canonical signal", () => {
    // Construct a snapshot whose signals array includes a signal named "timestamp".
    // The comparator must ignore it because "timestamp" is not in CANONICAL_SIGNAL_NAMES.
    const snapshotWithTs: EvidenceSnapshot = {
      version: "baseline",
      scenarioId: "payment-provider-timeout",
      signals: [
        ...ALL_SIGNALS.map(makeSignal),
        { name: "timestamp", category: "log", location: "server.ts:10", present: true },
      ],
      rawLogLines: [],
      capturedAt: 1_000_000,
    };
    const changed = makeSnapshot("changed", ALL_SIGNALS);
    const result = compareSnapshots(snapshotWithTs, changed);
    // All 7 canonical signals are present in both → 0 lost.
    expect(result.severity).toBe("none");
    expect(result.lostSignals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Non-canonical signal names in snapshot are ignored
// ---------------------------------------------------------------------------

describe("compareSnapshots — non-canonical names ignored", () => {
  it("extra non-canonical names in baseline do not create lost signals", () => {
    const baseline: EvidenceSnapshot = {
      version: "baseline",
      scenarioId: "payment-provider-timeout",
      signals: [
        ...ALL_SIGNALS.map(makeSignal),
        { name: "transactionId", category: "log", location: "server.ts:50", present: true },
        { name: "event", category: "log", location: "server.ts:51", present: true },
      ],
      rawLogLines: [],
      capturedAt: 1_000_000,
    };
    const changed = makeSnapshot("changed", ALL_SIGNALS);
    const result = compareSnapshots(baseline, changed);
    expect(result.severity).toBe("none");
    expect(result.lostSignals).toHaveLength(0);
    // "transactionId" and "event" are not canonical — they must not appear in any list.
    const allNames = [
      ...result.lostSignals,
      ...result.gainedSignals,
      ...result.preservedSignals,
    ].map((s) => s.name);
    expect(allNames).not.toContain("transactionId");
    expect(allNames).not.toContain("event");
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("compareSnapshots — determinism", () => {
  it("calling compareSnapshots twice with the same inputs yields the same result", () => {
    const baseline = makeSnapshot("baseline", ALL_SIGNALS);
    const changed = makeSnapshot("changed", CHANGED_SIGNALS);
    const r1 = compareSnapshots(baseline, changed);
    const r2 = compareSnapshots(baseline, changed);
    expect(r1.severity).toBe(r2.severity);
    expect(r1.lostSignals.map((s) => s.name)).toEqual(r2.lostSignals.map((s) => s.name));
    expect(r1.gainedSignals.map((s) => s.name)).toEqual(r2.gainedSignals.map((s) => s.name));
    expect(r1.preservedSignals.map((s) => s.name)).toEqual(r2.preservedSignals.map((s) => s.name));
  });
});
