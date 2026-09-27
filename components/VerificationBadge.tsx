"use client";

/**
 * VerificationBadge — Shows the actual verification result.
 *
 * Success is shown ONLY when restored === true in the real report.
 */

import type { VerificationResult } from "@/analyzer/types";

interface VerificationBadgeProps {
  verification: VerificationResult;
}

export function VerificationBadge({ verification }: VerificationBadgeProps) {
  const { restored, restoredSignals, stillMissing, repaired } = verification;

  const totalSignals = restoredSignals.length + stillMissing.length;

  if (restored) {
    return (
      <section aria-labelledby="verification-heading">
        <h2
          id="verification-heading"
          className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3"
        >
          Verification
        </h2>
        <div
          className="border border-emerald-200 bg-emerald-50 rounded-lg px-5 py-4"
          role="status"
          aria-label="Verification passed"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-600 font-bold text-base">
              ✓
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-800">
                Verification Passed
              </p>
              <p className="text-xs text-emerald-600">
                All diagnostic signals restored
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-xs">
            <div className="bg-white border border-emerald-200 rounded px-3 py-1.5 text-emerald-700 font-medium">
              {restoredSignals.length}/{totalSignals} diagnostic signals restored
            </div>
            <div className="bg-white border border-emerald-200 rounded px-3 py-1.5 text-emerald-700 font-medium">
              HTTP 502 preserved
            </div>
            <div className="bg-white border border-emerald-200 rounded px-3 py-1.5 text-emerald-700 font-medium">
              Repaired version: {repaired.version}
            </div>
          </div>

          {restoredSignals.length > 0 && (
            <div className="mt-3 pt-3 border-t border-emerald-200">
              <p className="text-xs text-emerald-700 font-medium mb-1.5">
                Restored signals:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {restoredSignals.map((s) => (
                  <span
                    key={s.name}
                    className="font-mono text-xs bg-emerald-100 border border-emerald-200 text-emerald-700 rounded px-2 py-0.5"
                  >
                    {s.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  // Not restored
  return (
    <section aria-labelledby="verification-heading">
      <h2
        id="verification-heading"
        className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3"
      >
        Verification
      </h2>
      <div
        className="border border-red-200 bg-red-50 rounded-lg px-5 py-4"
        role="status"
        aria-label="Verification failed"
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-red-100 border border-red-300 flex items-center justify-center text-red-600 font-bold text-base">
            ✗
          </div>
          <div>
            <p className="text-sm font-semibold text-red-800">
              Verification Failed
            </p>
            <p className="text-xs text-red-600">
              {stillMissing.length} signal(s) still missing after repair
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-xs mb-3">
          <div className="bg-white border border-red-200 rounded px-3 py-1.5 text-red-700 font-medium">
            {restoredSignals.length}/{totalSignals} signals restored
          </div>
        </div>

        {restoredSignals.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-emerald-700 font-medium mb-1.5">
              Restored:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {restoredSignals.map((s) => (
                <span
                  key={s.name}
                  className="font-mono text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 rounded px-2 py-0.5"
                >
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {stillMissing.length > 0 && (
          <div>
            <p className="text-xs text-red-700 font-medium mb-1.5">
              Still missing:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {stillMissing.map((s) => (
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
      </div>
    </section>
  );
}
