"use client";

/**
 * DebugDNA — Report page (/report).
 *
 * Shows the full DiagnosticReport from the last analysis run.
 * If no report is available (e.g., after a browser refresh), guides the user
 * back to the dashboard rather than crashing.
 */

import { useRouter } from "next/navigation";
import { useAnalysis } from "@/lib/analysisContext";
import { SignalMap } from "@/components/SignalMap";
import { EvidenceDiff } from "@/components/EvidenceDiff";
import { RepairView } from "@/components/RepairView";
import { VerificationBadge } from "@/components/VerificationBadge";
import { ReportSummary } from "@/components/ReportSummary";

const SEVERITY_STYLES: Record<string, string> = {
  none: "bg-gray-100 text-gray-600 border-gray-200",
  low: "bg-blue-50 text-blue-700 border-blue-200",
  medium: "bg-yellow-50 text-yellow-700 border-yellow-200",
  high: "bg-red-50 text-red-700 border-red-200",
  critical: "bg-red-100 text-red-800 border-red-300",
};

export default function ReportPage() {
  const router = useRouter();
  const { report, phase, reset } = useAnalysis();

  function handleDashboard() {
    reset();
    router.push("/");
  }

  function handleRunAgain() {
    reset();
    router.push("/");
  }

  // Recovery state: no report available (browser refresh / direct navigation)
  if (!report) {
    return (
      <main className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <p className="text-4xl mb-4" aria-hidden="true">
            —
          </p>
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            No report available
          </h1>
          <p className="text-sm text-gray-500 mb-6">
            {phase === "error"
              ? "The analysis encountered an error. Return to the dashboard and run the analysis again."
              : phase === "streaming" || phase === "loading"
              ? "Analysis is still running. Return to the analysis page to see live progress."
              : "No analysis has been run yet in this session. Return to the dashboard to start one."}
          </p>
          <div className="flex gap-3 justify-center">
            {(phase === "streaming" || phase === "loading") && (
              <button
                type="button"
                onClick={() => router.push("/analysis")}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                View live analysis
              </button>
            )}
            <button
              type="button"
              onClick={handleDashboard}
              className="px-5 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              ← Dashboard
            </button>
          </div>
        </div>
      </main>
    );
  }

  const severity = report.comparison.severity;
  const severityStyle =
    SEVERITY_STYLES[severity] ?? SEVERITY_STYLES["high"];

  return (
    <main className="min-h-screen bg-white">
      {/* Top nav */}
      <nav className="border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDashboard}
            className="text-sm font-semibold text-gray-900 hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            DebugDNA
          </button>
          <span className="text-gray-300">/</span>
          <button
            type="button"
            onClick={() => router.push("/analysis")}
            className="text-sm text-gray-500 hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            Analysis
          </button>
          <span className="text-gray-300">/</span>
          <span className="text-sm text-gray-500">Report</span>
        </div>
        <button
          type="button"
          onClick={handleRunAgain}
          className="text-sm font-medium text-blue-600 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        >
          Run again
        </button>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-10">
        {/* Report header */}
        <div className="border border-gray-200 rounded-xl p-6 bg-gray-50">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                Diagnostic Report
              </p>
              <h1 className="text-xl font-bold text-gray-900">
                {report.scenario.id}
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                {report.scenario.description}
              </p>
              <p className="text-xs text-gray-400 mt-1 font-mono">
                Run ID: {report.runId}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span
                className={`text-xs font-semibold uppercase tracking-wider border rounded px-3 py-1.5 ${severityStyle}`}
              >
                {severity} severity
              </span>
              <p className="text-xs text-gray-500">
                {report.comparison.lostSignals.length} of 7 signals lost
              </p>
            </div>
          </div>

          {/* Quick summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-center">
              <p className="text-xl font-bold text-gray-900">7</p>
              <p className="text-xs text-gray-500">total signals</p>
            </div>
            <div className="bg-white border border-red-200 rounded-lg px-3 py-2.5 text-center">
              <p className="text-xl font-bold text-red-600">
                {report.comparison.lostSignals.length}
              </p>
              <p className="text-xs text-gray-500">lost</p>
            </div>
            <div className="bg-white border border-blue-200 rounded-lg px-3 py-2.5 text-center">
              <p className="text-xl font-bold text-blue-600">
                {report.comparison.preservedSignals.length}
              </p>
              <p className="text-xs text-gray-500">preserved</p>
            </div>
            <div
              className={`bg-white border rounded-lg px-3 py-2.5 text-center ${
                report.verification.restored
                  ? "border-emerald-200"
                  : "border-red-200"
              }`}
            >
              <p
                className={`text-xl font-bold ${
                  report.verification.restored
                    ? "text-emerald-600"
                    : "text-red-600"
                }`}
              >
                {report.verification.restored ? "✓" : "✗"}
              </p>
              <p className="text-xs text-gray-500">verified</p>
            </div>
          </div>
        </div>

        {/* Report sections */}
        <SignalMap comparison={report.comparison} />

        <div className="border-t border-gray-100" />

        <EvidenceDiff comparison={report.comparison} />

        <div className="border-t border-gray-100" />

        <RepairView repair={report.repair} comparison={report.comparison} />

        <div className="border-t border-gray-100" />

        <VerificationBadge verification={report.verification} />

        <div className="border-t border-gray-100" />

        <ReportSummary report={report} />

        <div className="border-t border-gray-100" />

        {/* Bottom actions */}
        <div className="flex gap-3 pb-8">
          <button
            type="button"
            onClick={handleDashboard}
            className="px-5 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            ← Dashboard
          </button>
          <button
            type="button"
            onClick={handleRunAgain}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            Run analysis again
          </button>
        </div>
      </div>
    </main>
  );
}
