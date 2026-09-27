/**
 * DebugDNA — Evidence Collector.
 *
 * Pure function: accepts raw stdout/stderr text plus version and scenario
 * metadata, parses newline-delimited JSON log lines, extracts only the 7
 * canonical signal fields, and returns a valid EvidenceSnapshot.
 *
 * Rules:
 * - Only the 7 canonical signal names participate in signals[].
 * - `timestamp` is stored in capturedAt as log metadata; it is NOT a signal.
 * - SERVER_READY:<port> lines and other non-JSON lines are ignored silently.
 * - Missing signals are never inferred — only signals observed in the logs
 *   appear in the result.
 * - Deterministic: same input always produces the same output.
 */

import { CANONICAL_SIGNAL_NAMES, EvidenceSnapshot, DiagnosticSignal } from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CollectorInput {
  /** Raw combined stdout + stderr text captured from the child process. */
  rawOutput: string;
  /** Which synthetic-app variant produced this output. */
  version: EvidenceSnapshot["version"];
  /** The scenario ID, e.g. "payment-provider-timeout". */
  scenarioId: string;
  /** Source file reference for the location field, e.g. "server.ts". */
  sourceFile?: string;
}

/**
 * Parse raw log output and build an EvidenceSnapshot.
 *
 * @param input  CollectorInput describing the raw output and its metadata.
 * @returns      A fully populated EvidenceSnapshot.
 */
export function collectEvidence(input: CollectorInput): EvidenceSnapshot {
  const { rawOutput, version, scenarioId, sourceFile = "server.ts" } = input;

  const rawLogLines: string[] = [];
  const signalMap = new Map<string, DiagnosticSignal>();
  let capturedAt = Date.now();

  const lines = rawOutput.split("\n");

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;

    // Skip SERVER_READY:<port> lines — these are process readiness markers,
    // not diagnostic log records.
    if (/^SERVER_READY:\d+$/.test(line)) continue;

    // Attempt to parse as JSON; silently skip non-JSON lines.
    let record: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      record = parsed as Record<string, unknown>;
    } catch {
      continue;
    }

    rawLogLines.push(line);

    // Extract capturedAt from the first timestamp we encounter.
    if (typeof record["timestamp"] === "string") {
      const ts = Date.parse(record["timestamp"] as string);
      if (!isNaN(ts) && ts < capturedAt) {
        capturedAt = ts;
      }
    }

    // Extract only the 7 canonical signal names.
    for (const name of CANONICAL_SIGNAL_NAMES) {
      if (name in record && !signalMap.has(name)) {
        const value = record[name];
        signalMap.set(name, {
          name,
          category: "log",
          location: sourceFile,
          present: true,
          value: value !== undefined && value !== null ? String(value) : undefined,
        });
      }
    }
  }

  return {
    version,
    scenarioId,
    signals: Array.from(signalMap.values()),
    rawLogLines,
    capturedAt,
  };
}
