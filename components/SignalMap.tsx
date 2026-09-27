"use client";

/**
 * SignalMap — Shows all 7 canonical diagnostic signals with baseline/changed
 * status and final interpretation.
 *
 * Timestamp is intentionally excluded from this table.
 */

import type { ComparisonResult } from "@/analyzer/types";
import { CANONICAL_SIGNAL_NAMES } from "@/analyzer/types";

interface SignalMapProps {
  comparison: ComparisonResult;
}

type SignalStatus = "present" | "absent";

function StatusBadge({ status }: { status: SignalStatus }) {
  if (status === "present") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
        Present
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded px-2 py-0.5">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
      Absent
    </span>
  );
}

function InterpretationBadge({
  interpretation,
}: {
  interpretation: "preserved" | "lost";
}) {
  if (interpretation === "preserved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
        Preserved
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
      Lost
    </span>
  );
}

export function SignalMap({ comparison }: SignalMapProps) {
  const { baseline, changed, lostSignals, preservedSignals } = comparison;

  const lostNames = new Set(lostSignals.map((s) => s.name));
  const preservedNames = new Set(preservedSignals.map((s) => s.name));

  // Build a row for each canonical signal
  const rows = CANONICAL_SIGNAL_NAMES.map((name) => {
    const baselineSignal = baseline.signals.find((s) => s.name === name);
    const changedSignal = changed.signals.find((s) => s.name === name);

    const baselineStatus: SignalStatus =
      baselineSignal?.present === true ? "present" : "absent";
    const changedStatus: SignalStatus =
      changedSignal?.present === true ? "present" : "absent";

    const interpretation: "preserved" | "lost" = lostNames.has(name)
      ? "lost"
      : preservedNames.has(name)
      ? "preserved"
      : baselineStatus === "present"
      ? "preserved"
      : "preserved";

    return { name, baselineStatus, changedStatus, interpretation };
  });

  const lostCount = lostSignals.length;
  const preservedCount = preservedSignals.length;

  return (
    <section aria-labelledby="signal-map-heading">
      <div className="flex items-center justify-between mb-3">
        <h2
          id="signal-map-heading"
          className="text-sm font-semibold text-gray-900 uppercase tracking-wide"
        >
          Signal Map
        </h2>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>
            <span className="font-semibold text-emerald-600">
              {preservedCount}
            </span>{" "}
            preserved
          </span>
          <span>·</span>
          <span>
            <span className="font-semibold text-red-600">{lostCount}</span>{" "}
            lost
          </span>
          <span>·</span>
          <span>7 total</span>
        </div>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm" role="table">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th
                scope="col"
                className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-1/3"
              >
                Signal
              </th>
              <th
                scope="col"
                className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-1/4"
              >
                Baseline
              </th>
              <th
                scope="col"
                className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-1/4"
              >
                Changed
              </th>
              <th
                scope="col"
                className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide"
              >
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.name}
                className={[
                  idx < rows.length - 1 ? "border-b border-gray-100" : "",
                  row.interpretation === "lost" ? "bg-red-50/30" : "",
                ].join(" ")}
              >
                <td className="px-4 py-2.5 font-mono text-xs text-gray-800 font-medium">
                  {row.name}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={row.baselineStatus} />
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={row.changedStatus} />
                </td>
                <td className="px-4 py-2.5">
                  <InterpretationBadge
                    interpretation={row.interpretation}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
