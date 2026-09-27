"use client";

/**
 * DebugDNA — Live Analysis page (/analysis).
 *
 * Consumes real SSE events from the context and shows pipeline progress.
 * When analysis completes, shows the full report inline and provides a
 * link to /report for the detailed view.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAnalysis, type StageState } from "@/lib/analysisContext";
import { SignalMap } from "@/components/SignalMap";
import { EvidenceDiff } from "@/components/EvidenceDiff";
import { RepairView } from "@/components/RepairView";
import { VerificationBadge } from "@/components/VerificationBadge";
import { ReportSummary } from "@/components/ReportSummary";

// ---------------------------------------------------------------------------
// Stage indicator
// ---------------------------------------------------------------------------

function StageRow({ stage }: { stage: StageState }) {
  const icons: Record<string, string> = {
    pending: "○",
    running: "◌",
    complete: "●",
    error: "✗",
  };
  const colors: Record<string, string> = {
    pending: "text-gray-300",
    running: "text-blue-500",
    complete: "text-emerald-500",
    error: "text-red-500",
  };
  const labelColors: Record<string, string> = {
    pending: "text-gray-400",
    running: "text-gray-800 font-medium",
    complete: "text-gray-700",
    error: "text-red-600",
  };

  return (
    <li className="flex items-start gap-3 py-1.5">
      <span
        className={`mt-0.5 text-sm font-bold w-4 shrink-0 ${colors[stage.status]} ${
          stage.status === "running" ? "animate-pulse" : ""
        }`}
        aria-hidden="true"
      >
        {icons[stage.status]}
      </span>
      <div className="min-w-0">
        <span
          className={`text-sm ${labelColors[stage.status]}`}
          aria-live={stage.status === "running" ? "polite" : undefined}
        >
          {stage.label}
        </span>
        {stage.message && stage.status === "complete" && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">{stage.message}</p>
        )}
        {stage.message && stage.status === "error" && (
          <p className="text-xs text-red-500 mt-0.5">{stage.message}</p>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AnalysisPage() {
  const router = useRouter();
  const { phase, stages, report, error, liveMessage, startAnalysis, reset } =
    useAnalysis();

  // If page is loaded directly (e.g., after refresh) while idle, start analysis.
  useEffect(() => {
    if (phase === "idle") {
      startAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completedCount = stages.filter((s) => s.status === "complete").length;
  const totalStages = stages.length;

  function handleViewReport() {
    router.push("/report");
  }

  function handleRunAgain() {
    reset();
    router.push("/");
  }

  return (
    <main className="min-h-screen bg-white">
      {/* Top nav */}
      <nav className="border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRunAgain}
            className="text-sm font-semibold text-gray-900 hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            DebugDNA
          </button>
          <span className="text-gray-300">/</span>
          <span className="text-sm text-gray-500">Analysis</span>
        </div>
        {phase === "completed" && (
          <button
            type="button"
            onClick={handleViewReport}
            className="text-sm font-medium text-blue-600 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            View full report →
          </button>
        )}
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-10">
        {/* Pipeline status panel */}
        <section aria-labelledby="pipeline-heading">
          <div className="flex items-center justify-between mb-4">
            <h1
              id="pipeline-heading"
              className="text-lg font-bold text-gray-900"
            >
              {phase === "completed"
                ? "Analysis complete"
                : phase === "error"
                ? "Analysis failed"
                : "Running analysis…"}
            </h1>
            {(phase === "streaming" || phase === "loading") && (
              <span className="text-xs text-gray-500">
                {completedCount} / {totalStages} stages
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Stage list */}
            <div className="md:col-span-1 border border-gray-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                Pipeline stages
              </p>
              <ol aria-label="Pipeline stages" className="space-y-0.5">
                {stages.map((stage) => (
                  <StageRow key={stage.id} stage={stage} />
                ))}
              </ol>
            </div>

            {/* Live status area */}
            <div className="md:col-span-2 border border-gray-200 rounded-lg p-4 flex flex-col justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Status
                </p>

                {phase === "error" ? (
                  <div
                    className="border border-red-200 bg-red-50 rounded-lg px-4 py-3"
                    role="alert"
                  >
                    <p className="text-sm font-semibold text-red-800">
                      Analysis failed
                    </p>
                    <p className="text-xs text-red-600 mt-1">{error}</p>
                  </div>
                ) : phase === "completed" ? (
                  <div
                    className="border border-emerald-200 bg-emerald-50 rounded-lg px-4 py-3"
                    role="status"
                  >
                    <p className="text-sm font-semibold text-emerald-800">
                      Analysis complete
                    </p>
                    <p className="text-xs text-emerald-600 mt-1">
                      {report?.comparison.lostSignals.length} signals lost ·{" "}
                      {report?.comparison.preservedSignals.length} preserved ·
                      Severity{" "}
                      {report?.comparison.severity?.toUpperCase()}
                    </p>
                  </div>
                ) : (
                  <div aria-live="polite" aria-atomic="true">
                    {liveMessage && (
                      <p className="text-sm text-gray-700 mb-3">
                        {liveMessage}
                      </p>
                    )}

                    {/* Progress messages */}
                    <div className="space-y-1">
                      {stages
                        .filter((s) => s.status === "complete" && s.message)
                        .slice(-4)
                        .map((s) => (
                          <p
                            key={s.id}
                            className="text-xs text-gray-500 flex items-center gap-1.5"
                          >
                            <span className="text-emerald-500">●</span>
                            {s.message}
                          </p>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              {phase === "completed" && (
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={handleViewReport}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  >
                    View full report
                  </button>
                  <button
                    type="button"
                    onClick={handleRunAgain}
                    className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  >
                    Run again
                  </button>
                </div>
              )}

              {phase === "error" && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={handleRunAgain}
                    className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  >
                    ← Back to dashboard
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Report sections — shown when analysis is complete */}
        {phase === "completed" && report && (
          <>
            <div className="border-t border-gray-100 pt-2" />

            <SignalMap comparison={report.comparison} />

            <div className="border-t border-gray-100" />

            <EvidenceDiff comparison={report.comparison} />

            <div className="border-t border-gray-100" />

            <RepairView
              repair={report.repair}
              comparison={report.comparison}
            />

            <div className="border-t border-gray-100" />

            <VerificationBadge verification={report.verification} />

            <div className="border-t border-gray-100" />

            <ReportSummary report={report} />

            <div className="border-t border-gray-100 pb-4" />

            <div className="flex gap-3 pb-8">
              <button
                type="button"
                onClick={handleViewReport}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                View full report
              </button>
              <button
                type="button"
                onClick={handleRunAgain}
                className="px-5 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                ← Dashboard
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
