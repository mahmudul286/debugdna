/**
 * DebugDNA — deterministic snapshot comparator.
 *
 * Compares two EvidenceSnapshot objects and classifies each of the 7 canonical
 * diagnostic signal names as lost, gained, or preserved.
 *
 * Rules:
 * - Comparison is by signal NAME only — values are irrelevant.
 * - `timestamp` / `capturedAt` is never included in the comparison.
 * - Severity is derived solely from the count of lost signals:
 *     0 lost → "none"
 *     1 lost → "low"
 *     2–3 lost → "medium"
 *     4–5 lost → "high"
 *     6–7 lost → "critical"
 * - Pure function — no filesystem, no network, no child processes.
 */

import { CANONICAL_SIGNAL_NAMES, type ComparisonResult, type DiagnosticSignal, type EvidenceSnapshot } from "./types";

// ---------------------------------------------------------------------------
// Severity thresholds
// ---------------------------------------------------------------------------

function deriveSeverity(lostCount: number): ComparisonResult["severity"] {
  if (lostCount === 0) return "none";
  if (lostCount === 1) return "low";
  if (lostCount <= 3) return "medium";
  if (lostCount <= 5) return "high";
  return "critical";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare a baseline and a changed EvidenceSnapshot.
 *
 * Only the 7 canonical signal names participate in comparison.
 * The `capturedAt` timestamp on each snapshot is ignored entirely.
 *
 * @param baseline  Snapshot from the unmodified version (full signal set).
 * @param changed   Snapshot from the degraded/modified version.
 * @returns         ComparisonResult with classified signals and severity.
 */
export function compareSnapshots(
  baseline: EvidenceSnapshot,
  changed: EvidenceSnapshot
): ComparisonResult {
  // Build name-keyed maps from each snapshot — only canonical names.
  const baselineMap = new Map<string, DiagnosticSignal>();
  for (const sig of baseline.signals) {
    if ((CANONICAL_SIGNAL_NAMES as readonly string[]).includes(sig.name)) {
      baselineMap.set(sig.name, sig);
    }
  }

  const changedMap = new Map<string, DiagnosticSignal>();
  for (const sig of changed.signals) {
    if ((CANONICAL_SIGNAL_NAMES as readonly string[]).includes(sig.name)) {
      changedMap.set(sig.name, sig);
    }
  }

  // Classify each canonical signal name.
  const lostSignals: DiagnosticSignal[] = [];
  const gainedSignals: DiagnosticSignal[] = [];
  const preservedSignals: DiagnosticSignal[] = [];

  for (const name of CANONICAL_SIGNAL_NAMES) {
    const inBaseline = baselineMap.has(name);
    const inChanged = changedMap.has(name);

    if (inBaseline && !inChanged) {
      // Present in baseline but absent in changed → lost.
      lostSignals.push(baselineMap.get(name)!);
    } else if (!inBaseline && inChanged) {
      // Absent in baseline but present in changed → gained.
      gainedSignals.push(changedMap.get(name)!);
    } else if (inBaseline && inChanged) {
      // Present in both → preserved.
      preservedSignals.push(changedMap.get(name)!);
    }
    // Absent in both → not mentioned in any list.
  }

  const severity = deriveSeverity(lostSignals.length);

  return {
    baseline,
    changed,
    lostSignals,
    gainedSignals,
    preservedSignals,
    severity,
  };
}
