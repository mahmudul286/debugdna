/**
 * DebugDNA — Next.js App Router API route: POST /api/run-analysis
 *
 * Runs the full deterministic DebugDNA pipeline and streams progress to the
 * caller via Server-Sent Events (SSE).
 *
 * Pipeline order:
 *   run-baseline → run-changed → diff → extract → compare → repair → verify → report
 *
 * SSE event schema:
 *   { "type": "stage",  "stage": "<name>", "status": "complete", "message": "…" }
 *   { "type": "report", "report": <DiagnosticReport> }
 *   { "type": "error",  "message": "…" }   (on pipeline failure)
 *
 * Security constraints:
 *   - No stack traces, API keys, or env values are ever emitted.
 *   - 400 is returned for malformed / unsupported request bodies.
 */

import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

import type { FailureScenario } from "@/analyzer/types";
import { runFailureScenario } from "@/analyzer/failure-runner";
import { collectEvidence } from "@/analyzer/evidence-collector";
import { scanDiff } from "@/analyzer/diff-scanner";
import { extractSignalsInRanges } from "@/analyzer/signal-extractor";
import { compareSnapshots } from "@/analyzer/comparator";
import { suggestRepair } from "@/analyzer/repair-suggester";
import { verifyRepair } from "@/analyzer/verifier";
import { buildDiagnosticReport } from "@/analyzer/report-builder";

// ---------------------------------------------------------------------------
// Supported scenario IDs
// ---------------------------------------------------------------------------

const SUPPORTED_SCENARIO_IDS = new Set(["payment-provider-timeout"]);

// Path to the changed source file (read once per request for diff + repair).
const CHANGED_SERVER_PATH = path.resolve(
  process.cwd(),
  "synthetic-app/changed/server.ts"
);
const BASELINE_SERVER_PATH = path.resolve(
  process.cwd(),
  "synthetic-app/baseline/server.ts"
);

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

/** Encode one SSE event as a UTF-8 buffer. */
function sseEvent(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface ParsedBody {
  scenario: FailureScenario;
}

function validateBody(raw: unknown): { ok: true; parsed: ParsedBody } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const obj = raw as Record<string, unknown>;
  const scenario = obj["scenario"];

  if (typeof scenario !== "object" || scenario === null || Array.isArray(scenario)) {
    return { ok: false, error: 'Request body must contain a "scenario" object.' };
  }

  const s = scenario as Record<string, unknown>;

  if (typeof s["id"] !== "string" || s["id"].trim() === "") {
    return { ok: false, error: '"scenario.id" must be a non-empty string.' };
  }

  if (!SUPPORTED_SCENARIO_IDS.has(s["id"] as string)) {
    return {
      ok: false,
      error: `Unsupported scenario id "${s["id"]}". Supported: ${[...SUPPORTED_SCENARIO_IDS].join(", ")}.`,
    };
  }

  if (typeof s["description"] !== "string") {
    return { ok: false, error: '"scenario.description" must be a string.' };
  }

  if (typeof s["endpoint"] !== "string") {
    return { ok: false, error: '"scenario.endpoint" must be a string.' };
  }

  if (s["injectedCondition"] !== "timeout" && s["injectedCondition"] !== "service-error") {
    return { ok: false, error: '"scenario.injectedCondition" must be "timeout" or "service-error".' };
  }

  if (!Array.isArray(s["expectedSignals"])) {
    return { ok: false, error: '"scenario.expectedSignals" must be an array.' };
  }

  return {
    ok: true,
    parsed: { scenario: s as unknown as FailureScenario },
  };
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<Response> {
  // --- Parse + validate the request body ---
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON in request body." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const validation = validateBody(rawBody);
  if (!validation.ok) {
    return new Response(
      JSON.stringify({ error: validation.error }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { scenario } = validation.parsed;

  // --- Set up SSE stream ---
  const encoder = new TextEncoder();
  void encoder; // referenced via sseEvent helper

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (payload: Record<string, unknown>) => {
        controller.enqueue(sseEvent(payload));
      };

      const emitStage = (
        stage: string,
        message: string
      ) => {
        emit({ type: "stage", stage, status: "complete", message });
      };

      const emitError = (message: string) => {
        emit({ type: "error", message });
        controller.close();
      };

      try {
        // 1. Run baseline
        const baselineRunner = await runFailureScenario("baseline");
        const baselineEvidence = collectEvidence({
          rawOutput: baselineRunner.stdout + "\n" + baselineRunner.stderr,
          version: "baseline",
          scenarioId: scenario.id,
          sourceFile: "baseline/server.ts",
        });
        emitStage("run-baseline", "Baseline failure evidence captured");

        // 2. Run changed
        const changedRunner = await runFailureScenario("changed");
        const changedEvidence = collectEvidence({
          rawOutput: changedRunner.stdout + "\n" + changedRunner.stderr,
          version: "changed",
          scenarioId: scenario.id,
          sourceFile: "changed/server.ts",
        });
        emitStage("run-changed", "Changed failure evidence captured");

        // 3. Diff scan
        const baselineSource = fs.readFileSync(BASELINE_SERVER_PATH, "utf-8");
        const changedSource = fs.readFileSync(CHANGED_SERVER_PATH, "utf-8");
        const diffResult = scanDiff(baselineSource, changedSource);
        emitStage("diff", `Diff scan complete — ${diffResult.changedRanges.length} changed range(s) found`);

        // 4. Signal extraction (scoped to changed ranges)
        const extractionResult = extractSignalsInRanges(
          changedSource,
          "changed/server.ts",
          diffResult.changedRanges
        );
        emitStage(
          "extract",
          `Signal extraction complete — ${extractionResult.signals.length} signal(s) found in changed ranges`
        );

        // 5. Compare snapshots
        const comparison = compareSnapshots(baselineEvidence, changedEvidence);
        emitStage(
          "compare",
          `Comparison complete — ${comparison.lostSignals.length} lost, severity=${comparison.severity}`
        );

        // 6. Repair suggestion
        const repair = suggestRepair(comparison, changedSource);
        emitStage(
          "repair",
          `Repair suggestion generated for ${Object.keys(repair.signalMappings).length} signal(s)`
        );

        // 7. Verification
        const verification = await verifyRepair({
          changedSource,
          suggestion: repair,
          comparison,
          scenario,
        });
        emitStage(
          "verify",
          verification.restored
            ? `Verification complete — all lost signals restored`
            : `Verification complete — ${verification.stillMissing.length} signal(s) still missing`
        );

        // 8. Report builder (with optional Granite explanation)
        const report = await buildDiagnosticReport({
          scenario,
          comparison,
          repair,
          verification,
        });
        emitStage("report", "Diagnostic report assembled");

        // 9. Emit the final report event
        emit({ type: "report", report });

        controller.close();
      } catch (err: unknown) {
        // Safe error message — no stack traces or internal details
        const safeMessage =
          err instanceof Error
            ? `Pipeline error: ${err.message.slice(0, 200)}`
            : "An unexpected pipeline error occurred.";
        emitError(safeMessage);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
