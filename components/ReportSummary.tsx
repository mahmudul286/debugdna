"use client";

/**
 * ReportSummary — High-level summary of the DiagnosticReport.
 *
 * Shows deterministic findings as authoritative; Granite as explanatory only.
 */

import type { DiagnosticReport } from "@/analyzer/types";

interface ReportSummaryProps {
  report: DiagnosticReport;
}

const SEVERITY_STYLES: Record<
  string,
  { badge: string; label: string }
> = {
  none: { badge: "bg-gray-100 text-gray-600 border-gray-200", label: "None" },
  low: { badge: "bg-blue-50 text-blue-700 border-blue-200", label: "Low" },
  medium: {
    badge: "bg-yellow-50 text-yellow-700 border-yellow-200",
    label: "Medium",
  },
  high: { badge: "bg-red-50 text-red-700 border-red-200", label: "High" },
  critical: {
    badge: "bg-red-100 text-red-800 border-red-300",
    label: "Critical",
  },
};

function SeverityBadge({ severity }: { severity: string }) {
  const style =
    SEVERITY_STYLES[severity] ??
    SEVERITY_STYLES["high"];
  return (
    <span
      className={`inline-block text-xs font-semibold uppercase tracking-wider border rounded px-2.5 py-1 ${style.badge}`}
    >
      {style.label}
    </span>
  );
}

export function ReportSummary({ report }: ReportSummaryProps) {
  const { scenario, comparison, verification, graniteExplanation } = report;
  const { lostSignals, preservedSignals, severity } = comparison;

  const totalSignals =
    lostSignals.length +
    preservedSignals.length +
    comparison.gainedSignals.length;

  return (
    <section aria-labelledby="report-summary-heading">
      <h2
        id="report-summary-heading"
        className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3"
      >
        Report Summary
      </h2>

      {/* Header row */}
      <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-0.5">
              Scenario
            </p>
            <p className="text-sm font-semibold text-gray-900">
              {scenario.id}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{scenario.description}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">
              Severity
            </p>
            <SeverityBadge severity={severity} />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-gray-200">
          <div className="px-4 py-3 text-center">
            <p className="text-2xl font-bold text-gray-900">{totalSignals}</p>
            <p className="text-xs text-gray-500 mt-0.5">Total signals</p>
          </div>
          <div className="px-4 py-3 text-center">
            <p className="text-2xl font-bold text-red-600">{lostSignals.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">Lost</p>
          </div>
          <div className="px-4 py-3 text-center">
            <p className="text-2xl font-bold text-blue-600">
              {preservedSignals.length}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Preserved</p>
          </div>
          <div className="px-4 py-3 text-center">
            <p
              className={`text-2xl font-bold ${
                verification.restored ? "text-emerald-600" : "text-red-600"
              }`}
            >
              {verification.restored ? "✓" : "✗"}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Verified</p>
          </div>
        </div>
      </div>

      {/* Verification result */}
      <div
        className={`border rounded-lg px-4 py-3 mb-4 ${
          verification.restored
            ? "border-emerald-200 bg-emerald-50"
            : "border-red-200 bg-red-50"
        }`}
      >
        <p
          className={`text-sm font-semibold ${
            verification.restored ? "text-emerald-800" : "text-red-800"
          }`}
        >
          {verification.restored
            ? "Repair verified — all signals restored"
            : `Repair incomplete — ${verification.stillMissing.length} signal(s) still missing`}
        </p>
        {verification.restored && (
          <p className="text-xs text-emerald-600 mt-0.5">
            {verification.restoredSignals.length}/
            {verification.restoredSignals.length +
              verification.stillMissing.length}{" "}
            diagnostic signals restored · HTTP 502 preserved
          </p>
        )}
      </div>

      {/* Granite explanation — clearly labelled as explanatory only */}
      {graniteExplanation && (
        <div className="border border-purple-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 bg-purple-50 border-b border-purple-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-purple-800 uppercase tracking-wide">
              AI Explanation
            </span>
            <span className="text-xs text-purple-600 border border-purple-200 rounded px-2 py-0.5 bg-white">
              IBM Granite — explanatory only
            </span>
          </div>
          <div className="px-4 py-3">
            <p className="text-sm text-gray-700 leading-relaxed">
              {graniteExplanation}
            </p>
            <p className="text-xs text-gray-400 mt-2 italic">
              Deterministic findings above are the authoritative source of truth.
              This explanation is generated by IBM Granite and is for additional
              context only.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
