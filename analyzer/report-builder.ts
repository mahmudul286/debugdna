/**
 * DebugDNA — Report Builder.
 *
 * Assembles a complete DiagnosticReport from the pipeline outputs.
 * Optionally enriches the report with a Granite plain-language explanation
 * when WATSONX_API_KEY is present in the environment.
 *
 * Rules:
 * - graniteExplanation is additive only — it never alters any deterministic
 *   finding, severity, signal list, repair suggestion, or verification result.
 * - The DiagnosticReport is fully valid with graniteExplanation undefined.
 * - runId is derived deterministically from the scenario id and a
 *   monotonic timestamp so repeated runs produce distinct IDs.
 * - All input fields are preserved exactly — nothing is re-computed or
 *   normalised.
 */

import type {
  ComparisonResult,
  DiagnosticReport,
  FailureScenario,
  RepairSuggestion,
  VerificationResult,
} from "./types";
import { explainWithGranite } from "./granite-explainer";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ReportBuilderInput {
  /** The failure scenario that was executed. */
  scenario: FailureScenario;
  /** The comparison result (baseline vs changed). */
  comparison: ComparisonResult;
  /** The deterministic repair suggestion. */
  repair: RepairSuggestion;
  /** The verification result from the repaired run. */
  verification: VerificationResult;
}

/**
 * Assemble a complete DiagnosticReport, optionally including a
 * Granite-generated plain-language explanation.
 *
 * The Granite layer is purely additive — the deterministic report is fully
 * valid and authoritative whether or not the explanation is present.
 *
 * @param input  The four pipeline outputs (scenario, comparison, repair, verification).
 * @returns      A fully populated DiagnosticReport with a unique runId.
 */
export async function buildDiagnosticReport(
  input: ReportBuilderInput
): Promise<DiagnosticReport> {
  const { scenario, comparison, repair, verification } = input;

  // Derive a deterministic-looking but unique run ID.
  const runId = `run-${scenario.id}-${Date.now()}`;

  // Attempt to get an optional Granite explanation.
  // explainWithGranite returns undefined silently when no key is set or on error.
  const graniteExplanation = await explainWithGranite({
    scenario: { description: scenario.description },
    severity: comparison.severity,
    lostSignalNames: comparison.lostSignals.map((s) => s.name),
    preservedSignalNames: comparison.preservedSignals.map((s) => s.name),
  });

  const report: DiagnosticReport = {
    runId,
    scenario,
    comparison,
    repair,
    verification,
  };

  // Only attach the field when the explainer returned a non-empty result.
  if (graniteExplanation) {
    report.graniteExplanation = graniteExplanation;
  }

  return report;
}
