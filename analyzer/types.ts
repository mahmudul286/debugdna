/**
 * DebugDNA — shared data model.
 *
 * The 7 canonical diagnostic signal names are:
 *   requestId | orderId | paymentProvider | operation |
 *   errorType | errorCode | originalMessage
 *
 * `timestamp` is log metadata only. It is stored as `capturedAt` (Unix ms)
 * on EvidenceSnapshot and must NOT appear in expectedSignals, signal
 * comparison, severity calculation, repair suggestions, or verification.
 */

// ---------------------------------------------------------------------------
// Canonical signal names — the ONLY names that participate in comparison,
// severity, repair, and verification logic.
// ---------------------------------------------------------------------------
export const CANONICAL_SIGNAL_NAMES = [
  "requestId",
  "orderId",
  "paymentProvider",
  "operation",
  "errorType",
  "errorCode",
  "originalMessage",
] as const;

export type CanonicalSignalName = (typeof CANONICAL_SIGNAL_NAMES)[number];

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * A single observable diagnostic field present in a log or error statement.
 * `name` must be one of the 7 canonical signal names.
 */
export interface DiagnosticSignal {
  name: string; // one of the 7 canonical names
  category: "log" | "error" | "context";
  location: string; // file + line reference, e.g. "server.ts:42"
  present: boolean; // whether this signal was observed in the run
  value?: string; // observed value, if captured
}

/**
 * All diagnostic evidence captured from one run.
 * rawLogLines may include timestamp-bearing lines as metadata; timestamp is
 * NOT extracted as a signal. capturedAt holds the timestamp value.
 */
export interface EvidenceSnapshot {
  version: "baseline" | "changed" | "repaired";
  scenarioId: string; // e.g. "payment-provider-timeout"
  signals: DiagnosticSignal[]; // only the 7 canonical signal fields
  rawLogLines: string[];
  capturedAt: number; // Unix ms — log metadata only, not a signal
}

/**
 * Result of comparing baseline vs changed EvidenceSnapshots.
 *
 * Severity thresholds (by number of lost signals out of 7):
 *   0 lost → "none" | 1 → "low" | 2–3 → "medium" | 4–5 → "high" | 6–7 → "critical"
 *
 * Demo scenario loses 5 of 7 → severity = "high"
 */
export interface ComparisonResult {
  baseline: EvidenceSnapshot;
  changed: EvidenceSnapshot;
  lostSignals: DiagnosticSignal[];
  gainedSignals: DiagnosticSignal[];
  preservedSignals: DiagnosticSignal[];
  severity: "none" | "low" | "medium" | "high" | "critical";
}

/**
 * A deterministic patch to restore lost signals.
 * Derived from the lost-signal set and the changed source context — does NOT
 * copy the baseline source wholesale.
 */
export interface RepairSuggestion {
  targetFile: string;
  targetSymbol: string;
  description: string;
  patch: string; // unified diff format, for display
  signalMappings: Record<string, string>; // signal name → source fragment restored
}

/**
 * Result of the verification re-run.
 * `restored` is true only when EVERY individual lost signal name reappears.
 */
export interface VerificationResult {
  restored: boolean;
  restoredSignals: DiagnosticSignal[];
  stillMissing: DiagnosticSignal[];
  repaired: EvidenceSnapshot;
}

/** Full pipeline output. */
export interface DiagnosticReport {
  runId: string;
  scenario: FailureScenario;
  comparison: ComparisonResult;
  repair: RepairSuggestion;
  verification: VerificationResult;
  graniteExplanation?: string; // only present when WATSONX_API_KEY is set
}

/**
 * A controlled failure scenario.
 * `expectedSignals` contains exactly the 7 canonical signal names — never "timestamp".
 */
export interface FailureScenario {
  id: string;
  description: string;
  endpoint: string; // e.g. "POST /api/orders/:orderId/payment"
  injectedCondition: "timeout" | "service-error";
  expectedSignals: string[]; // must be a subset of the 7 canonical signal names
}
