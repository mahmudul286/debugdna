"use client";

/**
 * RepairView — Shows the deterministic repair suggestion.
 *
 * Intentionally labelled "Deterministic Repair Suggestion" — not AI-generated.
 */

import type { RepairSuggestion, ComparisonResult } from "@/analyzer/types";

interface RepairViewProps {
  repair: RepairSuggestion;
  comparison: ComparisonResult;
}

export function RepairView({ repair, comparison }: RepairViewProps) {
  const { lostSignals } = comparison;

  const mappingEntries = Object.entries(repair.signalMappings);

  return (
    <section aria-labelledby="repair-heading">
      <div className="flex items-start justify-between mb-3">
        <h2
          id="repair-heading"
          className="text-sm font-semibold text-gray-900 uppercase tracking-wide"
        >
          Deterministic Repair Suggestion
        </h2>
        <span className="text-xs font-medium text-gray-500 border border-gray-200 rounded px-2 py-0.5">
          Not AI-generated
        </span>
      </div>

      {/* Regression banner */}
      <div className="mb-4 border border-red-200 bg-red-50 rounded-lg px-4 py-3">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-sm font-semibold text-red-800">
              Diagnosability regression detected
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              Severity:{" "}
              <span className="font-semibold uppercase">
                {comparison.severity}
              </span>{" "}
              — {lostSignals.length} of 7 diagnostic signals lost
            </p>
          </div>
          <span className="ml-auto text-xs font-semibold uppercase tracking-wider bg-red-100 text-red-700 border border-red-200 rounded px-2 py-1">
            {comparison.severity}
          </span>
        </div>
      </div>

      {/* Description */}
      <div className="mb-4 border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Repair objective
        </p>
        <p className="text-sm text-gray-700">{repair.description}</p>
        <p className="text-xs text-gray-500 mt-1">
          Target: <span className="font-mono">{repair.targetFile}</span> —{" "}
          <span className="font-mono">{repair.targetSymbol}</span>
        </p>
      </div>

      {/* Lost signals */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Lost signals to restore
        </p>
        <div className="flex flex-wrap gap-2">
          {lostSignals.map((s) => (
            <span
              key={s.name}
              className="font-mono text-xs bg-red-50 border border-red-200 text-red-700 rounded px-2 py-0.5"
            >
              {s.name}
            </span>
          ))}
        </div>
      </div>

      {/* Signal mappings */}
      {mappingEntries.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Restore diagnostic context
          </p>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs" role="table">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th
                    scope="col"
                    className="text-left px-4 py-2 font-semibold text-gray-500 uppercase tracking-wide"
                  >
                    Signal
                  </th>
                  <th
                    scope="col"
                    className="text-left px-4 py-2 font-semibold text-gray-500 uppercase tracking-wide"
                  >
                    Restoration
                  </th>
                </tr>
              </thead>
              <tbody>
                {mappingEntries.map(([signal, fragment], i) => (
                  <tr
                    key={signal}
                    className={
                      i < mappingEntries.length - 1
                        ? "border-b border-gray-100"
                        : ""
                    }
                  >
                    <td className="px-4 py-2 font-mono font-medium text-gray-800">
                      {signal}
                    </td>
                    <td className="px-4 py-2 font-mono text-gray-600 break-all">
                      {fragment}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Unified diff */}
      {repair.patch && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Generated patch
          </p>
          <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto max-h-64 overflow-y-auto">
            {repair.patch.split("\n").map((line, i) => {
              const color =
                line.startsWith("+") && !line.startsWith("+++")
                  ? "text-emerald-400"
                  : line.startsWith("-") && !line.startsWith("---")
                  ? "text-red-400"
                  : line.startsWith("@@")
                  ? "text-blue-400"
                  : "text-gray-300";
              return (
                <div
                  key={i}
                  className={`font-mono text-xs leading-5 whitespace-pre ${color}`}
                >
                  {line}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
