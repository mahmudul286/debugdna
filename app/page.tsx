"use client";

/**
 * DebugDNA — Dashboard (root page).
 *
 * Presents the product, the demo scenario, and the primary CTA.
 * On click: starts analysis via context, then navigates to /analysis.
 */

import { useRouter } from "next/navigation";
import { useAnalysis } from "@/lib/analysisContext";

export default function DashboardPage() {
  const router = useRouter();
  const { phase, startAnalysis } = useAnalysis();

  const isRunning = phase === "loading" || phase === "streaming";

  function handleRun() {
    startAnalysis();
    router.push("/analysis");
  }

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center p-6 md:p-12">
      <div className="max-w-2xl w-full">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <span className="font-mono text-xs font-semibold tracking-widest text-gray-400 uppercase border border-gray-200 rounded px-2 py-0.5 bg-gray-50">
              Developer Tool
            </span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 mb-3">
            DebugDNA
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed">
            Detects regressions in failure diagnosability caused by code
            changes. Deterministic analysis — no guesswork.
          </p>
        </div>

        {/* Central question */}
        <div className="border-l-4 border-blue-500 pl-5 py-1 mb-8">
          <p className="text-base font-medium text-gray-800 leading-relaxed italic">
            &ldquo;After this code change, can an engineer still diagnose the
            same failure with comparable evidence?&rdquo;
          </p>
        </div>

        {/* Scenario card */}
        <div className="border border-gray-200 rounded-xl p-6 mb-8 bg-gray-50">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                Demo scenario
              </p>
              <h2 className="text-base font-semibold text-gray-900">
                Payment Provider Timeout
              </h2>
            </div>
            <span className="shrink-0 text-xs font-mono font-medium text-gray-500 bg-white border border-gray-200 rounded px-2 py-1">
              payment-provider-timeout
            </span>
          </div>

          <p className="text-sm text-gray-600 leading-relaxed mb-4">
            A code change to the order payment handler preserves the functional
            behavior — the API still returns{" "}
            <span className="font-mono text-xs bg-white border border-gray-200 rounded px-1 py-0.5">
              HTTP 502
            </span>{" "}
            on a provider timeout — but removes structured logging context. The
            changed version loses{" "}
            <span className="font-semibold text-red-600">5 of 7</span>{" "}
            diagnostic signals, making the failure significantly harder to
            investigate.
          </p>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
              <p className="text-xl font-bold text-gray-900">7</p>
              <p className="text-xs text-gray-500">canonical signals</p>
            </div>
            <div className="bg-white border border-red-200 rounded-lg px-3 py-2.5">
              <p className="text-xl font-bold text-red-600">5</p>
              <p className="text-xs text-gray-500">signals lost</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
              <p className="text-xl font-bold text-gray-700">HIGH</p>
              <p className="text-xs text-gray-500">severity</p>
            </div>
          </div>
        </div>

        {/* How it works */}
        <div className="mb-8">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Pipeline stages
          </p>
          <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              "Baseline failure",
              "Changed failure",
              "Diff scan",
              "Signal extraction",
              "Evidence comparison",
              "Repair generation",
              "Verification",
              "Report",
            ].map((stage, i) => (
              <li
                key={stage}
                className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5"
              >
                <span className="text-gray-400 font-mono font-medium w-4 shrink-0">
                  {i + 1}.
                </span>
                {stage}
              </li>
            ))}
          </ol>
        </div>

        {/* CTA */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning}
            aria-busy={isRunning}
            className={[
              "inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
              isRunning
                ? "bg-blue-300 text-white cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white",
            ].join(" ")}
          >
            {isRunning ? (
              <>
                <span
                  className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"
                  aria-hidden="true"
                />
                Running…
              </>
            ) : (
              "Run Diagnosability Analysis"
            )}
          </button>

          <p className="text-xs text-gray-400">
            Runs the full deterministic pipeline (~10–20 s)
          </p>
        </div>
      </div>
    </main>
  );
}
