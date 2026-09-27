/**
 * DebugDNA — API client for the POST /api/run-analysis SSE endpoint.
 *
 * Provides a typed async-generator that yields parsed SSE events.
 * All parsing and error handling is centralised here.
 */

import type { DiagnosticReport, FailureScenario } from "@/analyzer/types";

// ---------------------------------------------------------------------------
// SSE event shapes (mirroring the server-side schema)
// ---------------------------------------------------------------------------

export interface StageEvent {
  type: "stage";
  stage: string;
  status: "complete";
  message: string;
}

export interface ReportEvent {
  type: "report";
  report: DiagnosticReport;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type AnalysisEvent = StageEvent | ReportEvent | ErrorEvent;

// ---------------------------------------------------------------------------
// The demo scenario — single source of truth
// ---------------------------------------------------------------------------

export const DEMO_SCENARIO: FailureScenario = {
  id: "payment-provider-timeout",
  description: "Payment provider timeout causes degraded diagnostics",
  endpoint: "POST /api/orders/:orderId/payment",
  injectedCondition: "timeout",
  expectedSignals: [
    "requestId",
    "orderId",
    "paymentProvider",
    "operation",
    "errorType",
    "errorCode",
    "originalMessage",
  ],
};

// ---------------------------------------------------------------------------
// Stage ordering (used by the UI to display each step)
// ---------------------------------------------------------------------------

export const PIPELINE_STAGES: { id: string; label: string }[] = [
  { id: "run-baseline", label: "Baseline failure" },
  { id: "run-changed", label: "Changed failure" },
  { id: "diff", label: "Diff scan" },
  { id: "extract", label: "Signal extraction" },
  { id: "compare", label: "Evidence comparison" },
  { id: "repair", label: "Repair generation" },
  { id: "verify", label: "Verification" },
  { id: "report", label: "Report assembly" },
];

// ---------------------------------------------------------------------------
// SSE consumer
// ---------------------------------------------------------------------------

/**
 * Call POST /api/run-analysis and yield each parsed SSE event.
 * Throws on network errors; SSE error events are yielded as-is.
 */
export async function* runAnalysis(
  scenario: FailureScenario = DEMO_SCENARIO
): AsyncGenerator<AnalysisEvent> {
  const response = await fetch("/api/run-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const msg =
      typeof body["error"] === "string"
        ? body["error"]
        : `HTTP ${response.status}`;
    throw new Error(msg);
  }

  if (!response.body) {
    throw new Error("No response body received from analysis endpoint.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Split on SSE event boundaries (double newline)
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      for (const line of trimmed.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6)) as AnalysisEvent;
            yield event;
          } catch {
            // Malformed line — skip
          }
        }
      }
    }
  }

  // Flush trailing buffer
  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const event = JSON.parse(line.slice(6)) as AnalysisEvent;
          yield event;
        } catch {
          // Skip
        }
      }
    }
  }
}
