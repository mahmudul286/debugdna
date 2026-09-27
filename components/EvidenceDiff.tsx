"use client";

/**
 * EvidenceDiff — Side-by-side view of baseline vs changed runtime evidence.
 *
 * Makes it clear that:
 *  - both versions produce the same payment failure
 *  - baseline has richer diagnostic evidence
 *  - changed version loses 5 signals
 */

import type { ComparisonResult } from "@/analyzer/types";

interface EvidenceDiffProps {
  comparison: ComparisonResult;
}

function FieldTag({
  label,
  value,
  variant,
}: {
  label: string;
  value?: string;
  variant: "present" | "missing" | "preserved";
}) {
  const styles = {
    present:
      "border-emerald-200 bg-emerald-50 text-emerald-800",
    missing:
      "border-red-200 bg-red-50 text-red-700",
    preserved:
      "border-blue-200 bg-blue-50 text-blue-800",
  };

  return (
    <div
      className={`text-xs border rounded px-2 py-1 flex gap-1.5 items-start font-mono ${styles[variant]}`}
    >
      <span className="font-semibold shrink-0">{label}:</span>
      {value ? (
        <span className="break-all">{value}</span>
      ) : (
        <span className="italic opacity-60">not captured</span>
      )}
    </div>
  );
}

function LogBlock({ lines, label }: { lines: string[]; label: string }) {
  const display = lines.slice(0, 12);
  const extra = lines.length - display.length;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        {label}
      </p>
      <div className="bg-gray-900 rounded-md p-3 font-mono text-xs text-gray-200 overflow-x-auto max-h-44 overflow-y-auto">
        {display.length > 0 ? (
          display.map((line, i) => (
            <div key={i} className="leading-5 whitespace-pre">
              {line}
            </div>
          ))
        ) : (
          <span className="italic text-gray-500">No log output captured.</span>
        )}
        {extra > 0 && (
          <div className="text-gray-500 mt-1">…{extra} more lines</div>
        )}
      </div>
    </div>
  );
}

export function EvidenceDiff({ comparison }: EvidenceDiffProps) {
  const { baseline, changed, lostSignals, preservedSignals } = comparison;

  const lostNames = new Set(lostSignals.map((s) => s.name));
  const preservedNames = new Set(preservedSignals.map((s) => s.name));

  // Build signal display rows for each snapshot
  function signalFields(signals: typeof baseline.signals) {
    return signals.map((s) => {
      const variant = lostNames.has(s.name)
        ? s.present
          ? "present"
          : "missing"
        : preservedNames.has(s.name)
        ? "preserved"
        : s.present
        ? "present"
        : "missing";
      return { label: s.name, value: s.value, variant } as const;
    });
  }

  const baselineFields = signalFields(baseline.signals);
  const changedFields = signalFields(changed.signals);

  return (
    <section aria-labelledby="evidence-diff-heading">
      <h2
        id="evidence-diff-heading"
        className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3"
      >
        Runtime Evidence
      </h2>

      {/* Outcome banner */}
      <div className="mb-4 border border-amber-200 bg-amber-50 rounded-lg px-4 py-3 text-sm text-amber-800">
        <span className="font-semibold">Same failure, different evidence.</span>{" "}
        Both versions return{" "}
        <span className="font-mono font-semibold">HTTP 502</span> for a payment
        provider timeout. The baseline captures rich diagnostic context; the
        changed version loses{" "}
        <span className="font-semibold">{lostSignals.length} signals</span>.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Baseline */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-emerald-800">
              Baseline
            </span>
            <span className="text-xs text-emerald-600">
              {baseline.signals.filter((s) => s.present).length} / 7 signals
              captured
            </span>
          </div>
          <div className="p-4 space-y-3">
            <LogBlock
              lines={baseline.rawLogLines}
              label="Diagnostic output"
            />
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Captured fields
              </p>
              <div className="space-y-1">
                {baselineFields.map((f) => (
                  <FieldTag key={f.label} {...f} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Changed */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 bg-red-50 border-b border-red-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-red-800">
              Changed
            </span>
            <span className="text-xs text-red-600">
              {changed.signals.filter((s) => s.present).length} / 7 signals
              captured
            </span>
          </div>
          <div className="p-4 space-y-3">
            <LogBlock
              lines={changed.rawLogLines}
              label="Diagnostic output"
            />
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Captured fields
              </p>
              <div className="space-y-1">
                {changedFields.map((f) => (
                  <FieldTag key={f.label} {...f} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Lost signals callout */}
      {lostSignals.length > 0 && (
        <div className="mt-4 border border-red-200 rounded-lg px-4 py-3">
          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1.5">
            Lost diagnostic signals
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
      )}
    </section>
  );
}
